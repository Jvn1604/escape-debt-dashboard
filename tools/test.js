// Headless smoke test for the dashboard: node tools/test.js
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const Papa = require("papaparse");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const appJs = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");

const dom = new JSDOM(html, { url: "https://example.test/", runScripts: "outside-only" });
const { window } = dom;

// stub the CDN libraries
window.Papa = Papa;
window.Chart = class Chart {
  constructor(el, cfg) { this.cfg = cfg; Chart.created.push({ el: el && el.id, cfg }); }
  destroy() {}
};
window.Chart.created = [];
window.Chart.defaults = { color: "", borderColor: "", font: {} };
window.confirm = () => true;

window.eval(appJs);
const app = window.__etd;

let failed = 0;
const assert = (cond, msg) => {
  console.log((cond ? "PASS" : "FAIL") + "  " + msg);
  if (!cond) failed++;
};

// 1 — detection by headers
assert(app.detectDataset(["SessionId", "EventType", "CashDelta"], "x.csv") === "events", "detects event stream by EventType");
assert(app.detectDataset(["SessionId", "Outcome", "Rank"], "x.csv") === "runs", "detects run summary by Outcome");
assert(app.detectDataset(["SessionId", "Day", "TotalDebt"], "x.csv") === "daily", "detects daily history by TotalDebt+Day");
assert(app.detectDataset(["session_id", "event_type"], "x.csv") === "events", "detection tolerates snake_case headers");
assert(app.detectDataset(["A", "B"], "EscapeDebt_RunSummary.csv") === "runs", "falls back to filename");
assert(app.detectDataset(["A", "B"], "random.csv") === null, "rejects unknown files");

// 2 — ingest all three sample files
const files = ["EscapeDebt_Analytics.csv", "EscapeDebt_RunSummary.csv", "EscapeDebt_DailyHistory.csv"];
const texts = {};
for (const f of files) {
  texts[f] = fs.readFileSync(path.join(root, "sample_data", f), "utf8");
  app.ingestParsed(Papa.parse(texts[f], { header: true, skipEmptyLines: true }), f);
}
assert(app.state.events.length === 271, `events rows loaded (got ${app.state.events.length}, want 271)`);
assert(app.state.runs.length === 6, `run rows loaded (got ${app.state.runs.length}, want 6)`);
assert(app.state.daily.length === 58, `daily rows loaded (got ${app.state.daily.length}, want 58)`);

// 3 — re-upload = no duplicates
for (const f of files) app.ingestParsed(Papa.parse(texts[f], { header: true, skipEmptyLines: true }), f);
assert(app.state.events.length === 271 && app.state.runs.length === 6 && app.state.daily.length === 58,
  "re-uploading the same files adds zero duplicate rows");

// 4 — appended file merges only new rows
const lines = texts["EscapeDebt_RunSummary.csv"].trimEnd().split(/\r?\n/);
const appended = lines.concat([lines[1].replace(/^[^,]+/, "NEWSESSION-0001")]).join("\n");
app.ingestParsed(Papa.parse(appended, { header: true, skipEmptyLines: true }), "EscapeDebt_RunSummary.csv");
assert(app.state.runs.length === 7, `appended export merges only the new row (got ${app.state.runs.length}, want 7)`);

// 5 — dashboard rendered
const doc = window.document;
assert(doc.getElementById("kpi-runs").textContent === "7", "KPI shows run count");
assert(doc.getElementById("kpi-winrate").textContent.includes("%"), "win rate rendered");
const chartIds = window.Chart.created.map((c) => c.el);
for (const id of ["outcomeChart", "modeChart", "trajChart", "eventTypeChart", "stressDeltaChart"]) {
  assert(chartIds.includes(id), `chart rendered: ${id}`);
}
assert(doc.querySelectorAll("#runTable tbody tr").length === 7, "run table lists every run");
assert(doc.querySelectorAll("#eventTable tbody tr").length === 20, "event explorer paginates to 20 rows");
assert(doc.querySelector('.slot[data-slot="events"]').classList.contains("loaded"), "slot flips to loaded state");

// 6 — clear resets everything
app.clearAll();
assert(app.state.runs.length === 0 && !doc.querySelector(".slot.loaded"), "clear all empties state and slots");

console.log(failed ? `\n${failed} test(s) FAILED` : "\nAll tests passed");
process.exit(failed ? 1 : 0);
