"""Train the source-topic selector locally or in Colab from a frozen dataset."""
import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path
import sys

import joblib
import numpy as np
from sklearn.dummy import DummyClassifier
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report, f1_score
from sklearn.model_selection import GroupShuffleSplit
from sklearn.multiclass import OneVsRestClassifier
from sklearn.multioutput import MultiOutputClassifier
from sklearn.pipeline import Pipeline

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from source_topics import evidence_topics


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--examples", type=Path, default=ROOT / "training/source_topic_examples.json")
    parser.add_argument("--output", type=Path, default=ROOT / "training/topic_export")
    args = parser.parse_args()
    raw = args.examples.read_bytes()
    data = json.loads(raw)
    rows = data["examples"]
    groups = np.array([r["group_id"] for r in rows])
    x = np.array([r["input_text"] for r in rows])
    train, rest = next(GroupShuffleSplit(n_splits=1, test_size=0.30, random_state=42).split(x, groups=groups))
    val_local, test_local = next(GroupShuffleSplit(n_splits=1, test_size=0.50, random_state=43).split(x[rest], groups=groups[rest]))
    validation, test = rest[val_local], rest[test_local]
    partitions = {"train": train, "validation": validation, "test": test}
    for a, b in ((train, validation), (train, test), (validation, test)):
        assert not set(groups[a]) & set(groups[b])
    # Choose trainable topics from training support only, never from test scores.
    labels = [topic for topic in data["topics"] if 4 <= sum(rows[i]["labels"][topic] for i in train) <= len(train)-4
              and len({groups[i] for i in train if rows[i]["labels"][topic]}) >= 2]
    if len(labels) < 2:
        raise ValueError("Too few source families support topic training.")
    y = np.array([[r["labels"][topic] for topic in labels] for r in rows])
    candidates = []
    for c in (0.1, 1.0, 10.0):
        model = Pipeline([
            ("text", TfidfVectorizer(ngram_range=(1, 2), max_features=20000, min_df=1)),
            ("classifier", OneVsRestClassifier(LogisticRegression(C=c, solver="liblinear", class_weight="balanced", max_iter=2000, random_state=42))),
        ])
        model.fit(x[train], y[train])
        score = f1_score(y[validation], model.predict(x[validation]), average="macro", zero_division=0)
        candidates.append((score, c, model))
    score, c, model = max(candidates, key=lambda item: item[0])
    prediction = model.predict(x[test])
    baseline = MultiOutputClassifier(DummyClassifier(strategy="most_frequent")).fit(np.zeros((len(train), 1)), y[train])
    majority = baseline.predict(np.zeros((len(test), 1)))
    rule_pred = np.array([[int(topic in evidence_topics(text)) for topic in labels] for text in x[test]])
    reports = {name: {"macro_f1": f1_score(y[test], pred, average="macro", zero_division=0),
                       "per_topic": classification_report(y[test], pred, target_names=labels, output_dict=True, zero_division=0)}
               for name, pred in (("trained_topic_selector", prediction), ("majority_baseline", majority), ("mechanism_keyword_baseline", rule_pred))}
    metadata = {"schema_version": 1, "task": data["task"], "labels": labels,
                "untrained_topics": [t for t in data["topics"] if t not in labels],
                "selected_C": c, "validation_macro_f1": score,
                "candidates": [{"C": value, "validation_macro_f1": s} for s, value, _ in candidates],
                "examples_sha256": hashlib.sha256(raw).hexdigest(),
                "split_rows": {name: len(ids) for name, ids in partitions.items()},
                "split_groups": {name: len(set(groups[ids])) for name, ids in partitions.items()},
                "input": "Severity token and factual source mechanism text; excludes management text, source URLs, and target labels.",
                "annotation": data["label_method"], "grouping": data["grouping"],
                "versions": {p: importlib.metadata.version(p) for p in ("numpy", "pandas", "scikit-learn", "joblib")},
                "limitations": "Agreement with weak source-derived labels is not medical accuracy. Same reference source as earlier experiments; not an independent external evaluation. Topic highlighting is not clinical priority. Full source questions remain visible even when not selected.",
                "seed": 42}
    args.output.mkdir(parents=True, exist_ok=True)
    joblib.dump({"pipeline": model, "metadata": metadata}, args.output / "source_topic_selector.joblib")
    (args.output / "source_topic_metadata.json").write_text(json.dumps(metadata, indent=2)+"\n", encoding="utf-8")
    (args.output / "source_topic_evaluation.json").write_text(json.dumps(reports, indent=2)+"\n", encoding="utf-8")
    manifest = [{"pair_id": rows[i]["pair_id"], "group_id": rows[i]["group_id"], "split": name} for name, ids in partitions.items() for i in ids]
    (args.output / "source_topic_split.json").write_text(json.dumps(manifest, indent=2)+"\n", encoding="utf-8")
    heldout = [{"pair_id": rows[i]["pair_id"], "input_text": rows[i]["input_text"], "labels": y[i].tolist(), "prediction": prediction[j].tolist()} for j, i in enumerate(test)]
    (args.output / "source_topic_heldout.json").write_text(json.dumps(heldout, indent=2)+"\n", encoding="utf-8")
    print(json.dumps({"splits":metadata["split_rows"],"topics":labels,"test_macro_f1":{k:v['macro_f1'] for k,v in reports.items()}}, indent=2))


if __name__ == "__main__":
    main()
