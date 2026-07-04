// Headless smoke test for both pages: node tools/test.js
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const Papa = require("papaparse");

const root = path.join(__dirname, "..");
const read = (...p) => fs.readFileSync(path.join(root, ...p), "utf8");

let failed = 0;
const assert = (cond, msg) => {
  console.log((cond ? "PASS" : "FAIL") + "  " + msg);
  if (!cond) failed++;
};

function boot(htmlFile, scripts) {
  const dom = new JSDOM(read(htmlFile), { url: "https://example.test/" + htmlFile, runScripts: "outside-only" });
  const { window } = dom;
  window.Papa = Papa;
  window.Chart = class Chart {
    constructor(el, cfg) { this.cfg = cfg; window.Chart.created.push({ el: el && el.id, cfg }); }
    destroy() {}
  };
  window.Chart.created = [];
  window.Chart.defaults = { color: "", borderColor: "", font: {} };
  window.confirm = () => true;
  for (const s of scripts) window.eval(read("js", s));
  return window;
}

const files = ["EscapeDebt_Analytics.csv", "EscapeDebt_RunSummary.csv", "EscapeDebt_DailyHistory.csv"];
const texts = {};
for (const f of files) texts[f] = read("sample_data", f);
const parsed = (t) => Papa.parse(t, { header: true, skipEmptyLines: true });

/* ================= Dashboard page ================= */
console.log("--- index.html ---");
{
  const win = boot("index.html", ["core.js", "app.js"]);
  const app = win.__etd;
  const doc = win.document;

  // 1 — detection by headers
  assert(app.detectDataset(["SessionId", "EventType", "CashDelta"], "x.csv") === "events", "detects event stream by EventType");
  assert(app.detectDataset(["SessionId", "Outcome", "Rank"], "x.csv") === "runs", "detects run summary by Outcome");
  assert(app.detectDataset(["SessionId", "Day", "TotalDebt"], "x.csv") === "daily", "detects daily history by TotalDebt+Day");
  assert(app.detectDataset(["session_id", "event_type"], "x.csv") === "events", "detection tolerates snake_case headers");
  assert(app.detectDataset(["A", "B"], "EscapeDebt_RunSummary.csv") === "runs", "falls back to filename");
  assert(app.detectDataset(["A", "B"], "random.csv") === null, "rejects unknown files");

  // 2 — ingest all three sample files
  for (const f of files) app.ingestParsed(parsed(texts[f]), f);
  assert(app.state.events.length === 271, `events rows loaded (got ${app.state.events.length}, want 271)`);
  assert(app.state.runs.length === 6, `run rows loaded (got ${app.state.runs.length}, want 6)`);
  assert(app.state.daily.length === 58, `daily rows loaded (got ${app.state.daily.length}, want 58)`);

  // 3 — re-upload = no duplicates
  for (const f of files) app.ingestParsed(parsed(texts[f]), f);
  assert(app.state.events.length === 271 && app.state.runs.length === 6 && app.state.daily.length === 58,
    "re-uploading the same files adds zero duplicate rows");

  // 4 — appended file merges only new rows
  const lines = texts["EscapeDebt_RunSummary.csv"].trimEnd().split(/\r?\n/);
  const appended = lines.concat([lines[1].replace(/^[^,]+/, "NEWSESSION-0001")]).join("\n");
  app.ingestParsed(parsed(appended), "EscapeDebt_RunSummary.csv");
  assert(app.state.runs.length === 7, `appended export merges only the new row (got ${app.state.runs.length}, want 7)`);

  // 5 — dashboard rendered
  assert(doc.getElementById("kpi-runs").textContent === "7", "KPI shows run count");
  assert(doc.getElementById("kpi-winrate").textContent.includes("%"), "win rate rendered");
  const chartIds = win.Chart.created.map((c) => c.el);
  for (const id of ["outcomeChart", "modeChart", "trajChart", "eventTypeChart", "stressDeltaChart"]) {
    assert(chartIds.includes(id), `chart rendered: ${id}`);
  }
  assert(doc.querySelectorAll("#runTable tbody tr").length === 7, "run table lists every run");
  assert(doc.querySelectorAll("#eventTable tbody tr").length === 20, "event explorer paginates to 20 rows");
  assert(doc.querySelector('.slot[data-slot="events"]').classList.contains("loaded"), "slot flips to loaded state");
  assert(doc.querySelectorAll(".nav-links a").length === 3, "nav has Dashboard / All Data / GEQ links");

  // 6 — clear resets everything
  app.clearAll();
  assert(app.state.runs.length === 0 && !doc.querySelector(".slot.loaded"), "clear all empties state and slots");
}

/* ================= All Data page ================= */
console.log("--- all-data.html ---");
{
  const win = boot("all-data.html", ["core.js", "alldata.js"]);
  const app = win.__etd;
  const doc = win.document;

  assert(doc.getElementById("ad-empty").hidden === false, "empty notice shown before any data");

  // load only two of the three files — coverage should flag the gap
  app.ingestParsed(parsed(texts["EscapeDebt_RunSummary.csv"]), "EscapeDebt_RunSummary.csv");
  app.ingestParsed(parsed(texts["EscapeDebt_DailyHistory.csv"]), "EscapeDebt_DailyHistory.csv");

  assert(doc.getElementById("ad-empty").hidden === true && doc.getElementById("ad-content").hidden === false,
    "content appears once any file is loaded");
  assert(doc.getElementById("ad-rows").textContent === "64", `total rows combined (got ${doc.getElementById("ad-rows").textContent}, want 64)`);
  assert(doc.getElementById("ad-sessions").textContent === "6", "session count across datasets");
  assert(doc.getElementById("ad-files").textContent === "2 / 3", "files-loaded KPI shows 2 / 3");
  assert(doc.getElementById("ad-range").textContent.includes("2026-06-20"), "date range detected from timestamps");

  const chartIds = win.Chart.created.map((c) => c.el);
  assert(chartIds.includes("adRowsChart") && chartIds.includes("adTimelineChart"), "collection charts rendered");

  const covRows = doc.querySelectorAll("#coverageTable tbody tr");
  assert(covRows.length === 6, "coverage table lists all sessions");
  assert(doc.querySelectorAll("#coverageTable td.missing").length === 6, "coverage flags missing event rows for every session");

  // full raw table: all 35 run-summary columns, paginated
  assert(doc.querySelectorAll("#raw-runs thead th").length === 35, "run summary raw table shows all 35 columns");
  assert(doc.querySelectorAll("#raw-runs tbody tr").length === 6, "run summary raw table lists all rows");
  assert(doc.querySelectorAll("#raw-daily tbody tr").length === 15, "daily raw table paginates to 15 rows");
  assert(doc.querySelector("#raw-events [data-full='events']").hidden === true, "event raw table hidden while file absent");

  // now add the third file
  app.ingestParsed(parsed(texts["EscapeDebt_Analytics.csv"]), "EscapeDebt_Analytics.csv");
  assert(doc.getElementById("ad-files").textContent === "3 / 3", "files-loaded KPI updates to 3 / 3");
  assert(doc.querySelectorAll("#coverageTable td.missing").length === 0, "coverage gaps clear once events arrive");
  assert(doc.querySelectorAll("#raw-events tbody tr").length === 15, "event raw table renders after upload");
}

console.log(failed ? `\n${failed} test(s) FAILED` : "\nAll tests passed");
process.exit(failed ? 1 : 0);
