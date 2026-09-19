# Bangladesh Grid

Unofficial dashboard of electricity generation and daily demand on the Bangladesh grid.

**This is not an official Power Grid Bangladesh / PGCB / NLDC / BPDB site.** Hourly generation comes from the public [PGCB ERP generation table](https://erp.powergrid.gov.bd/w/generations/view_generations). Daily demand, unserved energy, and evening load-shedding come from the NLDC System Summary (BPDB archive Page 1 PDF). Generation is dispatched MW, not billed consumption.

## What you get

Generation (`/`):

- Latest snapshot (MW and fuel mix)
- Last 48 hours of total generation
- Last 7 days of daily-mean mix
- Monthly mix for the seeded archive (2015–present)
- A strip for yesterday’s NLDC unserved energy and evening load-shed, linking to Demand

Demand (`/demand`):

- Evening-peak generation, demand, and load-shed
- Daily energy generated, demand, and unserved
- Nine-zone evening-peak load-shed table
- History charts as daily reports accumulate (gaps stay gaps)

The site is static [Astro](https://astro.build) on Vercel. Aggregates live in `data/` and are baked into the page at build time. The 1.3 MB generation daily series is **not** served to browsers.

## Local development

```bash
python -m pip install -r requirements.txt
npm install
npm run dev
```

Reseed generation aggregates from the workshop CSV (gitignored, never published):

```bash
python scripts/seed.py ../powergrid-generation-scraper/powergrid_generations.csv
```

Hourly PGCB refresh (pages 1–2 of the live table):

```bash
python scripts/update.py
```

Daily NLDC refresh (archive pages 1–2, 14-day lookback):

```bash
python scripts/update_nldc.py
```

## How updates work

A GitHub Action runs at 15 minutes past each hour, fetches the newest PGCB pages, and commits generation JSON **only if the newest timestamp changed**. A second Action runs at 15:00 and 22:00 Bangladesh time, downloads recent NLDC Page 1 PDFs, and commits `data/nldc-*.json` only if a report was new or changed. Vercel rebuilds from those commits.

Connect this GitHub repo to a Vercel Hobby project (root directory `.`, framework Astro). Public Actions minutes are free; the workflows do not run on their own JSON commits, so they will not loop.

Scheduled workflows on public repos pause after 60 days with no repository activity. JSON commits normally keep the schedules alive. If it goes quiet, run **Update generation data** or **Update NLDC demand data** from the Actions tab.

## Related repo

The full hourly scrape, analysis scripts, and written report live in a separate workshop repo: local folder `powergrid-generation-scraper`, GitHub [sunrisesineast/bangladesh-grid-data](https://github.com/sunrisesineast/bangladesh-grid-data). This dashboard only publishes aggregated JSON. Historical NLDC PDF backfill and Mendeley dumps are not in this repo yet. Agents: see [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE) for the code and JSON packaging. Underlying figures remain PGCB / NLDC / BPDB public data; we do not claim to relicense them.
