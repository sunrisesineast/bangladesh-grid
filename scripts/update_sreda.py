#!/usr/bin/env python3
"""Fetch SREDA's solar register and write data/sreda-solar.json if it moved."""

from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from gridjson import TZ, data_dir, read_json, write_json  # noqa: E402
from sreda import SOURCE_NAME, SOURCE_URL, fetch_solar  # noqa: E402


def _core(payload: dict | None) -> dict | None:
    if not payload:
        return None
    return {
        "database_updated_at": payload.get("database_updated_at"),
        "current": payload.get("current"),
        "history": payload.get("history"),
    }


def main() -> int:
    out = data_dir(ROOT) / "sreda-solar.json"
    existing = read_json(out)
    fetched = fetch_solar()
    if _core(existing) == _core(fetched):
        current = fetched["current"]
        print(
            "No SREDA change "
            f"(register {fetched.get('database_updated_at')}, "
            f"solar {current['solar_mwp']} MWp, "
            f"{len(fetched['history'])} history points)."
        )
        return 0

    updated_at = datetime.now(TZ).isoformat(timespec="seconds")
    payload = {
        "source": SOURCE_URL,
        "source_name": SOURCE_NAME,
        "timezone": "Asia/Dhaka",
        "updated_at": updated_at,
        **fetched,
    }
    write_json(out, payload)
    current = fetched["current"]
    print(
        f"Updated SREDA solar: {current['solar_mwp']} MWp "
        f"({current['on_grid_mwp']} on-grid, {current['parks_mwp']} parks), "
        f"{len(fetched['history'])} history points, "
        f"register {fetched.get('database_updated_at')}."
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"SREDA update failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
