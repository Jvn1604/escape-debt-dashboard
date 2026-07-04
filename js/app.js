/* Escape The Debt — Analytics Dashboard
   Static, client-side only. CSVs are detected by their column headers:
     - has "EventType"            -> Event Stream   (EscapeDebt_Analytics.csv)
     - has "Outcome"              -> Run Summary    (EscapeDebt_RunSummary.csv)
     - has "TotalDebt" and "Day"  -> Daily History  (EscapeDebt_DailyHistory.csv)
   Re-uploads are merged with full-row dedupe, so appended files are safe. */

(function () {
  "use strict";

  // ---------- constants ----------
  const STORE_KEY = "etd-dashboard-v1";
  const PAGE_SIZE = 20;
  const C = {
    gold: "#e9b44c", cyan: "#57c7dd", magenta: "#e15b87",
    green: "#46c68f", amber: "#f0a24c", muted: "#8da0b2",
    line: "#26313f", text: "#e9eef3",
  };
  const SLOT_LABEL = { events: "Event Stream", runs: "Run Summary", daily: "Daily History" };

  // ---------- state ----------
  const state = { events: [], runs: [], daily: [] };
  const keySets = { events: new Set(), runs: new Set(), daily: new Set() };
  const colMaps = { events: null, runs: null, daily: null }; // normalized -> actual header
  const charts = {};
  let metric = "TotalDebt";
  let runSort = { key: "CompositeScore", dir: -1 };
  let evFilter = { session: "", type: "", search: "", page: 0 };

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
    $("#toast").textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ($("#toast").textContent = ""), 6000);
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

  function mergeRows(ds, rows) {
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
    const added = mergeRows(ds, rows);
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
      for (const ds of ["events", "runs", "daily"]) {
        if (Array.isArray(saved[ds]) && saved[ds].length) mergeRows(ds, saved[ds]);
      }
      renderAll();
    } catch (e) { /* corrupt store — start clean */ }
  }
  function clearAll() {
    for (const ds of ["events", "runs", "daily"]) {
      state[ds] = [];
      keySets[ds].clear();
      colMaps[ds] = null;
    }
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
    evFilter = { session: "", type: "", search: "", page: 0 };
    renderAll();
    toast("All data cleared.");
  }

  // ---------- rendering ----------
  function renderAll() {
    for (const ds of ["events", "runs", "daily"]) {
      const loaded = state[ds].length > 0;
      const slot = document.querySelector(`.slot[data-slot="${ds}"]`);
      slot.classList.toggle("loaded", loaded);
      $(`#status-${ds}`).textContent = loaded ? "Loaded" : "Waiting for file";
      $(`#meta-${ds}`).textContent = loaded
        ? `${state[ds].length} rows · ${countSessions(ds)} sessions`
        : "";
      document.querySelectorAll(`[data-empty="${ds}"]`).forEach((el) => (el.hidden = loaded));
      document.querySelectorAll(`[data-full="${ds}"]`).forEach((el) => (el.hidden = !loaded));
    }
    $("#exportRunsBtn").hidden = state.runs.length === 0;
    if (state.runs.length) { renderOverview(); renderOutcomes(); renderRunTable(); }
    if (state.daily.length) renderTrajectories();
    if (state.events.length) renderEvents();
  }

  function countSessions(ds) {
    const s = new Set();
    for (const row of state[ds]) s.add(G(ds, row, "SessionId"));
    return s.size;
  }

  // --- overview KPIs ---
  function renderOverview() {
    const runs = state.runs;
    const wins = runs.filter((r) => norm(G("runs", r, "Outcome")) === "win").length;
    $("#kpi-runs").textContent = runs.length;
    $("#kpi-players").textContent = new Set(runs.map((r) => G("runs", r, "PlayerName"))).size;
    $("#kpi-winrate").textContent = fmtPct((wins / runs.length) * 100);
    $("#kpi-debtpct").textContent = fmtPct(avg(runs.map((r) => N("runs", r, "DebtReductionPct")).filter(Number.isFinite)));
    $("#kpi-stress").textContent = fmtPct(avg(runs.map((r) => N("runs", r, "FinalStress")).filter(Number.isFinite)));
    $("#kpi-score").textContent = fmt(avg(runs.map((r) => N("runs", r, "CompositeScore")).filter(Number.isFinite)));
  }

  // --- outcomes + mode comparison ---
  function makeChart(id, cfg) {
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart($("#" + id), cfg);
  }

  function renderOutcomes() {
    const runs = state.runs;
    const counts = {};
    for (const r of runs) {
      const o = G("runs", r, "Outcome") || "Unknown";
      counts[o] = (counts[o] || 0) + 1;
    }
    const labels = Object.keys(counts);
    const colorFor = (o) =>
      ({ win: C.green, burnout: C.magenta, survived: C.amber }[norm(o)] || C.muted);
    makeChart("outcomeChart", {
      type: "doughnut",
      data: {
        labels,
        datasets: [{
          data: labels.map((l) => counts[l]),
          backgroundColor: labels.map(colorFor),
          borderColor: "#161c25",
          borderWidth: 3,
        }],
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { position: "bottom" } },
        cutout: "62%",
      },
    });

    const byMode = { Standard: [], Guided: [] };
    for (const r of runs) {
      const m = norm(G("runs", r, "Mode")) === "guided" ? "Guided" : "Standard";
      byMode[m].push(r);
    }
    const stat = (rows, col) => avg(rows.map((r) => N("runs", r, col)).filter(Number.isFinite));
    const winRate = (rows) =>
      rows.length ? (rows.filter((r) => norm(G("runs", r, "Outcome")) === "win").length / rows.length) * 100 : NaN;

    makeChart("modeChart", {
      type: "bar",
      data: {
        labels: ["Win rate", "Debt reduced %", "Final stress"],
        datasets: [
          { label: `Standard (${byMode.Standard.length})`, backgroundColor: C.gold,
            data: [winRate(byMode.Standard), stat(byMode.Standard, "DebtReductionPct"), stat(byMode.Standard, "FinalStress")] },
          { label: `Guided (${byMode.Guided.length})`, backgroundColor: C.cyan,
            data: [winRate(byMode.Guided), stat(byMode.Guided, "DebtReductionPct"), stat(byMode.Guided, "FinalStress")] },
        ],
      },
      options: {
        maintainAspectRatio: false,
        scales: { y: { min: 0, max: 100, ticks: { callback: (v) => v + "%" } } },
        plugins: { legend: { position: "bottom" } },
      },
    });

    $("#modeStats").innerHTML = ["Standard", "Guided"].map((m) => {
      const rows = byMode[m];
      return `<div class="ms">${m}: <b>${fmt(stat(rows, "CompositeScore"))}</b> avg score ·
              <b>${fmt(stat(rows, "DaysUsed"), 1)}</b> avg days</div>`;
    }).join("");
  }

  // --- daily trajectories ---
  function renderTrajectories() {
    // group by session, sort by timestamp, split into segments when Day resets
    const bySession = new Map();
    for (const row of state.daily) {
      const sid = G("daily", row, "SessionId");
      if (!bySession.has(sid)) bySession.set(sid, []);
      bySession.get(sid).push(row);
    }
    const datasets = [];
    for (const [sid, rows] of bySession) {
      rows.sort((a, b) => String(G("daily", a, "Timestamp")).localeCompare(String(G("daily", b, "Timestamp"))));
      let seg = [], prevDay = -Infinity, segIdx = 0;
      const flush = () => {
        if (!seg.length) return;
        const first = seg[0];
        const guided = norm(G("daily", first, "Mode")) === "guided";
        datasets.push({
          label: `${G("daily", first, "PlayerName") || "?"} (${guided ? "Guided" : "Standard"})${segIdx ? " #" + (segIdx + 1) : ""}`,
          data: seg.map((r) => ({ x: N("daily", r, "Day"), y: N("daily", r, metric) })),
          borderColor: guided ? C.cyan : C.gold,
          backgroundColor: "transparent",
          borderWidth: 2,
          pointRadius: 2.5,
          tension: 0.25,
        });
        segIdx++;
        seg = [];
      };
      for (const r of rows) {
        const d = N("daily", r, "Day");
        if (d <= prevDay) flush();
        seg.push(r);
        prevDay = d;
      }
      flush();
    }
    const money = metric === "Cash" || metric === "TotalDebt";
    makeChart("trajChart", {
      type: "line",
      data: { datasets },
      options: {
        maintainAspectRatio: false,
        scales: {
          x: { type: "linear", title: { display: true, text: "In-game day" }, ticks: { stepSize: 1 } },
          y: { title: { display: true, text: metric }, ticks: money ? { callback: (v) => "RM " + v } : {} },
        },
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 10 } } },
          tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${money ? fmtRM(c.parsed.y) : fmt(c.parsed.y, 1)}` } },
        },
      },
    });
  }

  // --- event stream ---
  function renderEvents() {
    const ev = state.events;
    const byType = new Map();
    for (const r of ev) {
      const t = G("events", r, "EventType") || "Unknown";
      if (!byType.has(t)) byType.set(t, { count: 0, stress: [] });
      const b = byType.get(t);
      b.count++;
      const sd = N("events", r, "StressDelta");
      if (Number.isFinite(sd)) b.stress.push(sd);
    }
    const types = [...byType.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 12);

    makeChart("eventTypeChart", {
      type: "bar",
      data: {
        labels: types.map(([t]) => t),
        datasets: [{ data: types.map(([, b]) => b.count), backgroundColor: C.gold }],
      },
      options: {
        indexAxis: "y",
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
      },
    });

    const stressed = types
      .map(([t, b]) => [t, avg(b.stress)])
      .filter(([, v]) => Number.isFinite(v))
      .sort((a, b) => a[1] - b[1]);
    makeChart("stressDeltaChart", {
      type: "bar",
      data: {
        labels: stressed.map(([t]) => t),
        datasets: [{
          data: stressed.map(([, v]) => v),
          backgroundColor: stressed.map(([, v]) => (v <= 0 ? C.green : C.magenta)),
        }],
      },
      options: {
        indexAxis: "y",
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
      },
    });

    // filter dropdowns (preserve selection)
    const sessions = new Map();
    for (const r of ev) {
      const sid = G("events", r, "SessionId");
      if (!sessions.has(sid)) sessions.set(sid, G("events", r, "PlayerName") || "?");
    }
    fillSelect($("#fltSession"), [...sessions.entries()].map(([sid, name]) =>
      [sid, `${name} · …${String(sid).slice(-6)}`]), evFilter.session, "All sessions");
    fillSelect($("#fltType"), [...byType.keys()].sort().map((t) => [t, t]), evFilter.type, "All event types");

    renderEventTable();
  }

  function fillSelect(sel, pairs, current, allLabel) {
    sel.innerHTML = `<option value="">${esc(allLabel)}</option>` +
      pairs.map(([v, l]) => `<option value="${esc(v)}"${v === current ? " selected" : ""}>${esc(l)}</option>`).join("");
  }

  function filteredEvents() {
    const q = evFilter.search.toLowerCase();
    return state.events.filter((r) => {
      if (evFilter.session && G("events", r, "SessionId") !== evFilter.session) return false;
      if (evFilter.type && G("events", r, "EventType") !== evFilter.type) return false;
      if (q) {
        const hay = `${G("events", r, "EventName")} ${G("events", r, "Choice")} ${G("events", r, "Scene")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function deltaCell(v, invertGood) {
    if (!Number.isFinite(v) || v === 0) return `<td class="num">${Number.isFinite(v) ? fmt(v, 1) : ""}</td>`;
    const good = invertGood ? v < 0 : v > 0;
    return `<td class="num ${good ? "pos" : "neg"}">${v > 0 ? "+" : ""}${fmt(v, 1)}</td>`;
  }

  function renderEventTable() {
    const rows = filteredEvents();
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    evFilter.page = Math.min(evFilter.page, pages - 1);
    const slice = rows.slice(evFilter.page * PAGE_SIZE, (evFilter.page + 1) * PAGE_SIZE);
    $("#eventTable tbody").innerHTML = slice.map((r) => `
      <tr>
        <td>${esc(G("events", r, "Timestamp"))}</td>
        <td class="num">${esc(G("events", r, "Day"))}</td>
        <td>${esc(G("events", r, "PlayerName"))}</td>
        <td>${esc(G("events", r, "EventType"))}</td>
        <td>${esc(G("events", r, "EventName"))}</td>
        <td>${esc(G("events", r, "Choice"))}</td>
        ${deltaCell(N("events", r, "CashDelta"), false)}
        ${deltaCell(N("events", r, "DebtDelta"), true)}
        ${deltaCell(N("events", r, "StressDelta"), true)}
      </tr>`).join("");
    $("#fltCount").textContent = `${rows.length} events`;
    $("#pgInfo").textContent = `Page ${evFilter.page + 1} / ${pages}`;
    $("#pgPrev").disabled = evFilter.page === 0;
    $("#pgNext").disabled = evFilter.page >= pages - 1;
  }

  // --- run table ---
  function renderRunTable() {
    const rows = [...state.runs];
    const { key, dir } = runSort;
    rows.sort((a, b) => {
      const na = N("runs", a, key), nb = N("runs", b, key);
      if (Number.isFinite(na) && Number.isFinite(nb)) return (na - nb) * dir;
      return String(G("runs", a, key) ?? "").localeCompare(String(G("runs", b, key) ?? "")) * dir;
    });
    $("#runTable tbody").innerHTML = rows.map((r) => {
      const outcome = G("runs", r, "Outcome") || "?";
      const mode = norm(G("runs", r, "Mode")) === "guided" ? "Guided" : "Standard";
      const cleared = norm(G("runs", r, "DebtCleared")) === "true";
      return `<tr>
        <td>${esc(G("runs", r, "PlayerName"))}</td>
        <td><span class="chip ${mode.toLowerCase()}">${mode}</span></td>
        <td><span class="chip ${norm(outcome)}">${esc(outcome)}</span>${cleared ? ' <span class="chip win">CLEARED</span>' : ""}</td>
        <td>${esc(G("runs", r, "Rank"))}</td>
        <td class="num">${esc(G("runs", r, "DaysUsed"))}/${esc(G("runs", r, "MaxDays"))}</td>
        <td class="num">${fmtRM(N("runs", r, "DebtReduced"))}</td>
        <td class="num">${fmtPct(N("runs", r, "DebtReductionPct"))}</td>
        <td class="num">${fmtPct(N("runs", r, "FinalStress"))}</td>
        <td class="num">${fmt(N("runs", r, "CompositeScore"))}</td>
      </tr>`;
    }).join("");
  }

  // ---------- events / wiring ----------
  document.querySelectorAll(".slot").forEach((slot) =>
    slot.addEventListener("click", () => $("#fileInput").click()));
  $("#fileInput").addEventListener("change", (e) => {
    handleFiles(e.target.files);
    e.target.value = "";
  });

  // full-page drag & drop
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

  $("#clearBtn").addEventListener("click", () => {
    if (confirm("Remove all loaded data from this dashboard?")) clearAll();
  });

  $("#loadSampleBtn").addEventListener("click", async () => {
    const files = ["EscapeDebt_Analytics.csv", "EscapeDebt_RunSummary.csv", "EscapeDebt_DailyHistory.csv"];
    for (const f of files) {
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

  $("#exportRunsBtn").addEventListener("click", () => {
    const csv = Papa.unparse(state.runs);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "EscapeDebt_RunSummary_merged.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $("#metricSeg").addEventListener("click", (e) => {
    const btn = e.target.closest(".seg-btn");
    if (!btn) return;
    metric = btn.dataset.metric;
    document.querySelectorAll("#metricSeg .seg-btn").forEach((b) => b.classList.toggle("active", b === btn));
    if (state.daily.length) renderTrajectories();
  });

  $("#fltSession").addEventListener("change", (e) => { evFilter.session = e.target.value; evFilter.page = 0; renderEventTable(); });
  $("#fltType").addEventListener("change", (e) => { evFilter.type = e.target.value; evFilter.page = 0; renderEventTable(); });
  $("#fltSearch").addEventListener("input", (e) => { evFilter.search = e.target.value; evFilter.page = 0; renderEventTable(); });
  $("#pgPrev").addEventListener("click", () => { evFilter.page--; renderEventTable(); });
  $("#pgNext").addEventListener("click", () => { evFilter.page++; renderEventTable(); });

  document.querySelectorAll("#runTable th[data-sort]").forEach((th) =>
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      runSort = { key, dir: runSort.key === key ? -runSort.dir : -1 };
      renderRunTable();
    }));

  // ---------- chart theme ----------
  Chart.defaults.color = C.muted;
  Chart.defaults.borderColor = C.line;
  Chart.defaults.font.family = '"IBM Plex Mono", monospace';
  Chart.defaults.font.size = 11;

  // ---------- go ----------
  renderAll();
  restore();

  // test hook (used by tools/test.js — harmless in production)
  window.__etd = { detectDataset, ingestParsed, clearAll, state };
})();
