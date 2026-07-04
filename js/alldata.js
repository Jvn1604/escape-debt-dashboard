/* Escape The Debt — All Data page (all-data.html)
   Combined view of everything collected: overview KPIs, collection charts,
   per-session coverage, and the full raw tables for all three datasets. */

(function () {
  "use strict";

  const { state, DATASETS, SLOT_LABEL, FILE_NAME, C, G, N, norm, esc, fmt, makeChart, downloadCSV, fieldOrder } = window.ETD;
  const PAGE_SIZE = 15;
  const pageOf = { events: 0, runs: 0, daily: 0 };
  const $ = (sel) => document.querySelector(sel);

  window.renderPage = function () {
    const any = DATASETS.some((ds) => state[ds].length > 0);
    $("#ad-empty").hidden = any;
    $("#ad-content").hidden = !any;
    if (!any) return;
    renderOverview();
    renderCharts();
    renderCoverage();
    for (const ds of DATASETS) renderRawTable(ds);
  };

  // ---------- overview ----------
  function sessionsAcross() {
    const s = new Set();
    for (const ds of DATASETS)
      for (const r of state[ds]) s.add(G(ds, r, "SessionId"));
    s.delete(undefined);
    return s;
  }

  function dateOf(ts) {
    const m = String(ts || "").match(/\d{4}-\d{2}-\d{2}/);
    return m ? m[0] : null;
  }

  function renderOverview() {
    const totalRows = DATASETS.reduce((a, ds) => a + state[ds].length, 0);
    const players = new Set();
    const dates = [];
    for (const ds of DATASETS)
      for (const r of state[ds]) {
        const p = G(ds, r, "PlayerName");
        if (p) players.add(p);
        const d = dateOf(G(ds, r, "Timestamp"));
        if (d) dates.push(d);
      }
    dates.sort();
    $("#ad-rows").textContent = fmt(totalRows);
    $("#ad-sessions").textContent = sessionsAcross().size;
    $("#ad-players").textContent = players.size;
    $("#ad-runs").textContent = state.runs.length;
    $("#ad-range").textContent = dates.length
      ? (dates[0] === dates[dates.length - 1] ? dates[0] : `${dates[0]} → ${dates[dates.length - 1]}`)
      : "–";
    $("#ad-files").textContent = DATASETS.filter((ds) => state[ds].length).length + " / 3";
  }

  // ---------- charts ----------
  const DS_COLOR = { events: C.gold, daily: C.cyan, runs: C.green };

  function renderCharts() {
    makeChart("adRowsChart", {
      type: "bar",
      data: {
        labels: DATASETS.map((ds) => SLOT_LABEL[ds]),
        datasets: [{
          data: DATASETS.map((ds) => state[ds].length),
          backgroundColor: DATASETS.map((ds) => DS_COLOR[ds]),
        }],
      },
      options: { indexAxis: "y", maintainAspectRatio: false, plugins: { legend: { display: false } } },
    });

    // rows collected per date, stacked by dataset
    const byDate = new Map();
    for (const ds of DATASETS)
      for (const r of state[ds]) {
        const d = dateOf(G(ds, r, "Timestamp"));
        if (!d) continue;
        if (!byDate.has(d)) byDate.set(d, { events: 0, runs: 0, daily: 0 });
        byDate.get(d)[ds]++;
      }
    const dates = [...byDate.keys()].sort();
    makeChart("adTimelineChart", {
      type: "bar",
      data: {
        labels: dates,
        datasets: DATASETS.map((ds) => ({
          label: SLOT_LABEL[ds],
          data: dates.map((d) => byDate.get(d)[ds]),
          backgroundColor: DS_COLOR[ds],
        })),
      },
      options: {
        maintainAspectRatio: false,
        scales: { x: { stacked: true }, y: { stacked: true, title: { display: true, text: "rows" } } },
        plugins: { legend: { position: "bottom" } },
      },
    });
  }

  // ---------- session coverage ----------
  function renderCoverage() {
    const info = new Map(); // sid -> {player, mode, events, daily, runs, outcomes}
    const bump = (ds, r) => {
      const sid = G(ds, r, "SessionId");
      if (sid === undefined) return;
      if (!info.has(sid)) info.set(sid, { player: "", mode: "", events: 0, daily: 0, runs: 0, outcomes: [] });
      const e = info.get(sid);
      e[ds]++;
      if (!e.player) e.player = G(ds, r, "PlayerName") || "";
      if (!e.mode) e.mode = G(ds, r, "Mode") || "";
      if (ds === "runs") {
        const o = G(ds, r, "Outcome");
        if (o) e.outcomes.push(o);
      }
    };
    for (const ds of DATASETS) for (const r of state[ds]) bump(ds, r);

    const cell = (n) => `<td class="num${n === 0 ? " missing" : ""}">${n === 0 ? "missing" : fmt(n)}</td>`;
    $("#coverageTable tbody").innerHTML = [...info.entries()].map(([sid, e]) => {
      const mode = e.mode ? (norm(e.mode) === "guided" ? "Guided" : "Standard") : "";
      return `<tr>
        <td class="mono">…${esc(String(sid).slice(-10))}</td>
        <td>${esc(e.player)}</td>
        <td>${mode ? `<span class="chip ${mode.toLowerCase()}">${mode}</span>` : ""}</td>
        ${cell(e.events)}${cell(e.daily)}${cell(e.runs)}
        <td>${e.outcomes.map((o) => `<span class="chip ${norm(o)}">${esc(o)}</span>`).join(" ")}</td>
      </tr>`;
    }).join("");
    $("#coverageCount").textContent = `${info.size} sessions`;
  }

  // ---------- full raw tables ----------
  function cols(ds) {
    return fieldOrder[ds] || Object.keys(state[ds][0] || {});
  }

  function renderRawTable(ds) {
    const rows = state[ds];
    const table = $(`#raw-${ds} table`);
    if (!rows.length) { table.querySelector("thead").innerHTML = ""; table.querySelector("tbody").innerHTML = ""; return; }
    const fields = cols(ds);
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    pageOf[ds] = Math.min(pageOf[ds], pages - 1);
    const slice = rows.slice(pageOf[ds] * PAGE_SIZE, (pageOf[ds] + 1) * PAGE_SIZE);

    table.querySelector("thead").innerHTML =
      "<tr>" + fields.map((f) => `<th>${esc(f)}</th>`).join("") + "</tr>";
    table.querySelector("tbody").innerHTML = slice.map((r) =>
      "<tr>" + fields.map((f) => {
        const v = r[f];
        const isNum = v !== "" && v !== undefined && Number.isFinite(parseFloat(v)) && /^[-+]?[\d.]+$/.test(String(v).trim());
        return `<td class="${isNum ? "num" : ""}">${esc(v)}</td>`;
      }).join("") + "</tr>").join("");

    $(`#rawInfo-${ds}`).textContent = `${fmt(rows.length)} rows · ${fields.length} columns · page ${pageOf[ds] + 1}/${pages}`;
    $(`#rawPrev-${ds}`).disabled = pageOf[ds] === 0;
    $(`#rawNext-${ds}`).disabled = pageOf[ds] >= pages - 1;
  }

  // ---------- wiring ----------
  for (const ds of DATASETS) {
    $(`#rawPrev-${ds}`).addEventListener("click", () => { pageOf[ds]--; renderRawTable(ds); });
    $(`#rawNext-${ds}`).addEventListener("click", () => { pageOf[ds]++; renderRawTable(ds); });
    $(`#rawExport-${ds}`).addEventListener("click", () =>
      downloadCSV(ds, FILE_NAME[ds].replace(".csv", "_merged.csv")));
  }
})();
