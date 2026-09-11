#!/usr/bin/env python3
"""Fetch the newest PGCB pages and upsert public/data JSON. Commit only if timestamps moved."""

from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from gridjson import (  # noqa: E402
    TZ,
    Hour,
    build_daily,
    build_latest,
    build_monthly,
    data_dir,
    envelope,
    hours_from_cell_rows,
    hours_from_latest_json,
    newest_iso,
    read_json,
    upsert_days,
    write_json,
)
from pgcb import fetch_recent_pages  # noqa: E402


def main() -> int:
    out = data_dir(ROOT)
    existing_latest = read_json(out / "latest.json")
    existing_daily = read_json(out / "daily.json") or {"days": []}
    previous_iso = (existing_latest or {}).get("current", {}).get("datetime")

    rows = fetch_recent_pages(pages=2)
    scraped = hours_from_cell_rows(rows)
    if not scraped:
        print("No rows parsed from PGCB.", file=sys.stderr)
        return 1

    merged: dict[str, Hour] = hours_from_latest_json(existing_latest)
    merged.update(scraped)
    new_iso = newest_iso(merged)
    if new_iso == previous_iso:
        print(f"No new timestamp (still {previous_iso}).")
        return 0

    updated_at = datetime.now(TZ).isoformat(timespec="seconds")
    hours: list[Hour] = sorted(merged.values(), key=lambda h: h.dt)
    today = datetime.now(TZ).date().isoformat()
    rebuilt_days = build_daily(list(scraped.values()))
    existing_days = existing_daily.get("days") or []
    existing_n = {d["date"]: int(d.get("n") or 0) for d in existing_days}
    keep = []
    for day in rebuilt_days:
        prev_n = existing_n.get(day["date"], 0)
        if day["date"] == today or day["n"] >= prev_n:
            keep.append(day)
    days = upsert_days(existing_days, keep)
    months = build_monthly(days)

    write_json(out / "latest.json", build_latest(hours, updated_at))
    write_json(out / "daily.json", envelope(updated_at, {"days": days}))
    write_json(out / "monthly.json", envelope(updated_at, {"months": months}))
    print(f"Updated {previous_iso} -> {new_iso} ({len(scraped)} scraped hours).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
