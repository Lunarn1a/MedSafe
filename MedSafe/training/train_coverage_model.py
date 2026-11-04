"""Train coverage classifiers using the original labeled rows and fixed group split.

The reference catalog supplies only features. It does not create new target labels.
The same script runs locally or in Colab alongside feature_schema.py.
"""

import argparse
import csv
import hashlib
import importlib.metadata
import json
from pathlib import Path
import platform
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from feature_schema import coverage_features

import joblib
import numpy as np
from sklearn.dummy import DummyClassifier
from sklearn.feature_extraction import DictVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report, f1_score
from sklearn.multiclass import OneVsRestClassifier
from sklearn.multioutput import MultiOutputClassifier
from sklearn.pipeline import Pipeline

LABELS = ["label_review", "label_monitoring", "label_timing"]


def checksum(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_csv(path):
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=ROOT / "backend/data/reference_catalog.json")
    parser.add_argument("--training-csv", type=Path, default=ROOT / "backend/data/medsafe_suggestions_300.csv")
    parser.add_argument("--split-manifest", type=Path, default=ROOT / "training/results/split_manifest.csv")
    parser.add_argument("--output", type=Path, default=ROOT / "training/coverage_export")
    args = parser.parse_args()
    source = json.loads(args.catalog.read_text(encoding="utf-8"))
    records = {row["pair_id"]: row for row in source["records"]}
    rows = read_csv(args.training_csv)
    manifest_rows = read_csv(args.split_manifest)
    manifest = {row["pair_id"]: row for row in manifest_rows}
    if len(manifest) != len(manifest_rows):
        raise ValueError("Duplicate pairs in split manifest.")
    pair_ids = ["|||".join(sorted((row["drug_a"].casefold(), row["drug_b"].casefold()))) for row in rows]
    if len(set(pair_ids)) != len(rows) or set(pair_ids) != set(manifest):
        raise ValueError("Training rows must exactly match the original split manifest.")
    partitions = {name: [i for i, key in enumerate(pair_ids) if manifest[key]["split"] == name]
                  for name in ("train", "validation", "test")}
    group_sets = {name: {rows[i]["group_id"] for i in indexes} for name, indexes in partitions.items()}
    for left, right in (("train", "validation"), ("train", "test"), ("validation", "test")):
        if group_sets[left] & group_sets[right]:
            raise ValueError("A source group crosses data partitions.")
    for row, key in zip(rows, pair_ids):
        if row["reviewed"] != "1" or any(row[label] not in ("0", "1") for label in LABELS):
            raise ValueError("Incomplete research annotations.")
        if row["group_id"] != manifest[key]["group_id"] or row["severity"] != records[key]["severity"]:
            raise ValueError("Reference features or groups conflict with the training data.")
    y = np.array([[int(row[label]) for label in LABELS] for row in rows])
    train, validation, test = (partitions[name] for name in ("train", "validation", "test"))
    for indexes in partitions.values():
        if any(len(np.unique(y[indexes, j])) != 2 for j in range(len(LABELS))):
            raise ValueError("A split lacks positive or negative examples for a target.")
    selected, tuning, predictions = {}, {}, {}
    for name, include_mechanisms in (("classified", True), ("severity_only", False)):
        x = [coverage_features(records[key], include_mechanisms) for key in pair_ids]
        candidates = []
        for c in (0.1, 1.0, 10.0):
            pipeline = Pipeline([
                ("features", DictVectorizer()),
                ("classifier", OneVsRestClassifier(LogisticRegression(
                    C=c, class_weight="balanced", solver="liblinear", max_iter=2000, random_state=42))),
            ])
            pipeline.fit([x[i] for i in train], y[train])
            score = f1_score(y[validation], pipeline.predict([x[i] for i in validation]), average="macro", zero_division=0)
            candidates.append((score, c, pipeline))
        score, c, pipeline = max(candidates, key=lambda item: item[0])
        selected[name] = pipeline
        tuning[name] = {"selected_C": c, "validation_macro_f1": score,
                        "candidates": [{"C": c, "validation_macro_f1": score} for score, c, _ in candidates]}
        # Test data is used only after hyperparameter selection; no refitting on test labels.
        predictions[name] = pipeline.predict([x[i] for i in test])
    majority = MultiOutputClassifier(DummyClassifier(strategy="most_frequent"))
    majority.fit(np.zeros((len(train), 1)), y[train])
    predictions["majority"] = majority.predict(np.zeros((len(test), 1)))
    evaluation = {
        "test_rows": len(test),
        "models": {name: {"macro_f1": f1_score(y[test], pred, average="macro", zero_division=0),
                          "per_label_report": classification_report(y[test], pred, target_names=LABELS, zero_division=0, output_dict=True)}
                   for name, pred in predictions.items()},
        "limitations": "Same previously inspected research test set; not a fresh external evaluation. AI-assisted labels, no clinical validation. Wider reference coverage does not establish accuracy on unseen pairs.",
    }
    metadata = {
        "schema_version": 1, "task": "multi_label_guidance_selection", "labels": LABELS,
        "input_columns": ["severity", "mechanism_tags"],
        "excluded_inputs": ["drug_a", "drug_b", "pair_id", "source_urls", "management_source", *LABELS],
        "training_csv_sha256": checksum(args.training_csv), "catalog_sha256": checksum(args.catalog),
        "split_manifest_sha256": checksum(args.split_manifest),
        "labeled_rows": len(rows), "split_rows": {name: len(indexes) for name, indexes in partitions.items()},
        "reference_pairs": len(records), "model_selection": tuning, "seed": 42,
        "versions": {package: importlib.metadata.version(package) for package in ("numpy", "pandas", "scikit-learn", "joblib")},
        "python_version": platform.python_version(),
        "limitations": evaluation["limitations"],
    }
    args.output.mkdir(parents=True, exist_ok=True)
    joblib.dump({"models": selected, "metadata": metadata}, args.output / "coverage_suggestions.joblib")
    for filename, data in (("coverage_metadata.json", metadata), ("coverage_evaluation.json", evaluation)):
        (args.output / filename).write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    (args.output / "requirements.txt").write_text("\n".join(f"{p}=={v}" for p, v in metadata["versions"].items()) + "\n", encoding="utf-8")
    heldout = [{"pair_id": pair_ids[i], "labels": y[i].tolist(),
                **{name: pred[j].tolist() for name, pred in predictions.items()}} for j, i in enumerate(test)]
    (args.output / "coverage_heldout_predictions.json").write_text(json.dumps(heldout, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"split_rows": metadata["split_rows"], "test_macro_f1": {name: result["macro_f1"] for name, result in evaluation["models"].items()}, "export": str(args.output)}, indent=2))


if __name__ == "__main__":
    main()
