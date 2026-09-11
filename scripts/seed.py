#!/usr/bin/env python3
"""Seed public/data JSON from a local PGCB hourly CSV. The CSV is not committed."""

from __future__ import annotations

import argparse
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
    hours_from_csv,
    write_json,
)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv", type=Path, help="Path to powergrid_generations.csv")
    args = parser.parse_args()
    csv_path = args.csv.expanduser().resolve()
    if not csv_path.exists():
        sys.exit(f"CSV not found: {csv_path}")

    hours_map = hours_from_csv(csv_path)
    if not hours_map:
        sys.exit("No hourly rows parsed from CSV.")
    hours: list[Hour] = sorted(hours_map.values(), key=lambda h: h.dt)
    updated_at = datetime.now(TZ).isoformat(timespec="seconds")
    days = build_daily(hours)
    months = build_monthly(days)
    out = data_dir(ROOT)
    write_json(out / "latest.json", build_latest(hours, updated_at))
    write_json(out / "daily.json", envelope(updated_at, {"days": days}))
    write_json(out / "monthly.json", envelope(updated_at, {"months": months}))
    print(
        f"Seeded {len(hours):,} hours, {len(days):,} days, {len(months)} months "
        f"({hours[0].dt.date()} to {hours[-1].dt.date()}) into {out}"
    )


if __name__ == "__main__":
    main()
