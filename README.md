# Bangladesh Grid

Unofficial dashboard of hourly electricity generation on the Bangladesh grid.

**This is not an official Power Grid Bangladesh / PGCB / NLDC / BPDB site.** Generation figures come from the public [PGCB ERP generation table](https://erp.powergrid.gov.bd/w/generations/view_generations). They measure dispatched MW, not billed consumption or load-shedding.

## What you get

One page:

- Latest snapshot (MW and fuel mix)
- Last 48 hours of total generation
- Last 7 days of daily-mean mix
- Monthly mix for the seeded archive (2015–present)

The site is static [Astro](https://astro.build) on Vercel. Aggregates live in `data/` and are baked into the page at build time. The 1.3 MB daily series is **not** served to browsers.

## Local development

```bash
python -m pip install -r requirements.txt
npm install
npm run dev
```

To rebuild the JSON from a local hourly CSV (the CSV is gitignored and not published):

```bash
python scripts/seed.py path/to/powergrid_generations.csv
```

Hourly refresh (pages 1–2 of the live table):

```bash
python scripts/update.py
```

## How updates work

A GitHub Action runs at 15 minutes past each hour, fetches the newest PGCB pages, and commits `data/*.json` **only if the newest timestamp changed**. Vercel rebuilds from that commit.

Connect this GitHub repo to a Vercel Hobby project (root directory `.`, framework Astro). Public Actions minutes are free; the workflow does not run on its own JSON commits, so it will not loop.

Scheduled workflows on public repos pause after 60 days with no repository activity. Hourly JSON commits normally keep the schedule alive. If it goes quiet, run **Update generation data** from the Actions tab.

## License

[MIT](LICENSE) for the code and JSON packaging. Underlying generation numbers remain PGCB’s public data; we do not claim to relicense them.
