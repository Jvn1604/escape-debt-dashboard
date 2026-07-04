/* Escape The Debt — Dashboard page (index.html)
   Page-specific rendering. Shared parsing/merge/persistence lives in core.js. */

(function () {
  "use strict";

  const { state, C, G, N, norm, avg, fmt, fmtRM, fmtPct, esc, makeChart, downloadCSV,
          renderOutcomeDoughnut, renderModeComparison, parseTs } = window.ETD;
  const PAGE_SIZE = 20;

  let metric = "TotalDebt";
  let runSort = { key: "CompositeScore", dir: -1 };
  let evFilter = { session: "", type: "", search: "", page: 0 };
  const $ = (sel) => document.querySelector(sel);

  // ---------- page render (called by core after any data change) ----------
  window.renderPage = function () {
    $("#exportRunsBtn").hidden = state.runs.length === 0;
    if (state.runs.length) { renderOverview(); renderOutcomes(); renderRunTable(); }
    if (state.daily.length) renderTrajectories();
    if (state.events.length) renderEvents();
  };

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

  // --- outcomes + mode comparison (shared builders in core.js) ---
  function renderOutcomes() {
    renderOutcomeDoughnut("outcomeChart");
    const ok = renderModeComparison("modeChart", "#modeStats");
    document.querySelector("#modeCard .chart-box").hidden = !ok;
    document.querySelector("#modeCard .nomode-note").hidden = ok;
    document.querySelector("#modeStats").hidden = !ok;
  }

  // --- daily trajectories ---
  function renderTrajectories() {
    const bySession = new Map();
    for (const row of state.daily) {
      const sid = G("daily", row, "SessionId");
      if (!bySession.has(sid)) bySession.set(sid, []);
      bySession.get(sid).push(row);
    }
    const datasets = [];
    for (const [, rows] of bySession) {
      rows.sort((a, b) => parseTs(G("daily", a, "Timestamp")) - parseTs(G("daily", b, "Timestamp")));
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
      options: { indexAxis: "y", maintainAspectRatio: false, plugins: { legend: { display: false } } },
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
      options: { indexAxis: "y", maintainAspectRatio: false, plugins: { legend: { display: false } } },
    });

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

  // ---------- page wiring ----------
  $("#exportRunsBtn").addEventListener("click", () =>
    downloadCSV("runs", "EscapeDebt_RunSummary_merged.csv"));

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
})();
