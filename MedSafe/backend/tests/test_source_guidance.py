"""Evidence boundaries and reproducibility of the source-guidance experiment."""
import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from model_runtime import SuggestionService, pair_key
from source_reader import fetch_source, parse_source
from source_topics import model_input, source_questions, training_labels


class SourceGuidanceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.service = SuggestionService()

    def test_management_targets_do_not_enter_features(self):
        record = {"severity": "Major", "interaction": "The medicines can affect glucose processing. Blood sugar should be monitored.",
                  "management": "UNIQUE_TARGET_TEXT Check blood pressure."}
        self.assertNotIn("UNIQUE_TARGET_TEXT", model_input(record))
        self.assertNotIn("should", model_input(record))
        self.assertIn("blood_sugar", training_labels(record))
        self.assertIn("blood_pressure", training_labels(record))

    def test_parser_rejects_wrong_pair(self):
        html = '<table><tr><th>ID</th><td>DDInter1 DDInter2</td></tr><tr><th>Interaction</th><td>A source explanation with more than five words.</td></tr></table>'
        self.assertEqual(parse_source(html, ["DDInter2", "DDInter1"])["verified_source_ids"], ["DDInter1", "DDInter2"])
        with self.assertRaises(ValueError):
            parse_source(html, ["DDInter1", "DDInter3"])
        with patch("source_reader.urlopen") as network:
            with self.assertRaises(ValueError):
                fetch_source("https://example.com/server/interact/1/", ["DDInter1", "DDInter2"])
            network.assert_not_called()

    def test_source_identity_and_content_are_checked(self):
        engine = self.service.pair_guidance
        key = pair_key("Calcium carbonate", "Dolutegravir")
        record = copy.deepcopy(engine.sources[key])
        self.assertTrue(engine.valid_source(record, key))
        record["interaction"] += " Changed."
        self.assertFalse(engine.valid_source(record, key))
        record = copy.deepcopy(engine.sources[key])
        record["verified_source_ids"] = ["DDInter1", "DDInter2"]
        self.assertFalse(engine.valid_source(record, key))

    def test_predictions_cannot_add_or_hide_source_questions(self):
        engine = self.service.pair_guidance
        key = pair_key("Calcium carbonate", "Dolutegravir")
        expected = {c["topic_id"] for c in source_questions(engine.sources[key])}
        with patch.object(engine.pipeline, "predict_proba", return_value=np.ones((1, len(engine.metadata["labels"])))):
            result = self.service.guidance("Calcium carbonate", "Dolutegravir", allow_fetch=False)["guidance"]
        self.assertEqual({c["topic_id"] for c in result["questions"]}, expected)
        self.assertEqual(set(result["highlighted_topics"]), expected & set(engine.metadata["labels"]))
        with patch.object(engine.pipeline, "predict_proba", return_value=np.zeros((1, len(engine.metadata["labels"])))):
            result = self.service.guidance("Calcium carbonate", "Dolutegravir", allow_fetch=False)["guidance"]
        self.assertEqual({c["topic_id"] for c in result["questions"]}, expected)
        self.assertEqual(result["highlighted_topics"], [])

    def test_plain_summary_requires_exact_source_text(self):
        engine = self.service.pair_guidance
        record = copy.deepcopy(engine.sources[pair_key("Calcium carbonate", "Dolutegravir")])
        self.assertIn(hashlib.sha256(record["interaction"].encode()).hexdigest(), engine.summaries)
        record["interaction"] += " A newly revised source statement."
        with patch.object(engine, "resolve", return_value=(record, None)):
            result = self.service.guidance("Calcium carbonate", "Dolutegravir")["guidance"]
        self.assertIsNone(result["summary"])

    def test_conditional_evidence_remains_complete(self):
        result = self.service.guidance("Loperamide", "Quinidine", allow_fetch=False)["guidance"]
        self.assertEqual(result["status"], "source_available")
        self.assertIn("more than the recommended", result["summary"]["what"])
        record = {"drug_a": "A", "drug_b": "B", "interaction": "Only at high doses, blood pressure may fall.", "management": "-"}
        cards = source_questions(record)
        self.assertEqual(cards[0]["source_excerpt"], record["interaction"])

    def test_unknown_and_conflicting_pairs_do_not_fetch(self):
        with patch("pair_guidance.fetch_source") as network:
            result = self.service.guidance("Abametapir (topical)", "Abarelix")
            self.assertEqual(result["guidance"]["status"], "not_in_reference")
            result = self.service.guidance("Dexamethasone", "Picosulfuric acid")
            self.assertEqual(result["guidance"]["status"], "details_unavailable")
            self.assertIn("disagree", result["guidance"]["message"])
            network.assert_not_called()

    def test_failed_fetch_returns_honest_fallback_and_is_throttled(self):
        engine = self.service.pair_guidance
        key = pair_key("Calcium carbonate", "Dolutegravir")
        original = engine.sources.pop(key)
        try:
            with tempfile.TemporaryDirectory() as directory, patch.object(engine, "cache_dir", Path(directory)), \
                    patch.object(engine, "reload_snapshot"), patch("pair_guidance.fetch_source", side_effect=OSError("offline")) as network:
                result = self.service.guidance("Calcium carbonate", "Dolutegravir")["guidance"]
                self.assertEqual(result["status"], "details_unavailable")
                self.assertNotIn("summary", result)
                self.service.guidance("Calcium carbonate", "Dolutegravir")
                self.assertEqual(network.call_count, 1)
        finally:
            engine.sources[key] = original
            engine.failures.pop(key, None)

    def test_topic_export_predictions_and_group_split(self):
        root = self.service.app_dir / "training/results"
        rows = json.loads((root / "source_topic_heldout.json").read_text(encoding="utf-8"))
        predictions = self.service.pair_guidance.pipeline.predict([r["input_text"] for r in rows]).tolist()
        self.assertEqual(predictions, [r["prediction"] for r in rows])
        manifest = json.loads((root / "source_topic_split.json").read_text(encoding="utf-8"))
        by_group = {}
        for row in manifest:
            by_group.setdefault(row["group_id"], set()).add(row["split"])
        self.assertTrue(all(len(splits) == 1 for splits in by_group.values()))
        self.assertEqual(len({r["pair_id"] for r in manifest}), 886)


if __name__ == "__main__":
    unittest.main()
