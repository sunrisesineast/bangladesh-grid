"""Fetch SREDA's solar installed-capacity register.

The national database publishes a live solar total (technology table) and a
month-start history (the progress chart). Both pages are server-rendered HTML.
"""

from __future__ import annotations

import re
import time
from datetime import datetime

import requests
from bs4 import BeautifulSoup

SOURCE_URL = "https://www.renewableenergy.gov.bd/"
SOURCE_NAME = "SREDA National Database of Renewable Energy"
STATS_URL = "https://www.renewableenergy.gov.bd/index.php?id=8"
HISTORY_URL = "https://www.renewableenergy.gov.bd/index.php?id=23"

HEADERS = {
    "User-Agent": (
        "bangladesh-grid/1.0 "
        "(+https://github.com/sunrisesineast/bangladesh-grid; unofficial dashboard)"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

# SREDA's technology names, in the order the table publishes them.
TECHS: dict[str, tuple[str, str]] = {
    "Solar Park": ("solar_park", "Solar parks"),
    "Rooftop Solar Except NEM": ("rooftop", "Other rooftop"),
    "Net Metering Rooftop Solar": ("net_metering", "Net-metered rooftop"),
    "Solar Irrigation": ("irrigation", "Irrigation"),
    "Solar Home System": ("home_system", "Home systems"),
    "Solar Minigrid": ("minigrid", "Minigrids"),
    "Solar Microgrid": ("microgrid", "Microgrids"),
    "Solar Nanogrid": ("nanogrid", "Nanogrids"),
    "Solar Charging Station": ("charging", "Charging stations"),
    "Solar Street Light": ("street_light", "Street lights"),
    "Solar Powered Telecom BTS": ("telecom", "Telecom"),
    "Solar Drinking Water System": ("drinking_water", "Drinking water"),
}

_POINT = re.compile(
    r"\['(\d{4}-\d{2}-\d{2})',\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)\]"
)
_UPDATED = re.compile(r"Last Update:\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})")
_HEADLINE = {
    "solar_mwp": re.compile(r"Total Installed Capacity:\s*([\d,.]+)\s*MWp", re.I),
    "off_grid_mwp": re.compile(r"Offgrid Installed Capacity:\s*([\d,.]+)\s*MWp", re.I),
    "on_grid_mwp": re.compile(r"Ongrid Installed Capacity:\s*([\d,.]+)\s*MWp", re.I),
}


def _num(text: str) -> float:
    return round(float(text.replace(",", "").strip()), 3)


def _slug(label: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")
    return slug or "solar"


def fetch_html(session: requests.Session, url: str, retries: int = 3) -> str:
    last_err: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            resp = session.get(url, timeout=45)
            resp.raise_for_status()
            return resp.text
        except requests.RequestException as exc:
            last_err = exc
            if attempt < retries:
                time.sleep(1.5 * attempt)
    raise RuntimeError(f"SREDA fetch failed for {url}: {last_err}")


def parse_database_updated_at(html: str) -> str | None:
    match = _UPDATED.search(html)
    if not match:
        return None
    day, clock = match.group(1), match.group(2)
    datetime.strptime(f"{day} {clock}", "%Y-%m-%d %H:%M:%S")
    return f"{day}T{clock}+06:00"


def parse_headlines(html: str) -> dict[str, float]:
    found: dict[str, float] = {}
    for key, pattern in _HEADLINE.items():
        match = pattern.search(html)
        if not match:
            raise ValueError(f"SREDA page is missing {key}")
        found[key] = _num(match.group(1))
    solar = found["solar_mwp"]
    parts = found["on_grid_mwp"] + found["off_grid_mwp"]
    if abs(parts - solar) > 1:
        raise ValueError(
            f"SREDA on-grid {found['on_grid_mwp']} + off-grid {found['off_grid_mwp']} "
            f"is {parts}, not the solar total {solar}"
        )
    return found


def parse_solar_technologies(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    table = None
    for candidate in soup.find_all("table"):
        headers = [th.get_text(" ", strip=True) for th in candidate.find_all("th")]
        if "Technology" in headers and "On-grid MWp" in headers:
            table = candidate
            break
    if table is None:
        raise ValueError("SREDA technology table not found")

    technologies: list[dict] = []
    left = 0
    for tr in table.find_all("tr"):
        cells = tr.find_all("td")
        if not cells:
            continue
        texts = [cell.get_text(" ", strip=True) for cell in cells]
        source_at = next((i for i, text in enumerate(texts) if text == "Solar"), None)
        if source_at is not None:
            left = int(cells[source_at].get("rowspan") or 1)
            tech = texts[source_at + 1 :]
        elif left > 0:
            tech = texts
        else:
            continue
        if len(tech) < 5:
            raise ValueError(f"Short SREDA solar row: {texts}")
        label = tech[0]
        key, display = TECHS.get(label, (_slug(label), label))
        off_grid = _num(tech[2])
        on_grid = _num(tech[3])
        total = _num(tech[4])
        if abs((off_grid + on_grid) - total) > 0.05:
            raise ValueError(f"SREDA row {label} does not add up ({off_grid}+{on_grid} != {total})")
        if total > 0:
            technologies.append(
                {
                    "key": key,
                    "label": display,
                    "quantity": int(float(tech[1].replace(",", ""))),
                    "off_grid_mwp": off_grid,
                    "on_grid_mwp": on_grid,
                    "total_mwp": total,
                }
            )
        left -= 1
    if not technologies:
        raise ValueError("SREDA technology table has no solar rows")
    return technologies


def parse_history(html: str) -> list[dict]:
    marker = html.find("'Solar-Ongrid'")
    if marker < 0:
        raise ValueError("SREDA progress series not found")
    end = html.find("]);", marker)
    chunk = html[marker : end if end > marker else marker + 50000]
    points: list[dict] = []
    seen: set[str] = set()
    for date, _renewable, solar, on_grid, off_grid in _POINT.findall(chunk):
        if date in seen:
            raise ValueError(f"Duplicate SREDA history date {date}")
        seen.add(date)
        solar_mw = _num(solar)
        on_mw = _num(on_grid)
        off_mw = _num(off_grid)
        # Early fiscal-year points in SREDA's chart are off by a few megawatts.
        # Month-start points from mid-2023 add up.
        gap = abs((on_mw + off_mw) - solar_mw)
        limit = 1.0 if date >= "2023-06-01" else 25.0
        if gap > limit:
            raise ValueError(
                f"SREDA history {date}: on-grid {on_mw} + off-grid {off_mw} != solar {solar_mw}"
            )
        points.append(
            {
                "date": date,
                "solar_mw": solar_mw,
                "on_grid_mw": on_mw,
                "off_grid_mw": off_mw,
            }
        )
    if len(points) < 10:
        raise ValueError(f"SREDA history has only {len(points)} points")
    dates = [point["date"] for point in points]
    if dates != sorted(dates):
        raise ValueError("SREDA history is not in date order")
    return points


def fetch_solar(session: requests.Session | None = None) -> dict:
    own_session = session is None
    if session is None:
        session = requests.Session()
        session.headers.update(HEADERS)
    try:
        stats_html = fetch_html(session, STATS_URL)
        history_html = fetch_html(session, HISTORY_URL)
    finally:
        if own_session:
            session.close()

    headlines = parse_headlines(stats_html)
    technologies = parse_solar_technologies(stats_html)
    history = parse_history(history_html)
    parks = next((row["total_mwp"] for row in technologies if row["key"] == "solar_park"), None)
    if parks is None:
        raise ValueError("SREDA technology table has no solar-park row")
    table_total = round(sum(row["total_mwp"] for row in technologies), 3)
    if abs(table_total - headlines["solar_mwp"]) > 1:
        raise ValueError(
            f"SREDA technology rows sum to {table_total}, headline is {headlines['solar_mwp']}"
        )
    updated = parse_database_updated_at(stats_html) or parse_database_updated_at(history_html)
    return {
        "database_updated_at": updated,
        "current": {
            "solar_mwp": headlines["solar_mwp"],
            "on_grid_mwp": headlines["on_grid_mwp"],
            "off_grid_mwp": headlines["off_grid_mwp"],
            "parks_mwp": parks,
            "technologies": technologies,
        },
        "history": history,
    }
