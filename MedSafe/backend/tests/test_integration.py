"""Check exported prediction parity and the public local-server contract."""

import csv
import json
from pathlib import Path
import sys
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from model_runtime import LABELS, SuggestionService, pair_key
from feature_schema import coverage_features
from server import create_server


class IntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.service = SuggestionService()
        cls.server = create_server(cls.service, port=0)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)

    def request(self, path, payload=None, content_type="application/json"):
        data = json.dumps(payload).encode() if payload is not None else None
        request = Request(self.base_url + path, data=data, headers={"Content-Type": content_type})
        try:
            response = urlopen(request, timeout=10)
        except HTTPError as error:
            response = error
        with response:
            return response.status, response.read()

    def test_all_60_exported_predictions_match(self):
        path = self.service.app_dir / "training/results/heldout_predictions.csv"
        with path.open(encoding="utf-8-sig", newline="") as handle:
            rows = list(csv.DictReader(handle))
        self.assertEqual(len(rows), 60)
        for row in rows:
            with self.subTest(pair=row["pair_id"]):
                result = self.service.suggest(row["drug_a"], row["drug_b"])
                expected = [label for label in LABELS if int(row[f"predicted_{label}"])]
                self.assertEqual(result["status"], "model_selected")
                self.assertEqual(result["categories"], expected)
                self.assertEqual(result["severity"], row["severity"])

    def test_names_are_case_and_order_independent(self):
        original = self.service.suggest("Calcium carbonate", "Dolutegravir")
        reverse = self.service.suggest(" DOLUTEGRAVIR ", "calcium   carbonate")
        for key in ("categories", "questions", "severity", "mechanism", "source_url"):
            self.assertEqual(original[key], reverse[key])

    def test_previously_unsupported_pair_uses_coverage_model(self):
        result = self.service.suggest("Calcium citrate", "Dolutegravir")
        self.assertEqual(result["status"], "model_selected")
        self.assertEqual(result["prediction_basis"], "mechanism_classification")
        self.assertEqual(result["severity"], "Major")
        self.assertIn("classification", result["mechanism"])

    def test_every_reference_pair_has_working_suggestions(self):
        medicines = set()
        for key, severity in self.service.interactions.items():
            with self.subTest(pair=key):
                first, second = key.split("|||")
                medicines.update((first, second))
                result = self.service.suggest(first, second)
                self.assertEqual(result["status"], "model_selected")
                self.assertEqual(result["severity"], severity)
                self.assertGreaterEqual(len(result["questions"]), 1)
                self.assertEqual(len(result["questions"]), 1 + len(result["categories"]))
                self.assertTrue(set(result["categories"]) <= set(LABELS))
                self.assertIn(result["prediction_basis"], ("detailed_mechanism", "mechanism_classification", "severity_only"))
        self.assertEqual(len(self.service.interactions), 7545)
        self.assertEqual(medicines, set(self.service.drugs))

    def test_missing_and_conflicting_mechanisms_are_disclosed(self):
        keys = [key for key in self.service.catalog if self.service.prediction_basis(key) == "severity_only"]
        self.assertEqual(len(keys), 16)
        for key in keys:
            with self.subTest(pair=key):
                record = self.service.catalog[key]
                self.assertEqual(coverage_features(record), {"severity": record["severity"]})
                result = self.service.suggest(*key.split("|||"))
                self.assertIsNone(result["mechanism"])
                self.assertIn("only the listed risk level", result["basis_label"])
                self.assertIn("limited information", result["message"])

    def test_coverage_models_match_exported_test_predictions(self):
        rows = json.loads((self.service.app_dir / "training/results/coverage_heldout_predictions.json").read_text())
        self.assertEqual(len(rows), 60)
        for row in rows:
            record = self.service.catalog[row["pair_id"]]
            for name in ("classified", "severity_only"):
                with self.subTest(pair=row["pair_id"], classifier=name):
                    prediction = self.service.coverage_models[name].predict([coverage_features(record, name == "classified")])[0].tolist()
                    self.assertEqual(prediction, row[name])

    def test_coverage_features_ignore_labels_and_names(self):
        record = dict(self.service.catalog["calcium citrate|||dolutegravir"])
        before = coverage_features(record)
        record.update({"drug_a": "Changed", "source_url": "Changed", "management_source": "Changed", **{label: 1 for label in LABELS}})
        self.assertEqual(coverage_features(record), before)

    def test_missing_reference_is_not_safe(self):
        names = list(self.service.drugs)
        pair = next((a, b) for a in names for b in names if a != b and pair_key(a, b) not in self.service.interactions)
        result = self.service.suggest(*pair)
        self.assertEqual(result["status"], "not_in_reference")
        self.assertIsNone(result["severity"])
        self.assertEqual(result["categories"], [])
        self.assertIn("does not mean it is safe", result["message"])

    def test_source_guidance_http_contract(self):
        status, body = self.request("/api/guidance", {"drug_a": "Calcium carbonate", "drug_b": "Dolutegravir"})
        self.assertEqual(status, 200)
        result = json.loads(body)
        self.assertEqual(result["guidance"]["status"], "source_available")
        self.assertIn("dolutegravir", result["guidance"]["summary"]["what"])
        self.assertEqual(self.request("/api/guidance", {"drug_a": "Calcium carbonate", "drug_b": "Dolutegravir", "management": "invented"})[0], 400)

    def test_invalid_names_rejected(self):
        for pair in [(None, "Dolutegravir"), ("", "Dolutegravir"), ("invented medicine", "Dolutegravir"), ("Dolutegravir", "DOLUTEGRAVIR")]:
            with self.subTest(pair=pair), self.assertRaises(ValueError):
                self.service.suggest(*pair)

    def test_http_health_and_prediction(self):
        status, body = self.request("/api/health")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["model_supported_pairs"], 7545)
        self.assertEqual(sum(json.loads(body)["coverage_by_basis"].values()), 7545)
        payload = {"drug_a": "Calcium carbonate", "drug_b": "Dolutegravir"}
        status, body = self.request("/api/suggestions", payload)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), self.service.suggest(*payload.values()))

    def test_clients_cannot_supply_features(self):
        payload = {"drug_a": "Calcium carbonate", "drug_b": "Dolutegravir", "severity": "Minor"}
        self.assertEqual(self.request("/api/suggestions", payload)[0], 400)
        self.assertEqual(self.request("/api/suggestions", [], "application/json")[0], 400)
        self.assertEqual(self.request("/api/suggestions", {}, "text/plain")[0], 415)
        self.assertEqual(self.request("/api/suggestions", {"drug_a": "x" * 5000})[0], 413)

    def test_second_server_cannot_claim_the_same_port(self):
        with self.assertRaises(OSError):
            create_server(self.service, self.server.server_port)

    def test_private_files_not_served(self):
        for path in ["/backend/models/medsafe_suggestions.joblib", "/backend/data/medsafe_suggestions_300.csv", "/training/results/evaluation.json", "/../README.md", "/%2e%2e/README.md"]:
            with self.subTest(path=path):
                self.assertEqual(self.request(path)[0], 404)
        for path in ["/", "/model-suggestions.js", "/drugs-data.js"]:
            with self.subTest(path=path):
                self.assertEqual(self.request(path)[0], 200)


if __name__ == "__main__":
    unittest.main()
