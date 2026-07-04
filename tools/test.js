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
const REAL_GEQ_HEADER = "\"participant_id\",\"gender\",\"game\",\"started_at\",\"finished_at\",\"duration_seconds\",\"demo_age\",\"demo_gaming_freq\",\"core_item1\",\"core_item2\",\"core_item3\",\"core_item4\",\"core_item5\",\"core_item6\",\"core_item7\",\"core_item8\",\"core_item9\",\"core_item10\",\"core_item11\",\"core_item12\",\"core_item13\",\"core_item14\",\"core_item15\",\"core_item16\",\"core_item17\",\"core_item18\",\"core_item19\",\"core_item20\",\"core_item21\",\"core_item22\",\"core_item23\",\"core_item24\",\"core_item25\",\"core_item26\",\"core_item27\",\"core_item28\",\"core_item29\",\"core_item30\",\"core_item31\",\"core_item32\",\"core_item33\",\"core_score_Competence\",\"core_score_Sensory_and_Imaginative_Immersion\",\"core_score_Flow\",\"core_score_Tension_Annoyance\",\"core_score_Challenge\",\"core_score_Negative_Affect\",\"core_score_Positive_Affect\",\"postgame_item1\",\"postgame_item2\",\"postgame_item3\",\"postgame_item4\",\"postgame_item5\",\"postgame_item6\",\"postgame_item7\",\"postgame_item8\",\"postgame_item9\",\"postgame_item10\",\"postgame_item11\",\"postgame_item12\",\"postgame_item13\",\"postgame_item14\",\"postgame_item15\",\"postgame_item16\",\"postgame_item17\",\"postgame_score_Positive_Experience\",\"postgame_score_Negative_Experience\",\"postgame_score_Tiredness\",\"postgame_score_Returning_to_Reality\"";

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

  // regression: real exports have no Mode column and d/m/yyyy timestamps
  app.clearAll();
  const noMode = 'SessionId,PlayerName,Timestamp,Outcome,Rank,DaysUsed,MaxDays,DebtReduced,DebtReductionPct,FinalStress,CompositeScore\n' +
                 'S1,me3,21/6/2026 20:22,Survived,C,3,10,1000,25,40,5000\n';
  app.ingestParsed(parsed(noMode), "EscapeDebt_RunSummary.csv");
  assert(doc.querySelector("#modeCard .nomode-note").hidden === false, "mode card explains itself when Mode column is absent");
  assert(doc.querySelector("#modeCard .chart-box").hidden === true, "mode chart hidden when Mode column is absent");
  assert(doc.getElementById("kpi-debtpct").textContent === "25%", "KPIs still render from mode-less export");
  assert(win.ETD.parseTs("2/6/2026 1:05") < win.ETD.parseTs("10/6/2026 1:05"), "d/m/yyyy timestamps sort chronologically");
  app.clearAll();
}

/* ================= All Data / Conclusions page ================= */
console.log("--- all-data.html ---");
{
  const win = boot("all-data.html", ["core.js", "alldata.js"]);
  const app = win.__etd;
  const doc = win.document;

  // GEQ detection — synthetic headers, real export header row, filename fallback
  assert(app.detectDataset(["participant_id", "core_score_Flow", "core_score_Competence"], "x.csv") === "geq",
    "detects GEQ by participant_id + core_score columns");
  const realHeader = REAL_GEQ_HEADER;
  const realFields = Papa.parse(realHeader).data[0];
  assert(app.detectDataset(realFields, "geq_all_2026-07-04.csv") === "geq",
    `real geq-toolkit export header (${realFields.length} cols) detected as GEQ`);
  assert(app.detectDataset(["A", "B"], "geq_all_2026-07-04.csv") === "geq", "filename fallback for geq exports");

  assert(doc.getElementById("ad-empty").hidden === false, "empty notice shown before any data");

  // load runs + geq samples -> conclusions, GEQ charts and combined section
  app.ingestParsed(parsed(texts["EscapeDebt_RunSummary.csv"]), "EscapeDebt_RunSummary.csv");
  app.ingestParsed(parsed(read("sample_data", "geq_all.csv")), "geq_all.csv");

  assert(doc.getElementById("ad-content").hidden === false, "content appears once data is loaded");
  const verdicts = doc.querySelectorAll("#verdictList .verdict");
  assert(verdicts.length >= 5, `conclusions generated (got ${verdicts.length} verdict items)`);
  assert([...verdicts].some((v) => v.textContent.includes("win rate")), "gameplay conclusion mentions win rate");
  assert([...verdicts].some((v) => v.textContent.includes("Positive Affect")), "GEQ conclusion mentions Positive Affect");
  assert([...verdicts].some((v) => /r = -?\d/.test(v.textContent)), "combined conclusion reports a correlation");

  const chartIds = win.Chart.created.map((c) => c.el);
  for (const id of ["adOutcomeChart", "adModeChart", "geqRadarChart", "geqPostChart", "combScatter"]) {
    assert(chartIds.includes(id), `chart rendered: ${id}`);
  }
  assert(doc.querySelectorAll("#geqTable tbody tr").length === 5, "GEQ table lists all 5 participants");
  assert(doc.getElementById("combinedSec").hidden === false, "combined section visible when IDs match");
  assert(doc.querySelectorAll("#matchTable tbody tr").length === 5, "all 5 participants matched to game runs");
  assert(doc.getElementById("combR").textContent.includes("n = 5"), "correlation reports n = 5");
  assert(doc.getElementById("unmatchedNote").textContent === "", "no unmatched-participants warning when all match");
  assert(doc.getElementById("status-geq").textContent === "Loaded", "GEQ slot flips to loaded");
  assert(doc.getElementById("dl-events").disabled === true && doc.getElementById("dl-runs").disabled === false,
    "download buttons reflect which datasets are loaded");

  // unmatched participant is reported
  const geqLines = read("sample_data", "geq_all.csv").trimEnd().split(/\r?\n/);
  const stranger = geqLines[0] + "\n" + geqLines[1].replace('"Kayal"', '"Stranger"');
  app.ingestParsed(parsed(stranger), "geq_all.csv");
  assert(doc.getElementById("unmatchedNote").textContent.includes("Stranger"),
    "unmatched GEQ participant is flagged with a hint");

  // matchKey pairs PO1 with P01 (letter O vs zero)
  assert(win.ETD.matchKey("PO1") === win.ETD.matchKey("p01"), "matchKey pairs PO1 with P01");

  // GEQ link points at the toolkit
  assert(doc.getElementById("geqLink").href.includes("geq-toolkit"), "GEQ nav link targets the geq-toolkit site");
}

console.log(failed ? `\n${failed} test(s) FAILED` : "\nAll tests passed");
process.exit(failed ? 1 : 0);
