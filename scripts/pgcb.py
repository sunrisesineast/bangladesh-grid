"""Fetch and parse the Power Grid Bangladesh PLC hourly generation table."""

from __future__ import annotations

import sys
import time

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://erp.powergrid.gov.bd/w/generations/view_generations"

COLUMNS = [
    "Date",
    "Time",
    "Generation(MW)",
    "Gas",
    "Liquid Fuel",
    "Coal",
    "Hydro",
    "Solar",
    "Wind",
    "India - Bheramara HVDC",
    "India - Tripura",
    "India - Adani",
    "Nepal",
    "Remarks",
]

HEADERS = {
    "User-Agent": (
        "bangladesh-grid/1.0 "
        "(+https://github.com/sunrisesineast/bangladesh-grid; unofficial dashboard)"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


def enable_os_trust_store() -> bool:
    """Use the OS certificate store. PGCB presents an incomplete TLS chain."""
    try:
        import truststore

        truststore.inject_into_ssl()
        return True
    except Exception:
        return False


def make_session(insecure: bool = False) -> requests.Session:
    session = requests.Session()
    session.headers.update(HEADERS)
    if insecure:
        session.verify = False
        import urllib3

        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    return session


def fetch(
    session: requests.Session, page: int, retries: int = 4, delay: float = 0.5
) -> str:
    url = BASE_URL if page == 1 else f"{BASE_URL}?page={page}"
    last_err: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            resp = session.get(url, timeout=30)
            if resp.status_code == 200:
                return resp.text
            last_err = RuntimeError(f"HTTP {resp.status_code}")
        except requests.RequestException as exc:
            last_err = exc
        wait = delay * (2 ** (attempt - 1))
        print(
            f"  ! page {page} attempt {attempt}/{retries} failed "
            f"({last_err}); retrying in {wait:.1f}s",
            file=sys.stderr,
        )
        time.sleep(wait)
    raise RuntimeError(f"Failed to fetch page {page}: {last_err}")


def parse_rows(html: str, page: int) -> list[list[str]]:
    soup = BeautifulSoup(html, "lxml")
    table = soup.find("table")
    if table is None:
        return []
    body = table.find("tbody") or table
    rows: list[list[str]] = []
    for tr in body.find_all("tr"):
        cells = [td.get_text(strip=True) for td in tr.find_all("td")]
        if not cells:
            continue
        if len(cells) != len(COLUMNS):
            print(
                f"  ! page {page}: row has {len(cells)} cells, "
                f"expected {len(COLUMNS)}",
                file=sys.stderr,
            )
            cells = (cells + [""] * len(COLUMNS))[: len(COLUMNS)]
        rows.append(cells)
    return rows


def _fetch_pages(pages: int, delay: float, insecure: bool) -> list[list[str]]:
    session = make_session(insecure=insecure)
    rows: list[list[str]] = []
    for page in range(1, pages + 1):
        html = fetch(session, page)
        chunk = parse_rows(html, page)
        print(f"Page {page}: {len(chunk)} rows")
        rows.extend(chunk)
        if page != pages:
            time.sleep(delay)
    return rows


def fetch_recent_pages(pages: int = 2, delay: float = 0.5) -> list[list[str]]:
    """Return newest-first table rows from the first N pages."""
    if not enable_os_trust_store():
        print("  ! truststore unavailable; TLS errors may follow.", file=sys.stderr)
    try:
        return _fetch_pages(pages, delay, insecure=False)
    except Exception as exc:
        print(
            f"  ! verified fetch failed ({exc}); retrying without TLS verify.",
            file=sys.stderr,
        )
        return _fetch_pages(pages, delay, insecure=True)
