"""Report saved source coverage without making network requests or training claims."""
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from model_runtime import SuggestionService


def main():
    service = SuggestionService()
    sources = json.loads((ROOT / "backend/data/source_details.json").read_text(encoding="utf-8"))["records"]
    engine = service.pair_guidance
    withheld = {key for key, r in service.catalog.items() if key not in sources and
                (r["classification_status"] == "conflicting" or not r["source_observations"])}
    pending = set(service.catalog) - set(sources) - withheld
    summary_pairs = sum(hashlib.sha256(r["interaction"].encode()).hexdigest() in engine.summaries for r in sources.values())
    report = {"reference_pairs": len(service.catalog), "saved_pairs": len(sources),
              "saved_pairs_with_plain_summary": summary_pairs, "distinct_plain_summaries": len(engine.summaries),
              "uncached_pairs_with_eligible_source_links": len(pending),
              "withheld_or_missing_source_links": len(withheld),
              "snapshot_sha256": hashlib.sha256((ROOT / "backend/data/source_details.json").read_bytes()).hexdigest(),
              "complete_offline_detail_coverage": False,
              "note": "Snapshot audit only. Missing eligible pages can be fetched on demand; this is not a report of successful checks of every public page or clinical validation.",
              "withheld_pairs": sorted(withheld)}
    (ROOT / "training/results/source_coverage.json").write_text(json.dumps(report, indent=2)+"\n", encoding="utf-8")
    print(json.dumps({k:v for k,v in report.items() if k != "withheld_pairs"}, indent=2))


if __name__ == "__main__":
    main()
