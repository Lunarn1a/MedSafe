"""Collect public source text; medicine-pair IDs are verified before saving.

Run on an internet-connected machine to extend the included source snapshot.
The source descriptions are not clinician-reviewed annotations or treatment plans.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from source_reader import fetch_source, parse_source


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--import-cache", type=Path)
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--workers", type=int, choices=range(1, 5), default=3)
    args = parser.parse_args()
    data_dir = ROOT / "backend/data"
    catalog = json.loads((data_dir / "reference_catalog.json").read_text(encoding="utf-8"))["records"]
    original = {}
    import csv
    with (data_dir / "medsafe_suggestions_300.csv").open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            original["|||".join(sorted((row["drug_a"].casefold(), row["drug_b"].casefold())))] = row["source_url"]
    target = data_dir / "source_details.json"
    saved = json.loads(target.read_text(encoding="utf-8"))["records"] if target.exists() else {}
    failures = []
    queue = []
    for record in catalog:
        key = record["pair_id"]
        if key in saved:
            continue
        observations = record["source_observations"]
        if not observations or (record["classification_status"] == "conflicting" and key not in original):
            continue
        preferred = original.get(key, record["source_url"])
        observation = next((o for o in observations if o["source_url"] == preferred), observations[0])
        queue.append((record, observation))

    def collect(item):
        record, observation = item
        ident = observation["source_url"].rstrip("/").split("/")[-1]
        cache = args.import_cache / f"_server_interact_{ident}_" if args.import_cache else None
        try:
            if cache and cache.exists():
                detail = parse_source(cache.read_text(encoding="utf-8"), observation["source_ids"])
                accessed = "2026-10-30"
            elif args.offline:
                return record["pair_id"], None, None
            else:
                detail = fetch_source(observation["source_url"], observation["source_ids"], timeout=10)
                accessed = datetime.now(timezone.utc).date().isoformat()
                time.sleep(0.2)
            # A known source naming inconsistency is withheld, not silently fixed.
            if "quinine" in record["pair_id"] and "quinidine" in detail["interaction"].casefold() and "quinine" not in detail["interaction"].casefold():
                raise ValueError("Source narrative names quinidine for a quinine pair.")
            return record["pair_id"], {
                "pair_id": record["pair_id"], "drug_a": record["drug_a"], "drug_b": record["drug_b"],
                "severity": record["severity"], **detail, "source_url": observation["source_url"],
                "accessed_on": accessed, "source_sha256": hashlib.sha256((detail["interaction"] + "\n" + detail["management"]).encode()).hexdigest(),
                "review_status": "Source IDs checked automatically; not clinically reviewed.",
            }, None
        except Exception as error:
            return record["pair_id"], None, str(error)

    def write_snapshot():
        payload = {"schema_version": 1, "source": "DDInter 2.0", "license": "CC BY-NC-SA 4.0",
                   "records": dict(sorted(saved.items()))}
        temporary = target.with_suffix(".tmp")
        temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporary.replace(target)

    if args.limit:
        queue = queue[:args.limit]
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(collect, item) for item in queue]
        for count, future in enumerate(as_completed(futures), 1):
            key, detail, error = future.result()
            if detail:
                saved[key] = detail
            if error:
                failures.append({"pair_id": key, "error": error})
            if count % 50 == 0:
                write_snapshot()
                print(f"Checked {count}/{len(queue)}; saved {len(saved)}; failures {len(failures)}", flush=True)
    write_snapshot()
    report = {"saved_pairs": len(saved), "reference_pairs": len(catalog), "failures": failures,
              "note": "Counts at the end of this collection run, not a live coverage audit. Run audit_source_coverage.py for the current saved snapshot.",
              "offline": args.offline, "queued_this_run": len(queue)}
    (ROOT / "training/results/source_collection.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"saved_pairs": len(saved), "failed_this_run": len(failures)}, indent=2), flush=True)


if __name__ == "__main__":
    main()
