"""Fetch BPDB daily-generation archive Page 1 PDFs and parse the NLDC summary."""

from __future__ import annotations

import io
import re
import time
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any
from urllib.parse import urljoin
from zoneinfo import ZoneInfo

import pdfplumber
import requests
from bs4 import BeautifulSoup

from pgcb import enable_os_trust_store, make_session

TZ = ZoneInfo("Asia/Dhaka")
ARCHIVE_URL = "https://misc.bpdb.gov.bd/daily-generation-archive"
SOURCE_NAME = "NLDC System Summary Report (via BPDB)"
ARCHIVE_PAGES = 2
LOOKBACK_DAYS = 14
MAX_MW = 25_000
MAX_GWH = 600.0

ZONE_ORDER = (
    "Dhaka",
    "Chattogram",
    "Cumilla",
    "Mymensingh",
    "Sylhet",
    "Khulna",
    "Barishal",
    "Rajshahi",
    "Rangpur",
)
ZONE_ALIASES = {
    "chittagong": "Chattogram",
    "comilla": "Cumilla",
    "barisal": "Barishal",
}

DATE_RE = re.compile(r"Date\s*:?\s*(\d{1,2})[-/](\d{1,2})[-/](\d{4})", re.I)
MW_TIME_RE = re.compile(
    r"(Day Peak Generation|Day Peak Demand|Evening Peak Generation|Evening Peak Demand)"
    r"\s+([\d,.]+)\s*MW\s+(\d{1,2}:\d{2})",
    re.I,
)
ENERGY_RE = re.compile(
    r"(Energy Generated|Energy Unserverd|Energy Unserved|Energy Demand)"
    r"\s+([\d,.]+)\s*MKWH",
    re.I,
)
ZONE_HEADING_RE = re.compile(
    r"Zone-wise Load-shed and Demand Summary",
    re.I,
)
ZONE_ROW_RE = re.compile(
    r"^(Dhaka|Chattogram|Chittagong|Cumilla|Comilla|Mymensingh|Sylhet|"
    r"Khulna|Barishal|Barisal|Rajshahi|Rangpur)\s+([\d,.]+)\s+([\d,.]+)\s*$",
    re.I,
)
ZONE_TOTAL_RE = re.compile(r"^Total\s+([\d,.]+)\s+([\d,.]+)\s*$", re.I)
LISTING_DATE_RE = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{4})$")


@dataclass(frozen=True, slots=True)
class Peak:
    generation_mw: float
    demand_mw: float
    time: str
    load_shed_mw: float | None = None


@dataclass(frozen=True, slots=True)
class Energy:
    generated_gwh: float
    demand_gwh: float
    unserved_gwh: float


@dataclass(frozen=True, slots=True)
class Zone:
    zone: str
    load_shed_mw: float
    demand_mw: float


@dataclass(slots=True)
class DayReport:
    date: date
    source_pdf: str
    day_peak: Peak
    evening_peak: Peak
    energy: Energy
    zones: list[Zone] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        evening = {
            "generation_mw": _round(self.evening_peak.generation_mw),
            "demand_mw": _round(self.evening_peak.demand_mw),
            "load_shed_mw": _round(self.evening_peak.load_shed_mw or 0.0),
            "time": self.evening_peak.time,
        }
        return {
            "date": self.date.isoformat(),
            "source_pdf": self.source_pdf,
            "day_peak": {
                "generation_mw": _round(self.day_peak.generation_mw),
                "demand_mw": _round(self.day_peak.demand_mw),
                "time": self.day_peak.time,
            },
            "evening_peak": evening,
            "energy": {
                "generated_gwh": _round(self.energy.generated_gwh, 3),
                "demand_gwh": _round(self.energy.demand_gwh, 3),
                "unserved_gwh": _round(self.energy.unserved_gwh, 3),
            },
            "zones": [
                {
                    "zone": z.zone,
                    "load_shed_mw": _round(z.load_shed_mw),
                    "demand_mw": _round(z.demand_mw),
                }
                for z in self.zones
            ],
        }


@dataclass(frozen=True, slots=True)
class ArchiveEntry:
    listing_date: date
    pdf_url: str


def _round(value: float, digits: int = 2) -> float:
    return round(float(value), digits)


def _num(raw: str) -> float:
    return float((raw or "0").replace(",", "").strip())


def _norm_zone(name: str) -> str | None:
    key = re.sub(r"\s+zone$", "", (name or "").strip(), flags=re.I).lower()
    if key in ZONE_ALIASES:
        return ZONE_ALIASES[key]
    for zone in ZONE_ORDER:
        if zone.lower() == key:
            return zone
    return None


def parse_listing_date(raw: str) -> date | None:
    match = LISTING_DATE_RE.match((raw or "").strip())
    if not match:
        return None
    day, month, year = (int(match.group(1)), int(match.group(2)), int(match.group(3)))
    try:
        return date(year, month, day)
    except ValueError:
        return None


def parse_report_date(text: str) -> date | None:
    match = DATE_RE.search(text or "")
    if not match:
        return None
    day, month, year = (int(match.group(1)), int(match.group(2)), int(match.group(3)))
    try:
        return date(year, month, day)
    except ValueError:
        return None


def parse_archive_entries(html: str, base_url: str = ARCHIVE_URL) -> list[ArchiveEntry]:
    soup = BeautifulSoup(html, "lxml")
    entries: list[ArchiveEntry] = []
    seen: set[str] = set()
    for table in soup.find_all("table"):
        rows = table.find_all("tr")
        if not rows:
            continue
        headers = [c.get_text(" ", strip=True).lower() for c in rows[0].find_all(["th", "td"])]
        if "date" not in headers or not any("page 1" in h for h in headers):
            continue
        date_idx = headers.index("date")
        for tr in rows[1:]:
            cells = tr.find_all("td")
            if len(cells) <= date_idx:
                continue
            listing = parse_listing_date(cells[date_idx].get_text(" ", strip=True))
            if listing is None:
                continue
            pdf_url = None
            for a in tr.find_all("a"):
                href = (a.get("href") or "").strip()
                if "page_1_" in href and href.lower().endswith(".pdf"):
                    pdf_url = urljoin(base_url, href)
                    break
            if not pdf_url or pdf_url in seen:
                continue
            seen.add(pdf_url)
            entries.append(ArchiveEntry(listing_date=listing, pdf_url=pdf_url))
    return entries


def _peaks_from_text(text: str) -> tuple[Peak, Peak] | None:
    found: dict[str, tuple[float, str]] = {}
    for match in MW_TIME_RE.finditer(text):
        label = re.sub(r"\s+", " ", match.group(1)).strip().lower()
        found[label] = (_num(match.group(2)), match.group(3))
    needed = (
        "day peak generation",
        "day peak demand",
        "evening peak generation",
        "evening peak demand",
    )
    if any(key not in found for key in needed):
        return None
    day = Peak(
        generation_mw=found["day peak generation"][0],
        demand_mw=found["day peak demand"][0],
        time=found["day peak generation"][1],
    )
    evening = Peak(
        generation_mw=found["evening peak generation"][0],
        demand_mw=found["evening peak demand"][0],
        time=found["evening peak generation"][1],
    )
    return day, evening


def _energy_from_text(text: str) -> Energy | None:
    found: dict[str, float] = {}
    for match in ENERGY_RE.finditer(text):
        label = re.sub(r"\s+", " ", match.group(1)).strip().lower()
        if "unserv" in label:
            label = "energy unserved"
        found[label] = _num(match.group(2))
    if not {"energy generated", "energy demand", "energy unserved"} <= found.keys():
        return None
    return Energy(
        generated_gwh=found["energy generated"],
        demand_gwh=found["energy demand"],
        unserved_gwh=found["energy unserved"],
    )


def _zones_from_text(text: str) -> tuple[list[Zone], float | None]:
    lines = [re.sub(r"\s+", " ", line).strip() for line in (text or "").splitlines()]
    start = next((i for i, line in enumerate(lines) if ZONE_HEADING_RE.search(line)), None)
    if start is None:
        return [], None
    zones: list[Zone] = []
    total_shed: float | None = None
    by_name: dict[str, Zone] = {}
    for line in lines[start : start + 20]:
        row = ZONE_ROW_RE.match(line)
        if row:
            name = _norm_zone(row.group(1))
            if not name:
                continue
            zone = Zone(
                zone=name,
                load_shed_mw=_num(row.group(2)),
                demand_mw=_num(row.group(3)),
            )
            by_name[name] = zone
            continue
        total = ZONE_TOTAL_RE.match(line)
        if total and by_name:
            total_shed = _num(total.group(1))
            break
    for name in ZONE_ORDER:
        if name in by_name:
            zones.append(by_name[name])
    return zones, total_shed


def _zones_from_tables(tables: list[list[list[str | None]]]) -> tuple[list[Zone], float | None]:
    for table in tables:
        if not table:
            continue
        header = [re.sub(r"\s+", " ", (c or "")).strip().lower() for c in table[0]]
        if header[:3] != ["zone", "load-shed", "demand"] and header[:3] != [
            "zone",
            "load shed",
            "demand",
        ]:
            joined = " ".join(header)
            if "load-shed" not in joined and "load shed" not in joined:
                continue
            if "zone" not in joined:
                continue
        by_name: dict[str, Zone] = {}
        total_shed: float | None = None
        for raw in table[1:]:
            cells = [re.sub(r"\s+", " ", (c or "")).strip() for c in raw]
            if len(cells) < 3:
                continue
            label = cells[0]
            if label.lower() == "total":
                total_shed = _num(cells[1])
                continue
            name = _norm_zone(label)
            if not name:
                continue
            by_name[name] = Zone(
                zone=name,
                load_shed_mw=_num(cells[1]),
                demand_mw=_num(cells[2]),
            )
        zones = [by_name[name] for name in ZONE_ORDER if name in by_name]
        if len(zones) >= 8:
            return zones, total_shed
    return [], None


def _plausible(report: DayReport) -> bool:
    peaks = (report.day_peak, report.evening_peak)
    for peak in peaks:
        if not (0 <= peak.generation_mw <= MAX_MW and 0 <= peak.demand_mw <= MAX_MW):
            return False
    energy = report.energy
    if not (
        0 <= energy.generated_gwh <= MAX_GWH
        and 0 <= energy.demand_gwh <= MAX_GWH
        and 0 <= energy.unserved_gwh <= MAX_GWH
    ):
        return False
    if energy.unserved_gwh > energy.demand_gwh + 1:
        return False
    if len(report.zones) < 8:
        return False
    shed = report.evening_peak.load_shed_mw
    if shed is None or shed < 0 or shed > MAX_MW:
        return False
    return True


def parse_pdf(data: bytes, source_pdf: str) -> DayReport:
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        if not pdf.pages:
            raise ValueError("PDF has no pages")
        page = pdf.pages[0]
        text = page.extract_text() or ""
        tables = page.extract_tables() or []
    report_date = parse_report_date(text)
    if report_date is None:
        raise ValueError("Could not read NLDC report date")
    peaks = _peaks_from_text(text)
    energy = _energy_from_text(text)
    if peaks is None or energy is None:
        raise ValueError("Could not read peak / energy block")
    day_peak, evening_peak = peaks
    zones, total_shed = _zones_from_text(text)
    if len(zones) < 8:
        table_zones, table_shed = _zones_from_tables(tables)
        if len(table_zones) > len(zones):
            zones, total_shed = table_zones, table_shed
    if total_shed is None:
        total_shed = sum(z.load_shed_mw for z in zones)
    report = DayReport(
        date=report_date,
        source_pdf=source_pdf,
        day_peak=day_peak,
        evening_peak=Peak(
            generation_mw=evening_peak.generation_mw,
            demand_mw=evening_peak.demand_mw,
            time=evening_peak.time,
            load_shed_mw=total_shed,
        ),
        energy=energy,
        zones=zones,
    )
    if not _plausible(report):
        raise ValueError("Parsed NLDC figures failed plausibility checks")
    return report


def _http_get(session: requests.Session, url: str, retries: int = 4, delay: float = 0.5) -> requests.Response:
    last_err: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            resp = session.get(url, timeout=60)
            if resp.status_code == 200 and resp.content:
                return resp
            last_err = RuntimeError(f"HTTP {resp.status_code}")
        except requests.exceptions.SSLError:
            raise
        except requests.RequestException as exc:
            last_err = exc
        wait = delay * (2 ** (attempt - 1))
        print(
            f"  ! {url} attempt {attempt}/{retries} failed ({last_err}); retrying in {wait:.1f}s",
            flush=True,
        )
        time.sleep(wait)
    raise RuntimeError(f"Failed to fetch {url}: {last_err}")


def _with_tls(fn):
    if not enable_os_trust_store():
        print("  ! truststore unavailable; TLS errors may follow.", flush=True)
    try:
        return fn(make_session(insecure=False))
    except Exception as exc:
        print(
            f"  ! verified fetch failed ({exc}); retrying without TLS verify.",
            flush=True,
        )
        return fn(make_session(insecure=True))


def fetch_archive_entries(pages: int = ARCHIVE_PAGES, delay: float = 0.5) -> list[ArchiveEntry]:
    def _run(session: requests.Session) -> list[ArchiveEntry]:
        found: list[ArchiveEntry] = []
        seen: set[str] = set()
        for page in range(1, pages + 1):
            url = ARCHIVE_URL if page == 1 else f"{ARCHIVE_URL}?page={page}"
            html = _http_get(session, url).text
            chunk = parse_archive_entries(html, ARCHIVE_URL)
            print(f"Archive page {page}: {len(chunk)} Page 1 PDFs")
            for entry in chunk:
                if entry.pdf_url in seen:
                    continue
                seen.add(entry.pdf_url)
                found.append(entry)
            if page != pages:
                time.sleep(delay)
        return found

    return _with_tls(_run)


def lookback_entries(entries: list[ArchiveEntry], today: date | None = None) -> list[ArchiveEntry]:
    today = today or datetime.now(TZ).date()
    cutoff = today - timedelta(days=LOOKBACK_DAYS)
    return [e for e in entries if e.listing_date >= cutoff]


def fetch_pdf(url: str, session: requests.Session | None = None) -> bytes:
    def _run(sess: requests.Session) -> bytes:
        resp = _http_get(sess, url)
        ctype = (resp.headers.get("content-type") or "").lower()
        if "pdf" not in ctype and not resp.content.startswith(b"%PDF"):
            raise ValueError(f"Not a PDF ({ctype})")
        return resp.content

    if session is not None:
        return _run(session)
    return _with_tls(_run)


def fetch_missing_reports(
    known_pdfs: set[str],
    delay: float = 0.5,
) -> list[DayReport]:
    entries = lookback_entries(fetch_archive_entries())
    wanted = [e for e in entries if e.pdf_url not in known_pdfs]
    if not wanted:
        print("No new Page 1 PDFs in the 14-day lookback.")
        return []

    def _run(session: requests.Session) -> list[DayReport]:
        reports: list[DayReport] = []
        for i, entry in enumerate(wanted):
            print(f"Fetching {entry.listing_date.isoformat()} {entry.pdf_url}")
            try:
                data = fetch_pdf(entry.pdf_url, session=session)
                report = parse_pdf(data, entry.pdf_url)
                print(
                    f"  parsed report {report.date.isoformat()} "
                    f"unserved {report.energy.unserved_gwh:.3f} GWh "
                    f"shed {report.evening_peak.load_shed_mw:.0f} MW"
                )
                reports.append(report)
            except Exception as exc:
                print(f"  ! skip ({exc})", flush=True)
            if i != len(wanted) - 1:
                time.sleep(delay)
        return reports

    return _with_tls(_run)
