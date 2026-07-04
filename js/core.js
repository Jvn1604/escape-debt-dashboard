/* Escape The Debt — Analytics Dashboard · shared core
   Loaded on every page BEFORE the page script. Handles CSV detection,
   merging/dedupe, localStorage persistence, drag & drop, slots and chart theme.
   Each page defines window.renderPage(), which the core calls after any data change.

   CSVs are detected by their column headers:
     - has "EventType"            -> Event Stream   (EscapeDebt_Analytics.csv)
     - has "Outcome"              -> Run Summary    (EscapeDebt_RunSummary.csv)
     - has "TotalDebt" and "Day"  -> Daily History  (EscapeDebt_DailyHistory.csv) */

(function () {
  "use strict";

  // ====== EDIT ME: link to your GEQ Toolkit (leave "" to hide the nav link) ======
  const GEQ_URL = "https://jvn1604.github.io/geq-toolkit/";
  // ===============================================================================

  const STORE_KEY = "etd-dashboard-v1";
  const C = {
    gold: "#e9b44c", cyan: "#57c7dd", magenta: "#e15b87",
    green: "#46c68f", amber: "#f0a24c", muted: "#8da0b2",
    line: "#26313f", text: "#e9eef3", panel: "#161c25",
  };
  const SLOT_LABEL = { events: "Event Stream", runs: "Run Summary", daily: "Daily History" };
  const FILE_NAME = {
    events: "EscapeDebt_Analytics.csv",
    runs: "EscapeDebt_RunSummary.csv",
    daily: "EscapeDebt_DailyHistory.csv",
  };
  const DATASETS = ["events", "runs", "daily"];

  // ---------- state ----------
  const state = { events: [], runs: [], daily: [] };
  const keySets = { events: new Set(), runs: new Set(), daily: new Set() };
  const colMaps = { events: null, runs: null, daily: null }; // normalized -> actual header
  const fieldOrder = { events: null, runs: null, daily: null }; // original column order
  const charts = {};

  // ---------- utils ----------
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
  const rowKey = (row) => JSON.stringify(Object.entries(row).sort());
  const $ = (sel) => document.querySelector(sel);

  function buildColMap(ds) {
    const map = {};
    const sample = state[ds][0];
    if (sample) for (const k of Object.keys(sample)) map[norm(k)] = k;
    colMaps[ds] = map;
  }
  function G(ds, row, name) {
    const actual = colMaps[ds] && colMaps[ds][norm(name)];
    return actual !== undefined ? row[actual] : undefined;
  }
  function N(ds, row, name) {
    const v = parseFloat(G(ds, row, name));
    return Number.isFinite(v) ? v : NaN;
  }
  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : NaN);
  const fmt = (n, d = 0) =>
    Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: 0 }) : "–";
  const fmtRM = (n) => (Number.isFinite(n) ? "RM " + fmt(n) : "–");
  const fmtPct = (n) => (Number.isFinite(n) ? fmt(n, 1) + "%" : "–");
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let toastTimer;
  function toast(msg) {
    const el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.textContent = ""), 6000);
  }

  function countSessions(ds) {
    const s = new Set();
    for (const row of state[ds]) s.add(G(ds, row, "SessionId"));
    return s.size;
  }

  // ---------- detection & merge ----------
  function detectDataset(fields, filename) {
    const f = new Set(fields.map(norm));
    if (f.has("eventtype")) return "events";
    if (f.has("outcome")) return "runs";
    if (f.has("totaldebt") && f.has("day")) return "daily";
    const name = norm(filename || "");
    if (name.includes("analytics")) return "events";
    if (name.includes("runsummary")) return "runs";
    if (name.includes("dailyhistory")) return "daily";
    return null;
  }

  function mergeRows(ds, rows, fields) {
    let added = 0;
    for (const row of rows) {
      const k = rowKey(row);
      if (!keySets[ds].has(k)) {
        keySets[ds].add(k);
        state[ds].push(row);
        added++;
      }
    }
    if (!colMaps[ds]) buildColMap(ds);
    if (!fieldOrder[ds]) {
      fieldOrder[ds] = fields && fields.length ? fields : Object.keys(state[ds][0] || {});
    }
    return added;
  }

  function ingestParsed(results, filename) {
    const fields = results.meta && results.meta.fields ? results.meta.fields : [];
    const ds = detectDataset(fields, filename);
    if (!ds) {
      toast(`"${filename}" not recognised — headers don't match any of the three exports.`);
      return;
    }
    const rows = results.data.filter((r) => Object.values(r).some((v) => String(v).trim() !== ""));
    const added = mergeRows(ds, rows, fields);
    toast(`${filename} → ${SLOT_LABEL[ds]}: ${added} new row${added === 1 ? "" : "s"}${added < rows.length ? ` (${rows.length - added} duplicates skipped)` : ""}`);
    renderAll();
    save();
  }

  function handleFiles(fileList) {
    for (const file of fileList) {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (res) => ingestParsed(res, file.name),
        error: () => toast(`Could not read ${file.name}.`),
      });
    }
  }

  // ---------- persistence ----------
  function save() {
    try {
      const json = JSON.stringify(state);
      if (json.length > 4_500_000) return; // too big for localStorage; keep session-only
      localStorage.setItem(STORE_KEY, json);
    } catch (e) { /* private mode / quota — session-only is fine */ }
  }
  function restore() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      for (const ds of DATASETS) {
        if (Array.isArray(saved[ds]) && saved[ds].length) mergeRows(ds, saved[ds]);
      }
      renderAll();
    } catch (e) { /* corrupt store — start clean */ }
  }
  function clearAll() {
    for (const ds of DATASETS) {
      state[ds] = [];
      keySets[ds].clear();
      colMaps[ds] = null;
      fieldOrder[ds] = null;
    }
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
    renderAll();
    toast("All data cleared.");
  }

  // ---------- shared rendering ----------
  function renderAll() {
    for (const ds of DATASETS) {
      const loaded = state[ds].length > 0;
      const slot = document.querySelector(`.slot[data-slot="${ds}"]`);
      if (slot) {
        slot.classList.toggle("loaded", loaded);
        $(`#status-${ds}`).textContent = loaded ? "Loaded" : "Waiting for file";
        $(`#meta-${ds}`).textContent = loaded ? `${state[ds].length} rows · ${countSessions(ds)} sessions` : "";
      }
      document.querySelectorAll(`[data-empty="${ds}"]`).forEach((el) => (el.hidden = loaded));
      document.querySelectorAll(`[data-full="${ds}"]`).forEach((el) => (el.hidden = !loaded));
    }
    if (typeof window.renderPage === "function") window.renderPage();
  }

  function makeChart(id, cfg) {
    const el = $("#" + id);
    if (!el) return;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(el, cfg);
  }

  function downloadCSV(ds, filename) {
    const cols = fieldOrder[ds];
    const csv = Papa.unparse(state[ds], cols ? { columns: cols } : undefined);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ---------- wiring (shared UI on every page) ----------
  document.querySelectorAll(".slot").forEach((slot) =>
    slot.addEventListener("click", () => $("#fileInput").click()));
  const fileInput = $("#fileInput");
  if (fileInput) fileInput.addEventListener("change", (e) => {
    handleFiles(e.target.files);
    e.target.value = "";
  });

  let dragDepth = 0;
  document.addEventListener("dragenter", (e) => {
    e.preventDefault();
    if (++dragDepth === 1) $("#dropVeil").classList.add("on");
  });
  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("dragleave", () => {
    if (--dragDepth <= 0) { dragDepth = 0; $("#dropVeil").classList.remove("on"); }
  });
  document.addEventListener("drop", (e) => {
    e.preventDefault();
    dragDepth = 0;
    $("#dropVeil").classList.remove("on");
    if (e.dataTransfer && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  });

  const clearBtn = $("#clearBtn");
  if (clearBtn) clearBtn.addEventListener("click", () => {
    if (confirm("Remove all loaded data from this dashboard?")) clearAll();
  });

  const sampleBtn = $("#loadSampleBtn");
  if (sampleBtn) sampleBtn.addEventListener("click", async () => {
    for (const ds of DATASETS) {
      const f = FILE_NAME[ds];
      try {
        const res = await fetch("sample_data/" + f);
        if (!res.ok) throw new Error(res.status);
        const text = await res.text();
        ingestParsed(Papa.parse(text, { header: true, skipEmptyLines: true }), f);
      } catch (err) {
        toast(`Couldn't load sample ${f} — are you running from a local file? Serve the folder or use GitHub Pages.`);
      }
    }
  });

  // GEQ Toolkit nav link
  const geqLink = $("#geqLink");
  if (geqLink) {
    if (GEQ_URL) geqLink.href = GEQ_URL;
    else geqLink.hidden = true;
  }

  // ---------- chart theme ----------
  Chart.defaults.color = C.muted;
  Chart.defaults.borderColor = C.line;
  Chart.defaults.font.family = '"IBM Plex Mono", monospace';
  Chart.defaults.font.size = 11;

  // ---------- public API for page scripts ----------
  window.ETD = {
    state, DATASETS, SLOT_LABEL, FILE_NAME, C,
    G, N, norm, avg, fmt, fmtRM, fmtPct, esc,
    makeChart, toast, downloadCSV, countSessions,
    fieldOrder,
  };

  // test hook (used by tools/test.js — harmless in production)
  window.__etd = { detectDataset, ingestParsed, clearAll, state };

  // ---------- go ----------
  function init() {
    renderAll();
    restore();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
