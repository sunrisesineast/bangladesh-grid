#!/usr/bin/env python3
"""Fetch recent NLDC Page 1 PDFs and upsert data/nldc-*.json. Commit only if a report moved."""

from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from gridjson import TZ, data_dir, read_json, write_json  # noqa: E402
from nldc import SOURCE_NAME, ARCHIVE_URL, fetch_missing_reports  # noqa: E402


def envelope(updated_at: str, extra: dict) -> dict:
    return {
        "source": ARCHIVE_URL,
        "source_name": SOURCE_NAME,
        "timezone": "Asia/Dhaka",
        "updated_at": updated_at,
        **extra,
    }


def days_from_json(payload: dict | None) -> list[dict]:
    if not payload:
        return []
    return list(payload.get("days") or [])


def _core(row: dict) -> dict:
    return {k: v for k, v in row.items() if k != "source_pdf"}


def main() -> int:
    out = data_dir(ROOT)
    existing_daily = read_json(out / "nldc-daily.json")
    existing_days = days_from_json(existing_daily)
    by_date = {d["date"]: d for d in existing_days if d.get("date")}
    fetched_pdfs = set(existing_daily.get("fetched_pdfs") or []) if existing_daily else set()
    fetched_pdfs.update(d["source_pdf"] for d in existing_days if d.get("source_pdf"))

    reports = fetch_missing_reports(fetched_pdfs)
    previous_fetched = set(fetched_pdfs)
    if not reports and previous_fetched == fetched_pdfs:
        newest = max(by_date) if by_date else None
        print(f"No new NLDC reports (still {newest}).")
        return 0

    changed = False
    for report in reports:
        fetched_pdfs.add(report.source_pdf)
        row = report.as_dict()
        previous = by_date.get(row["date"])
        if previous and _core(previous) == _core(row):
            continue
        by_date[row["date"]] = row
        changed = True

    if not changed and fetched_pdfs == previous_fetched:
        print("Fetched PDFs already match stored reports.")
        return 0

    days = [by_date[k] for k in sorted(by_date)]
    current = days[-1]
    updated_at = datetime.now(TZ).isoformat(timespec="seconds")
    write_json(
        out / "nldc-daily.json",
        envelope(
            updated_at,
            {"days": days, "fetched_pdfs": sorted(fetched_pdfs)},
        ),
    )
    write_json(out / "nldc-latest.json", envelope(updated_at, {"current": current}))
    print(
        f"Updated NLDC series: {len(reports)} parsed, {len(days)} days stored "
        f"(latest {current['date']})."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
