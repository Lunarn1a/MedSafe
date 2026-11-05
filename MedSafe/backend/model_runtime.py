"""Load the exported suggestion selector and its source-backed input catalog."""

from __future__ import annotations

import csv
from collections import Counter
import hashlib
import importlib.metadata
import io
import json
from pathlib import Path
from urllib.parse import urlsplit

from feature_schema import MECHANISM_TAGS, TAG_LABELS, coverage_features
from pair_guidance import PairGuidance
from suggestion_copy import GENERAL_QUESTION, QUESTION_TEMPLATES, MODEL_NOTE, LIMITED_NOTE, MISSING_REFERENCE_NOTE, basis_text


BACKEND_DIR = Path(__file__).resolve().parent
APP_DIR = BACKEND_DIR.parent
LABELS = ("label_review", "label_monitoring", "label_timing")


def normalize_name(name: str) -> str:
    return " ".join(name.split()).casefold()


def pair_key(first: str, second: str) -> str:
    return "|||".join(sorted((normalize_name(first), normalize_name(second))))


class SuggestionService:
    """Predict guidance categories; interaction severity always comes from the reference."""

    def __init__(self, app_dir: Path = APP_DIR):
        self.app_dir = app_dir
        backend = app_dir / "backend"
        metadata_path = backend / "models" / "metadata.json"
        self.metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        if self.metadata.get("input_columns") != ["severity", "mechanism"]:
            raise ValueError("This server expects a model trained on severity and mechanism.")
        if self.metadata.get("labels") != list(LABELS):
            raise ValueError("The exported model has an unsupported guidance-label order.")
        for package, expected in self.metadata["versions"].items():
            actual = importlib.metadata.version(package)
            if actual != expected:
                raise RuntimeError(
                    f"{package} is {actual}; the model requires {expected}. "
                    "Install backend/requirements.txt in the project environment."
                )

        database = json.loads((app_dir / "drugs.json").read_text(encoding="utf-8-sig"))
        self.drugs = {normalize_name(name): name for name in database["drugs"]}
        self.interactions = {
            pair_key(*key.split("|||")): severity
            for key, severity in database["interactions"].items()
        }

        catalog_bytes = (backend / "data" / "medsafe_suggestions_300.csv").read_bytes()
        checksum = hashlib.sha256(catalog_bytes).hexdigest()
        if checksum != self.metadata["training_csv_sha256"]:
            raise ValueError("The mechanism catalog does not match the CSV used for this model export.")
        self.detailed_catalog = {}
        for row in csv.DictReader(io.StringIO(catalog_bytes.decode("utf-8-sig"))):
            key = pair_key(row["drug_a"], row["drug_b"])
            if key in self.detailed_catalog or self.interactions.get(key) != row["severity"]:
                raise ValueError("A catalog pair is duplicated or conflicts with the interaction reference.")
            source = urlsplit(row["source_url"])
            if source.scheme != "https" or source.netloc != "ddinter2.scbdd.com" or not source.path.startswith("/server/interact/"):
                raise ValueError("A mechanism catalog record has an unexpected source URL.")
            if not row["mechanism"].strip():
                raise ValueError("A mechanism catalog record has no sourced mechanism text.")
            # Annotation targets and evidence are deliberately excluded from inference.
            self.detailed_catalog[key] = {
                "severity": row["severity"],
                "mechanism": row["mechanism"],
                "source_url": row["source_url"],
            }
        if len(self.detailed_catalog) != self.metadata["reviewed_rows"]:
            raise ValueError("The catalog size differs from the exported model metadata.")

        # This file is the user's own Colab export. Do not load third-party pickle files.
        import joblib

        bundle = joblib.load(backend / "models" / "medsafe_suggestions.joblib")
        if bundle["metadata"] != self.metadata:
            raise ValueError("The model bundle and metadata.json belong to different exports.")
        self.pipeline = bundle["pipeline"]
        exported_templates = bundle["templates"]
        if set(exported_templates) != set(LABELS) or not all(isinstance(text, str) for text in exported_templates.values()):
            raise ValueError("The model bundle has invalid suggestion templates.")
        # Updating display wording must not change the trained pipeline or its features.
        self.templates = QUESTION_TEMPLATES
        self.general_message = GENERAL_QUESTION
        self.evaluation = json.loads(
            (app_dir / "training" / "results" / "evaluation.json").read_text(encoding="utf-8")
        )

        # The application reference is separate from the labeled training subset.
        reference_bytes = (backend / "data/reference_catalog.json").read_bytes()
        reference = json.loads(reference_bytes)
        if reference.get("schema_version") != 1:
            raise ValueError("Unsupported coverage reference format.")
        self.catalog = {}
        for record in reference["records"]:
            key = record["pair_id"]
            if key in self.catalog or key != pair_key(record["drug_a"], record["drug_b"]):
                raise ValueError("Invalid or duplicate reference pair.")
            if self.interactions.get(key) != record["severity"]:
                raise ValueError("The coverage reference conflicts with drugs.json.")
            tags = record["mechanism_tags"]
            status = record["classification_status"]
            if status not in ("available", "missing", "conflicting") or not set(tags) <= set(MECHANISM_TAGS):
                raise ValueError("Invalid mechanism classification.")
            if bool(tags) != (status == "available"):
                raise ValueError("Unavailable or conflicting classifications must not become model features.")
            source = urlsplit(record["source_url"])
            if source.scheme != "https" or source.netloc != "ddinter2.scbdd.com" or not (
                source.path.startswith("/server/interact/") or source.path == "/static/media/download/ddinter_downloads_code_A.csv"
            ):
                raise ValueError("Unexpected coverage reference URL.")
            self.catalog[key] = record
        if set(self.catalog) != set(self.interactions):
            raise ValueError("Coverage reference must contain every documented interaction pair.")
        coverage_meta = json.loads((backend / "models/coverage_metadata.json").read_text(encoding="utf-8"))
        if (coverage_meta["catalog_sha256"] != hashlib.sha256(reference_bytes).hexdigest()
                or coverage_meta["training_csv_sha256"] != checksum
                or coverage_meta["labels"] != list(LABELS)
                or coverage_meta["input_columns"] != ["severity", "mechanism_tags"]):
            raise ValueError("Coverage model does not match its reference, training data, or feature schema.")
        for package, expected in coverage_meta["versions"].items():
            if importlib.metadata.version(package) != expected:
                raise RuntimeError(f"Coverage model requires {package}=={expected}.")
        coverage_bundle = joblib.load(backend / "models/coverage_suggestions.joblib")
        if coverage_bundle["metadata"] != coverage_meta or set(coverage_bundle["models"]) != {"classified", "severity_only"}:
            raise ValueError("Coverage export metadata or classifier names do not match.")
        self.coverage_models = coverage_bundle["models"]
        self.coverage_metadata = coverage_meta
        self.pair_guidance = PairGuidance(app_dir, self.catalog)

    def prediction_basis(self, key):
        if key in self.detailed_catalog:
            return "detailed_mechanism"
        return "mechanism_classification" if self.catalog[key]["classification_status"] == "available" else "severity_only"

    def health(self) -> dict:
        self.pair_guidance.reload_snapshot()
        return {
            "status": "ready",
            "model_loaded": True,
            "reference_pairs": len(self.interactions),
            "model_supported_pairs": len(self.catalog),
            "supported_medicines": len(self.drugs),
            "coverage_by_basis": dict(Counter(self.prediction_basis(key) for key in self.catalog)),
            "training_rows": self.metadata["split_rows"]["train"],
            "experimental": True,
            "source_detail_pairs": len(self.pair_guidance.sources),
            "source_topic_model_loaded": True,
            "source_topic_training_rows": self.pair_guidance.metadata["split_rows"]["train"],
        }

    def guidance(self, first, second, allow_fetch=True):
        return self.pair_guidance.enrich(self.suggest(first, second), allow_fetch=allow_fetch)

    def suggest(self, first: object, second: object) -> dict:
        for name in (first, second):
            if not isinstance(name, str) or not name.strip() or len(name) > 200:
                raise ValueError("Choose two medicine names from the supported list.")
            if normalize_name(name) not in self.drugs:
                raise ValueError("A medicine is outside the supported drug list.")
        if normalize_name(first) == normalize_name(second):
            raise ValueError("Choose two different medicines.")
        key = pair_key(first, second)
        severity = self.interactions.get(key)
        result = {
            "drug_a": self.drugs[normalize_name(first)],
            "drug_b": self.drugs[normalize_name(second)],
            "severity": severity,
            "experimental": True,
            "categories": [],
            "questions": [GENERAL_QUESTION],
            "mechanism": None,
            "source_url": None,
        }
        if severity is None:
            return {
                **result,
                "status": "not_in_reference",
                "message": MISSING_REFERENCE_NOTE,
            }
        reference = self.catalog[key]
        basis = self.prediction_basis(key)
        message = MODEL_NOTE
        basis_label = basis_text(basis, reference["classification_status"])
        if basis == "detailed_mechanism":
            record = self.detailed_catalog[key]
            text = f"severity_{severity.lower()} {record['mechanism']}"
            prediction = self.pipeline.predict([text])[0].tolist()
            mechanism = record["mechanism"]
            source_url = record["source_url"]
        else:
            include_mechanisms = basis == "mechanism_classification"
            classifier = self.coverage_models["classified" if include_mechanisms else "severity_only"]
            prediction = classifier.predict([coverage_features(reference, include_mechanisms)])[0].tolist()
            source_url = reference["source_url"]
            if include_mechanisms:
                mechanism = "DDInter mechanism classification: " + ", ".join(TAG_LABELS[tag] for tag in reference["mechanism_tags"]) + "."
            else:
                mechanism = None
                message = LIMITED_NOTE
        if len(prediction) != len(LABELS) or any(flag not in (0, 1) for flag in prediction):
            raise RuntimeError("The model returned invalid guidance categories.")
        selected = [label for label, flag in zip(LABELS, prediction) if flag]
        return {
            **result,
            "status": "model_selected",
            "message": message,
            "mechanism": mechanism,
            "source_url": source_url,
            "prediction_basis": basis,
            "basis_label": basis_label,
            "categories": selected,
            "questions": [self.general_message] + [self.templates[label] for label in selected],
        }
