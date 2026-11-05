"""Retrieve source-backed questions and let a trained model highlight topics."""
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
from pathlib import Path
import threading
import time

import joblib

from source_reader import fetch_source
from source_topics import TOPICS, model_input, source_questions


class PairGuidance:
    def __init__(self, app_dir, reference_catalog):
        self.app_dir = Path(app_dir)
        self.catalog = reference_catalog
        self.snapshot = self.app_dir / "backend/data/source_details.json"
        self.cache_dir = self.app_dir / "backend/.source_cache"
        self.sources = {}
        self.snapshot_stamp = None
        self.failures = {}
        self.locks = {}
        self.lock = threading.Lock()
        self.reload_snapshot()
        self.summaries = json.loads((self.app_dir / "backend/data/plain_source_summaries.json").read_text(encoding="utf-8"))["summaries"]
        metadata = json.loads((self.app_dir / "backend/models/source_topic_metadata.json").read_text(encoding="utf-8"))
        examples = (self.app_dir / "training/source_topic_examples.json").read_bytes()
        if metadata["examples_sha256"] != hashlib.sha256(examples).hexdigest() or not set(metadata["labels"]) <= set(TOPICS):
            raise ValueError("The source-topic model does not match its frozen training examples.")
        for package, version in metadata["versions"].items():
            if importlib.metadata.version(package) != version:
                raise ValueError(f"The source-topic model requires {package}=={version}.")
        bundle = joblib.load(self.app_dir / "backend/models/source_topic_selector.joblib")
        if bundle["metadata"] != metadata:
            raise ValueError("Source-topic export and metadata do not match.")
        self.pipeline = bundle["pipeline"]
        self.metadata = metadata

    def valid_source(self, record, key):
        reference = self.catalog.get(key)
        if not reference or record.get("pair_id") != key or record.get("severity") != reference["severity"]:
            return False
        observations = [o for o in reference["source_observations"] if o["source_url"] == record.get("source_url")]
        if not observations or sorted(record.get("verified_source_ids", [])) != sorted(observations[0]["source_ids"]):
            return False
        content_hash = hashlib.sha256((record["interaction"] + "\n" + record["management"]).encode()).hexdigest()
        return content_hash == record.get("source_sha256")

    def reload_snapshot(self):
        stamp = self.snapshot.stat().st_mtime_ns
        if stamp != self.snapshot_stamp:
            payload = json.loads(self.snapshot.read_text(encoding="utf-8"))
            if payload.get("schema_version") != 1:
                raise ValueError("Unsupported source snapshot format.")
            for key, record in payload["records"].items():
                if not self.valid_source(record, key):
                    raise ValueError(f"Source snapshot identity or integrity check failed: {key}")
            self.sources.update(payload["records"])
            self.snapshot_stamp = stamp

    def resolve(self, key, allow_fetch):
        self.reload_snapshot()
        if key in self.sources:
            return self.sources[key], None
        path = self.cache_dir / (hashlib.sha256(key.encode()).hexdigest() + ".json")
        if path.exists():
            try:
                record = json.loads(path.read_text(encoding="utf-8"))
                if self.valid_source(record, key):
                    self.sources[key] = record
                    return record, None
            except (ValueError, OSError, KeyError):
                pass
        reference = self.catalog[key]
        if reference["classification_status"] == "conflicting":
            return None, "The source records disagree. Detailed questions are withheld until this pair can be checked."
        if not reference["source_observations"]:
            return None, "We do not have a matching detail-page link for this pair."
        if not allow_fetch:
            return None, "A detailed source record has not been saved for this pair yet."
        if time.monotonic() - self.failures.get(key, -1e10) < 300:
            return None, "We could not reach the source recently. Try again later or open the source link."
        with self.lock:
            pair_lock = self.locks.setdefault(key, threading.Lock())
        if not pair_lock.acquire(blocking=False):
            return None, "The source is being checked. Try this pair again in a moment."
        try:
            observation = reference["source_observations"][0]
            detail = fetch_source(observation["source_url"], observation["source_ids"], timeout=5)
            if "quinine" in key and "quinidine" in detail["interaction"].casefold() and "quinine" not in detail["interaction"].casefold():
                raise ValueError("Source narrative medicine-name mismatch.")
            record = {"pair_id": key, "drug_a": reference["drug_a"], "drug_b": reference["drug_b"],
                      "severity": reference["severity"], **detail, "source_url": observation["source_url"],
                      "accessed_on": datetime.now(timezone.utc).date().isoformat(),
                      "source_sha256": hashlib.sha256((detail["interaction"] + "\n" + detail["management"]).encode()).hexdigest(),
                      "review_status": "Source IDs checked automatically; not clinically reviewed."}
            if not self.valid_source(record, key):
                raise ValueError("Source identity or integrity check failed.")
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            temporary = path.with_suffix(".tmp")
            temporary.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
            temporary.replace(path)
            self.sources[key] = record
            return record, None
        except Exception:
            self.failures[key] = time.monotonic()
            return None, "We could not load and check the source details. No medicine-specific advice was guessed."
        finally:
            pair_lock.release()

    def enrich(self, result, allow_fetch=True):
        if result["severity"] is None:
            return {**result, "guidance": {"status": "not_in_reference"}}
        key = "|||".join(sorted((result["drug_a"].casefold(), result["drug_b"].casefold())))
        record, reason = self.resolve(key, allow_fetch)
        if record is None:
            return {**result, "guidance": {"status": "details_unavailable", "message": reason}}
        cards = source_questions(record)
        # Predict from mechanism facts only. Source evidence then gates output:
        # an unsupported predicted topic can never become a displayed question.
        probabilities = self.pipeline.predict_proba([model_input(record)])[0]
        scores = dict(zip(self.metadata["labels"], probabilities))
        selected = {card["topic_id"] for card in cards if scores.get(card["topic_id"], 0) >= 0.5}
        for card in cards:
            card["model_selected"] = card["topic_id"] in selected
        # Keep the default presentation independent of experimental predictions.
        cards.sort(key=lambda card: card["title"])
        summary_hash = hashlib.sha256(record["interaction"].encode()).hexdigest()
        summary = self.summaries.get(summary_hash)
        return {**result, "guidance": {
            "status": "source_available", "source_url": record["source_url"], "accessed_on": record["accessed_on"],
            "summary": summary,
            "summary_note": "Plain-language source summary written with AI assistance; not independently checked by a clinician." if summary else "A plain-language explanation has not been reviewed for this source record yet. The questions below are linked to topics in the source.",
            "source_interaction": record["interaction"],
            "questions": cards, "highlighted_topics": sorted(selected),
            "model_note": "This experimental model learned discussion topics from source descriptions. It performed worse than a simple keyword method in our test, so its highlights are off by default. Highlights do not show which risk is most serious. All source-supported questions remain visible.",
            "safety_note": "These questions come from topics mentioned in the source. A mention does not mean these medicines cause that problem. Your doctor or pharmacist can check which points apply to your dose, exact products, health, and treatment. Do not change treatment based on this app.",
            "review_status": record["review_status"],
        }}
