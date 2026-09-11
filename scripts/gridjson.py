"""Turn PGCB hourly rows into latest / daily / monthly JSON."""

from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Asia/Dhaka")
SOURCE_URL = "https://erp.powergrid.gov.bd/w/generations/view_generations"
SOURCE_NAME = "Power Grid Bangladesh PLC"

FUEL_KEYS = (
    "gas",
    "liquid_fuel",
    "coal",
    "hydro",
    "solar",
    "wind",
    "bheramara",
    "tripura",
    "adani",
    "nepal",
)

CELL_TO_KEY = {
    2: "generation_mw",
    3: "gas",
    4: "liquid_fuel",
    5: "coal",
    6: "hydro",
    7: "solar",
    8: "wind",
    9: "bheramara",
    10: "tripura",
    11: "adani",
    12: "nepal",
}


@dataclass(frozen=True, slots=True)
class Hour:
    dt: datetime
    generation_mw: float
    gas: float
    liquid_fuel: float
    coal: float
    hydro: float
    solar: float
    wind: float
    bheramara: float
    tripura: float
    adani: float
    nepal: float
    remark: str

    @property
    def iso(self) -> str:
        return self.dt.isoformat()

    def as_dict(self) -> dict:
        return {
            "datetime": self.iso,
            "generation_mw": _round(self.generation_mw),
            "gas": _round(self.gas),
            "liquid_fuel": _round(self.liquid_fuel),
            "coal": _round(self.coal),
            "hydro": _round(self.hydro),
            "solar": _round(self.solar),
            "wind": _round(self.wind),
            "bheramara": _round(self.bheramara),
            "tripura": _round(self.tripura),
            "adani": _round(self.adani),
            "nepal": _round(self.nepal),
            "remark": self.remark,
        }


def _round(value: float) -> float:
    return round(float(value), 2)


MAX_MW = 25_000  # national peak is ~18 GW; extra digits in the HTML are typos


def _plausible(hour: Hour) -> bool:
    if not (0 <= hour.generation_mw <= MAX_MW):
        return False
    fuels = [getattr(hour, key) for key in FUEL_KEYS]
    if any(value < 0 or value > MAX_MW for value in fuels):
        return False
    mix = sum(fuels)
    slack = max(400.0, 0.2 * hour.generation_mw)
    if abs(mix - hour.generation_mw) > slack:
        return False
    return True


def _parse_number(raw: str) -> float:
    text = (raw or "").strip().replace(",", "")
    if text in ("", "-", "--", "—", "N/A", "NA"):
        return 0.0
    try:
        return float(text)
    except ValueError:
        return 0.0


def _parse_dt(date_s: str, time_s: str) -> datetime | None:
    date_s = (date_s or "").strip()
    time_s = (time_s or "").strip()
    if date_s in ("", "-", "--", "—"):
        return None
    parsed_date = None
    for fmt in ("%d-%m-%Y", "%Y-%m-%d", "%d/%m/%Y"):
        try:
            parsed_date = datetime.strptime(date_s, fmt).date()
            break
        except ValueError:
            continue
    if parsed_date is None or not (2015 <= parsed_date.year <= 2035):
        return None
    parsed_time = None
    for fmt in ("%H:%M:%S", "%H:%M"):
        try:
            parsed_time = datetime.strptime(time_s, fmt).time()
            break
        except ValueError:
            continue
    if parsed_time is None:
        return None
    return datetime.combine(parsed_date, parsed_time, tzinfo=TZ)


def hour_from_cells(cells: list[str]) -> Hour | None:
    if len(cells) < 13:
        return None
    dt = _parse_dt(cells[0], cells[1])
    if dt is None:
        return None
    values = {key: _parse_number(cells[idx]) for idx, key in CELL_TO_KEY.items()}
    remark = cells[13].strip() if len(cells) > 13 else ""
    hour = Hour(dt=dt, remark=remark, **values)
    if not _plausible(hour):
        return None
    return hour


def hours_from_cell_rows(rows: list[list[str]]) -> dict[str, Hour]:
    """Newest-first rows; first occurrence of each timestamp wins."""
    by_iso: dict[str, Hour] = {}
    for cells in rows:
        hour = hour_from_cells(cells)
        if hour is None:
            continue
        by_iso.setdefault(hour.iso, hour)
    return by_iso


def hours_from_csv(path: Path) -> dict[str, Hour]:
    import csv

    by_iso: dict[str, Hour] = {}
    with path.open(newline="", encoding="utf-8") as fh:
        reader = csv.reader(fh)
        header = next(reader, None)
        if header is None:
            return {}
        for cells in reader:
            hour = hour_from_cells(cells)
            if hour is None:
                continue
            by_iso.setdefault(hour.iso, hour)
    return by_iso


def hours_from_latest_json(payload: dict | None) -> dict[str, Hour]:
    if not payload:
        return {}
    by_iso: dict[str, Hour] = {}
    for row in payload.get("hourly") or []:
        dt = datetime.fromisoformat(row["datetime"])
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=TZ)
        hour = Hour(
            dt=dt,
            generation_mw=float(row.get("generation_mw") or 0),
            gas=float(row.get("gas") or 0),
            liquid_fuel=float(row.get("liquid_fuel") or 0),
            coal=float(row.get("coal") or 0),
            hydro=float(row.get("hydro") or 0),
            solar=float(row.get("solar") or 0),
            wind=float(row.get("wind") or 0),
            bheramara=float(row.get("bheramara") or 0),
            tripura=float(row.get("tripura") or 0),
            adani=float(row.get("adani") or 0),
            nepal=float(row.get("nepal") or 0),
            remark=str(row.get("remark") or ""),
        )
        by_iso[hour.iso] = hour
    return by_iso


def _mean_record(hours: list[Hour], key: str, n: int) -> dict:
    fuels = {k: _round(sum(getattr(h, k) for h in hours) / n) for k in FUEL_KEYS}
    return {
        key: None,
        "n": n,
        "generation_mw": _round(sum(h.generation_mw for h in hours) / n),
        **fuels,
    }


def build_daily(hours: list[Hour]) -> list[dict]:
    grouped: dict[str, list[Hour]] = defaultdict(list)
    for hour in hours:
        grouped[hour.dt.date().isoformat()].append(hour)
    days = []
    for date in sorted(grouped):
        bucket = grouped[date]
        rec = _mean_record(bucket, "date", len(bucket))
        rec["date"] = date
        days.append(rec)
    return days


def build_monthly(days: list[dict]) -> list[dict]:
    grouped: dict[str, list[dict]] = defaultdict(list)
    for day in days:
        grouped[day["date"][:7]].append(day)
    months = []
    for month in sorted(grouped):
        bucket = grouped[month]
        weight = sum(int(d["n"]) for d in bucket) or 1
        fuels = {
            k: _round(sum(float(d[k]) * int(d["n"]) for d in bucket) / weight)
            for k in FUEL_KEYS
        }
        gen = _round(
            sum(float(d["generation_mw"]) * int(d["n"]) for d in bucket) / weight
        )
        months.append(
            {
                "month": month,
                "n": len(bucket),
                "generation_mw": gen,
                **fuels,
            }
        )
    return months


def upsert_days(existing: list[dict], rebuilt: list[dict]) -> list[dict]:
    by_date = {d["date"]: d for d in existing}
    by_date.update({d["date"]: d for d in rebuilt})
    return [by_date[k] for k in sorted(by_date)]


def envelope(updated_at: str, extra: dict) -> dict:
    return {
        "source": SOURCE_URL,
        "source_name": SOURCE_NAME,
        "timezone": "Asia/Dhaka",
        "updated_at": updated_at,
        **extra,
    }


def build_latest(sorted_hours: list[Hour], updated_at: str) -> dict:
    newest = sorted_hours[-1]
    cutoff = newest.dt - timedelta(hours=48)
    window = [h for h in sorted_hours if h.dt >= cutoff]
    current = newest.as_dict()
    return envelope(
        updated_at,
        {
            "current": current,
            "hourly": [h.as_dict() for h in window],
        },
    )


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def read_json(path: Path) -> dict | None:
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def data_dir(root: Path) -> Path:
    """Repo-local JSON. Not copied to the site, so visitors cannot fetch daily.json."""
    return root / "data"


def newest_iso(hours: dict[str, Hour]) -> str | None:
    if not hours:
        return None
    return max(hours.values(), key=lambda h: h.dt).iso
