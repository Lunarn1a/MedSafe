"""Shared, label-free features for the expanded coverage models."""

MECHANISM_TAGS = (
    "absorption", "distribution", "metabolism", "excretion",
    "synergistic_effect", "antagonistic_effect", "others",
)
TAG_LABELS = {
    "absorption": "absorption",
    "distribution": "distribution",
    "metabolism": "metabolism",
    "excretion": "excretion",
    "synergistic_effect": "synergistic effects",
    "antagonistic_effect": "antagonistic effects",
    "others": "other mechanisms",
}


def coverage_features(record, include_mechanisms=True):
    features = {"severity": record["severity"]}
    if include_mechanisms and record["classification_status"] == "available":
        for tag in record["mechanism_tags"]:
            if tag not in MECHANISM_TAGS:
                raise ValueError(f"Unsupported source mechanism classification: {tag}")
            features[f"mechanism:{tag}"] = True
    return features
