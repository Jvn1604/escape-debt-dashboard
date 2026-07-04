# Escape The Debt — Analytics Dashboard

A static, open-source dashboard for analysing the CSV exports of **Escape The Debt**, a Unity 6 (URP) first-person serious game about Malaysian student debt management, built as a Final Year Project (PSM) at UTeM.

**Live demo:** enable GitHub Pages on this repo (see below), then click **Load sample data**.

Everything runs client-side in the browser — no server, no upload, no telemetry. Drop the CSVs in, and the data never leaves your machine (it's kept in `localStorage` so it survives a page refresh, until you press *Clear all data*).

## How it works

The game's `AnalyticsManager` (Export Analytics CSV button on the Result screen, or F9 in-game) writes three files to `Application.persistentDataPath`:

| File | Shape | Detected by |
|---|---|---|
| `EscapeDebt_Analytics.csv` | one row per gameplay action (overwritten per export) | `EventType` column |
| `EscapeDebt_RunSummary.csv` | one row per completed run (appends) | `Outcome` column |
| `EscapeDebt_DailyHistory.csv` | one row per in-game day (appends) | `TotalDebt` + `Day` columns |

Drag any of them (in any order, any filename) onto the page — the dashboard identifies each file **by its column headers**, not its name. Header matching is case-insensitive and ignores underscores/spaces, and the filename is used as a fallback if the headers are unrecognised.

**Merging & dedupe:** every ingested row is deduplicated against everything already loaded (full-row match). That means you can:

- re-upload a grown `RunSummary`/`DailyHistory` file later — only the new rows are added;
- drop exports collected from **multiple participants' machines** into one dashboard and analyse them together;
- download the combined run table back out via **Download merged CSV** for SPSS/Excel/R analysis in the FYP report.

## Pages

- **Dashboard** (`index.html`) — analysis: KPIs, ending distribution, Guided vs Standard, trajectories, event insights.
- **All Data** (`all-data.html`) — the combined record of everything collected: collection KPIs (total rows, sessions, players, date range), rows-per-dataset and collection-timeline charts, a **session coverage table** that flags participants with missing files before you analyse, and the **full raw tables** for all three datasets (every column, paginated, sticky headers) each with its own *Download merged CSV* button.
- **GEQ Toolkit** — nav link to the companion Game Experience Questionnaire toolkit. Set your URL in the `GEQ_URL` constant at the top of `js/core.js` (the link hides itself while empty).

Data is shared between pages through `localStorage`, so files dropped on one page appear on the other.

## What you get on the Dashboard

- **Overview KPIs** — runs, players, win rate, average debt reduced, average final stress, average composite score.
- **Ending distribution** — Win / Burnout / Survived doughnut.
- **Guided vs Standard** — win rate, debt-reduction % and final stress side by side, plus average composite score and days used per mode.
- **Day-by-day trajectories** — debt, stress, cash or reputation curves over the 10 days, one line per run (gold = Standard, cyan = Guided).
- **Event stream insights** — action counts by type, and average stress impact per action type (relief vs penalty).
- **Event explorer** — filter every recorded action by session, event type or free-text search, with cash/debt/stress deltas per row.
- **Run table** — sortable, with mode/outcome chips and a `CLEARED` badge for debt-free escapes.

## Getting started

### Host on GitHub Pages
1. Push this folder to a repository.
2. Repo **Settings → Pages → Source: Deploy from a branch → `main` / root**.
3. Open `https://<user>.github.io/<repo>/`.

### Run locally
Browsers block `fetch` of the sample data from `file://`, so serve the folder:

```bash
python -m http.server 8000
# open http://localhost:8000
```

Dropping your own CSVs works even from `file://` — only the *Load sample data* button needs a server.

### Run the tests

```bash
cd tools && npm install
node test.js
```

Covers header detection, dedupe on re-upload, appended-file merging, and that every chart/table renders.

## Project structure

```
index.html          Dashboard page
all-data.html       All Data page (combined tables & collection charts)
css/style.css       theme (ledger-ink + ringgit-gold)
js/core.js          shared: detection, merge/dedupe, persistence, drag & drop  ← GEQ_URL lives here
js/app.js           Dashboard rendering
js/alldata.js       All Data rendering
sample_data/        three example exports (synthetic data)
tools/test.js       headless jsdom smoke tests (both pages)
```

Dependencies are loaded from CDN at runtime: [PapaParse](https://www.papaparse.com/) (CSV parsing) and [Chart.js](https://www.chartjs.org/) (charts). No build step.

## Adapting to schema changes

Column access is tolerant (case/underscore-insensitive), so `debt_reduction_pct` and `DebtReductionPct` both work. If a column is renamed to something entirely different in `AnalyticsManager.cs`, update the names used in `js/app.js` / `js/alldata.js` (`G(...)` / `N(...)` calls) and, if the *detection* columns change, the `detectDataset` function in `js/core.js`.

## License

MIT — see [LICENSE](LICENSE).
