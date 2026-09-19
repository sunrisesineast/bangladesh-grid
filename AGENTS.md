# Agent notes

This repo is the **public dashboard**. It is not the historical archive and not the research workspace.

## Related repo (do not merge into this one)

| | Dashboard (this repo) | Workshop |
| --- | --- | --- |
| Local | `bangladesh-grid` | `powergrid-generation-scraper` (sibling folder) |
| GitHub | [sunrisesineast/bangladesh-grid](https://github.com/sunrisesineast/bangladesh-grid) (public) | [sunrisesineast/bangladesh-grid-data](https://github.com/sunrisesineast/bangladesh-grid-data) |
| Contains | Astro site, slim scrape, `data/*.json` | Full hourly CSV/XLSX, `scrape.py`, `analyze.py`, `annotate.py`, `REPORT.md`, charts, Firecrawl notes |

Do **not** copy analysis, annotated charts, `REPORT.md`, or `.firecrawl/` here. The split is intentional.

The workshop CSV is gitignored there too (`powergrid_generations.csv` at that repo root). To reseed generation aggregates:

```bash
python scripts/seed.py ../powergrid-generation-scraper/powergrid_generations.csv
```

Never commit `*.csv`, `*.xlsx`, or `*.pdf`. Never run a full ~2,000-page PGCB backfill from this repo unless the user explicitly asks; the archive already exists next door. Do not walk the full BPDB PDF archive unless the user explicitly asks; that is the deferred historical backfill.

## Data

- Live generation: https://erp.powergrid.gov.bd/w/generations/view_generations (HTML table, `?page=N`). No official JSON API. Dispatched MW, Asia/Dhaka, including a 19:30 evening-peak row.
- Live demand / load-shed: NLDC System Summary via https://misc.bpdb.gov.bd/daily-generation-archive (Page 1 PDF). Daily peaks, GWh generated/demand/unserved, nine-zone evening load-shed. Archive listing dates are often one day after the PDF’s report date; key rows on the PDF date. MKWHr is stored as GWh.
- `data/latest.json` (48h hourly), `data/daily.json`, `data/monthly.json` are the generation store. `data/nldc-latest.json` and `data/nldc-daily.json` are the NLDC store. The site reads them at **build time**; `daily.json` is not copied to `public/`.
- Hourly CI (`scripts/update.py`) fetches PGCB pages 1–2 and commits JSON only if the newest timestamp moved.
- NLDC CI (`scripts/update_nldc.py`) fetches archive pages 1–2, downloads Page 1 PDFs in a 14-day lookback, upserts by report date, and commits only if a report was new or figures changed. Missing days stay gaps (do not invent zeros). Cron: 09:00 and 16:00 UTC (15:00 and 22:00 Asia/Dhaka).
- Drop implausible hours and implausible NLDC totals. PGCB’s TLS chain is incomplete; on Linux, one verified failure then continue without verify is expected. BPDB may need the same.

## Product scope

Phase 1 is `/` (hero MW, 48h, 7-day mix, monthly mix, plus an NLDC unserved / evening-shed strip that links to Demand).

Phase 2 (in this repo) is `/demand`: evening-peak generation / demand / load-shed, daily GWh, nine-zone table, two history charts. Do not add production cost, gas MMCFD, unavailable plants, outage logs, zone fuel mix, maps, Ember, HCU/BPDB annual sales, Mendeley backfills, distco feeder schedules, or a workshop PDF archive unless asked.

Keep the public site unofficial. Attribute PGCB on generation and NLDC/BPDB on demand. MIT covers code and JSON packaging, not the underlying grid figures.
