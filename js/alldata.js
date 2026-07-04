/* Escape The Debt — All Data / Conclusions page (all-data.html)
   Combines gameplay results (Run Summary) with GEQ questionnaire results,
   matches participants by ID, and writes an auto-generated conclusion. */

(function () {
  "use strict";

  const { state, DATASETS, FILE_NAME, C, G, N, norm, avg, fmt, fmtPct, esc, matchKey,
          makeChart, downloadCSV, renderOutcomeDoughnut, renderModeComparison, splitByMode, hasCol } = window.ETD;
  const $ = (sel) => document.querySelector(sel);

  const CORE = [
    ["Competence", "core_score_Competence"],
    ["Immersion", "core_score_Sensory_and_Imaginative_Immersion"],
    ["Flow", "core_score_Flow"],
    ["Tension", "core_score_Tension_Annoyance"],
    ["Challenge", "core_score_Challenge"],
    ["Neg. Affect", "core_score_Negative_Affect"],
    ["Pos. Affect", "core_score_Positive_Affect"],
  ];
  const POST = [
    ["Positive Experience", "postgame_score_Positive_Experience"],
    ["Negative Experience", "postgame_score_Negative_Experience"],
    ["Tiredness", "postgame_score_Tiredness"],
    ["Returning to Reality", "postgame_score_Returning_to_Reality"],
  ];
  let combComponent = "Flow";

  // ---------- manual participant links (GEQ id -> game PlayerName) ----------
  const LINK_KEY = "etd-participant-links-v1";
  let links = {};
  try { links = JSON.parse(localStorage.getItem(LINK_KEY) || "{}"); } catch (e) { links = {}; }
  function saveLinks() {
    try { localStorage.setItem(LINK_KEY, JSON.stringify(links)); } catch (e) {}
  }

  window.renderPage = function () {
    const any = DATASETS.some((ds) => state[ds].length > 0);
    $("#ad-empty").hidden = any;
    $("#ad-content").hidden = !any;
    if (!any) return;
    if (state.runs.length) {
      renderOutcomeDoughnut("adOutcomeChart");
      const ok = renderModeComparison("adModeChart", "#adModeStats");
      document.querySelector("#adModeCard .chart-box").hidden = !ok;
      document.querySelector("#adModeCard .nomode-note").hidden = ok;
      document.querySelector("#adModeStats").hidden = !ok;
    }
    if (state.geq.length) renderGeq();
    renderLinks();
    renderCombined();
    renderConclusions();
    for (const ds of DATASETS) ($(`#dl-${ds}`) || {}).disabled = state[ds].length === 0;
  };

  // ---------- helpers ----------
  const compMean = (col) => avg(state.geq.map((r) => N("geq", r, col)).filter(Number.isFinite));
  const level = (v) => (v >= 2.5 ? "high" : v >= 1.5 ? "moderate" : "low");

  function pearson(xs, ys) {
    const n = xs.length;
    if (n < 3) return NaN;
    const mx = avg(xs), my = avg(ys);
    let num = 0, dx2 = 0, dy2 = 0;
    for (let i = 0; i < n; i++) {
      const dx = xs[i] - mx, dy = ys[i] - my;
      num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
    }
    const den = Math.sqrt(dx2 * dy2);
    return den === 0 ? NaN : num / den;
  }
  const rStrength = (r) => (Math.abs(r) >= 0.6 ? "strong" : Math.abs(r) >= 0.3 ? "moderate" : "weak");

  const sd = (arr) => {
    if (arr.length < 2) return NaN;
    const m = avg(arr);
    return Math.sqrt(arr.reduce((a, v) => a + (v - m) * (v - m), 0) / (arr.length - 1));
  };
  const nums = (ds, col) => state[ds].map((r) => N(ds, r, col)).filter(Number.isFinite);
  // "M = x, SD = y" — SD omitted when n < 2
  const MS = (arr, d = 1, unit = "") =>
    `M = ${fmt(avg(arr), d)}${unit}${arr.length > 1 ? `, SD = ${fmt(sd(arr), d)}${unit}` : ""}`;

  // Critical |r| for two-tailed p < .05 (Pearson), by number of pairs n
  const R_CRIT = { 3: 0.997, 4: 0.950, 5: 0.878, 6: 0.811, 7: 0.754, 8: 0.707, 9: 0.666,
                   10: 0.632, 11: 0.602, 12: 0.576, 13: 0.553, 14: 0.532, 15: 0.514,
                   16: 0.497, 17: 0.482, 18: 0.468, 19: 0.456, 20: 0.444, 25: 0.396, 30: 0.361 };
  function rCrit(n) {
    if (n < 3) return Infinity;
    if (n > 30) return 1.96 / Math.sqrt(n);
    let best = 0.997;
    for (const k of Object.keys(R_CRIT)) if (+k <= n) best = R_CRIT[k];
    return best;
  }
  const isSig = (r, n) => Number.isFinite(r) && Math.abs(r) >= rCrit(n);

  function gameGroups() {
    const games = new Map(); // matchKey -> aggregate of that player's runs
    for (const r of state.runs) {
      const k = matchKey(G("runs", r, "PlayerName"));
      if (!k) continue;
      if (!games.has(k)) games.set(k, { runs: [], scores: [], debtPcts: [], stresses: [], days: [], modes: new Set(), best: "" });
      const g = games.get(k);
      g.runs.push(r);
      const s = N("runs", r, "CompositeScore");
      if (Number.isFinite(s)) g.scores.push(s);
      const d = N("runs", r, "DebtReductionPct");
      if (Number.isFinite(d)) g.debtPcts.push(d);
      const fs = N("runs", r, "FinalStress");
      if (Number.isFinite(fs)) g.stresses.push(fs);
      const du = N("runs", r, "DaysUsed");
      if (Number.isFinite(du)) g.days.push(du);
      if (hasCol("runs", "Mode")) g.modes.add(norm(G("runs", r, "Mode")) === "guided" ? "Guided" : "Standard");
      const o = norm(G("runs", r, "Outcome"));
      const order = { win: 3, survived: 2, burnout: 1 };
      if ((order[o] || 0) > (order[norm(g.best)] || 0)) g.best = G("runs", r, "Outcome");
    }
    return games;
  }

  // one entry per participant connected to game runs — automatically (ID ==
  // PlayerName) or through a manual link from the Link participants table
  function buildMatches() {
    const games = gameGroups();
    const matched = [], unmatched = [];
    for (const q of state.geq) {
      const id = G("geq", q, "participant_id");
      const linkedName = links[id];
      const g = (linkedName && games.get(matchKey(linkedName))) || games.get(matchKey(id));
      if (g) matched.push({ id, geq: q, game: g, manual: !!(linkedName && games.get(matchKey(linkedName))) });
      else unmatched.push(id);
    }
    return { matched, unmatched };
  }

  // ---------- link participants table ----------
  function renderLinks() {
    const sec = $("#linkSec");
    if (!state.runs.length || !state.geq.length) { sec.hidden = true; return; }
    sec.hidden = false;
    const games = gameGroups();
    const players = [...new Set(state.runs.map((r) => G("runs", r, "PlayerName")).filter(Boolean))];

    $("#linkTable tbody").innerHTML = state.geq.map((q) => {
      const id = G("geq", q, "participant_id");
      const auto = games.has(matchKey(id));
      const linked = links[id] && games.has(matchKey(links[id]));
      const status = linked
        ? '<span class="chip guided">LINKED</span>'
        : auto
          ? '<span class="chip win">AUTO</span>'
          : '<span class="chip burnout">UNLINKED</span>';
      const opts = players.map((p) =>
        `<option value="${esc(p)}"${links[id] === p ? " selected" : ""}>${esc(p)}</option>`).join("");
      return `<tr>
        <td>${esc(id)}</td>
        <td>${status}</td>
        <td><select class="link-sel" data-id="${esc(id)}">
          <option value="">${auto ? "auto (same ID)" : "— choose player —"}</option>${opts}
        </select></td>
        <td>${links[id] ? `<button class="btn ghost link-clear" data-id="${esc(id)}" type="button">Unlink</button>` : ""}</td>
      </tr>`;
    }).join("");
  }

  // ---------- GEQ section ----------
  function renderGeq() {
    makeChart("geqRadarChart", {
      type: "radar",
      data: {
        labels: CORE.map(([l]) => l),
        datasets: [{
          label: `mean of ${state.geq.length} participants`,
          data: CORE.map(([, col]) => compMean(col)),
          borderColor: C.gold,
          backgroundColor: "rgba(233, 180, 76, 0.18)",
          pointBackgroundColor: C.gold,
          borderWidth: 2,
        }],
      },
      options: {
        maintainAspectRatio: false,
        scales: { r: { min: 0, max: 4, ticks: { stepSize: 1, backdropColor: "transparent" },
                       grid: { color: C.line }, angleLines: { color: C.line },
                       pointLabels: { font: { size: 10 } } } },
        plugins: { legend: { position: "bottom" } },
      },
    });

    const postVals = POST.map(([, col]) => compMean(col));
    makeChart("geqPostChart", {
      type: "bar",
      data: {
        labels: POST.map(([l]) => l),
        datasets: [{
          data: postVals,
          backgroundColor: [C.green, C.magenta, C.amber, C.cyan],
        }],
      },
      options: {
        indexAxis: "y",
        maintainAspectRatio: false,
        scales: { x: { min: 0, max: 4 } },
        plugins: { legend: { display: false } },
      },
    });

    const cell = (v) => `<td class="num">${Number.isFinite(v) ? fmt(v, 2) : "–"}</td>`;
    $("#geqTable tbody").innerHTML = state.geq.map((r) => `
      <tr>
        <td>${esc(G("geq", r, "participant_id"))}</td>
        <td class="num">${esc(G("geq", r, "demo_age") ?? "")}</td>
        <td>${esc(G("geq", r, "demo_gaming_freq") ?? "")}</td>
        ${CORE.map(([, col]) => cell(N("geq", r, col))).join("")}
        ${cell(N("geq", r, "postgame_score_Positive_Experience"))}
        ${cell(N("geq", r, "postgame_score_Negative_Experience"))}
      </tr>`).join("");
  }

  // ---------- combined section ----------
  function renderCombined() {
    const sec = $("#combinedSec");
    if (!state.runs.length || !state.geq.length) { sec.hidden = true; return; }
    const { matched, unmatched } = buildMatches();
    if (!matched.length) {
      sec.hidden = true;
      return;
    }
    sec.hidden = false;

    // component selector buttons (built once)
    const seg = $("#combSeg");
    if (!seg.children.length) {
      seg.innerHTML = CORE.map(([l]) =>
        `<button class="seg-btn${l === combComponent ? " active" : ""}" data-comp="${esc(l)}" type="button">${esc(l)}</button>`).join("");
    }

    const col = CORE.find(([l]) => l === combComponent)[1];
    const pts = matched
      .map((m) => ({
        x: N("geq", m.geq, col),
        y: avg(m.game.scores),
        id: m.id,
        guided: m.game.modes.has("Guided") && m.game.modes.size === 1,
      }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));

    const r = pearson(pts.map((p) => p.x), pts.map((p) => p.y));
    $("#combCompName").textContent = combComponent;
    $("#combR").textContent = Number.isFinite(r)
      ? `r = ${fmt(r, 2)} (${rStrength(r)}, n = ${pts.length})`
      : `n = ${pts.length} — need ≥ 3 matched participants for correlation`;

    makeChart("combScatter", {
      type: "scatter",
      data: {
        datasets: [{
          data: pts,
          backgroundColor: pts.map((p) => (p.guided ? C.cyan : C.gold)),
          pointRadius: 6,
        }],
      },
      options: {
        maintainAspectRatio: false,
        scales: {
          x: { min: 0, max: 4, title: { display: true, text: `GEQ ${combComponent} (0–4)` } },
          y: { title: { display: true, text: "Avg composite score" } },
        },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => `${c.raw.id}: ${combComponent} ${fmt(c.raw.x, 2)}, score ${fmt(c.raw.y)}` } },
        },
      },
    });

    $("#matchTable tbody").innerHTML = matched.map((m) => `
      <tr>
        <td>${esc(m.id)}${m.manual ? ' <span class="chip guided">LINKED</span>' : ""}</td>
        <td>${m.game.modes.size ? [...m.game.modes].map((md) => `<span class="chip ${md.toLowerCase()}">${md}</span>`).join(" ") : "–"}</td>
        <td class="num">${m.game.runs.length}</td>
        <td><span class="chip ${norm(m.game.best)}">${esc(m.game.best)}</span></td>
        <td class="num">${fmt(avg(m.game.scores))}</td>
        <td class="num">${fmt(N("geq", m.geq, "core_score_Flow"), 2)}</td>
        <td class="num">${fmt(N("geq", m.geq, "core_score_Positive_Affect"), 2)}</td>
      </tr>`).join("");
    $("#unmatchedNote").textContent = unmatched.length
      ? `Not matched to any game run: ${unmatched.join(", ")} — link them manually in the table above.`
      : "";

    renderCorrMatrix(matched);
  }

  const GAME_METRICS = [
    ["Composite score", (g) => avg(g.scores)],
    ["Debt cleared %", (g) => avg(g.debtPcts)],
    ["Final stress", (g) => avg(g.stresses)],
    ["Days used", (g) => avg(g.days)],
  ];

  function renderCorrMatrix(matched) {
    const wrap = $("#corrWrap");
    if (matched.length < 3) { wrap.hidden = true; return; }
    wrap.hidden = false;

    const head = "<tr><th>GEQ component</th>" +
      GAME_METRICS.map(([l]) => `<th class="num">${esc(l)}</th>`).join("") + "</tr>";
    const body = CORE.map(([label, col]) => {
      const cells = GAME_METRICS.map(([, gameVal]) => {
        const xs = [], ys = [];
        for (const m of matched) {
          const x = N("geq", m.geq, col), y = gameVal(m.game);
          if (Number.isFinite(x) && Number.isFinite(y)) { xs.push(x); ys.push(y); }
        }
        const r = pearson(xs, ys);
        if (!Number.isFinite(r)) return '<td class="num">–</td>';
        const cls = (r >= 0 ? "rp" : "rn") + (Math.abs(r) >= 0.6 ? "2" : Math.abs(r) >= 0.3 ? "1" : "0");
        return `<td class="num rcell ${cls}">${fmt(r, 2)}${isSig(r, xs.length) ? "<sup>*</sup>" : ""}</td>`;
      }).join("");
      return `<tr><td>${esc(label)}</td>${cells}</tr>`;
    }).join("");

    $("#corrTable thead").innerHTML = head;
    $("#corrTable tbody").innerHTML = body;
    $("#corrNote").textContent =
      `Pearson r, n = ${matched.length} matched participants. * significant at p < .05 (two-tailed, |r| ≥ ${fmt(rCrit(matched.length), 2)}).`;
  }

  // ---------- conclusions ----------
  let lastGroups = []; // kept for the "Copy for report" button

  function renderConclusions() {
    const groups = []; // {title, items:[{tone, text}]}
    const grp = (title) => { const g = { title, items: [] }; groups.push(g); return (tone, text) => g.items.push({ tone, text }); };
    const limitations = [];

    // ----- gameplay performance -----
    if (state.runs.length) {
      const add = grp("Gameplay performance");
      const runs = state.runs;
      const players = new Set(runs.map((r) => G("runs", r, "PlayerName"))).size;
      const oc = (o) => runs.filter((r) => norm(G("runs", r, "Outcome")) === o).length;
      const wins = oc("win"), burnouts = oc("burnout"), survived = oc("survived");
      const winPct = (wins / runs.length) * 100;
      add(winPct >= 50 ? "good" : "warn",
        `${runs.length} completed runs were recorded from ${players} player${players === 1 ? "" : "s"}. ` +
        `Outcome distribution: ${wins} Win (${fmtPct(winPct)} win rate), ${survived} Survived (${fmtPct(survived / runs.length * 100)}), ` +
        `${burnouts} Burnout (${fmtPct(burnouts / runs.length * 100)}).`);

      const debtPcts = nums("runs", "DebtReductionPct");
      const debtRM = nums("runs", "DebtReduced");
      const cleared = runs.filter((r) => norm(G("runs", r, "DebtCleared")) === "true").length;
      add(avg(debtPcts) >= 50 ? "good" : "warn",
        `Debt management: debt reduction averaged ${MS(debtPcts, 1, "%")} of the starting amount, ` +
        `equal to RM ${fmt(avg(debtRM))} (SD = RM ${fmt(sd(debtRM))}); ${cleared} of ${runs.length} runs ended fully debt-free.`);

      const scores = nums("runs", "CompositeScore");
      const stress = nums("runs", "FinalStress");
      const days = nums("runs", "DaysUsed");
      if (scores.length) add("info",
        `Performance: composite score ${MS(scores, 0)} (range ${fmt(Math.min(...scores))}–${fmt(Math.max(...scores))}); ` +
        `runs lasted ${MS(days, 1)} in-game days; final stress ${MS(stress, 1, "%")}.`);

      const engage = [["DecisionsMade", "decisions"], ["RandomEventsFaced", "random events"],
                      ["FreelanceJobsCompleted", "freelance jobs"], ["TransactionsMade", "transactions"]]
        .filter(([c]) => hasCol("runs", c))
        .map(([c, l]) => `${fmt(avg(nums("runs", c)), 1)} ${l}`);
      if (engage.length) add("info", `Interaction depth per run (averages): ${engage.join(", ")}.`);

      if (hasCol("runs", "Mode")) {
        const byMode = splitByMode(runs, "runs");
        if (byMode.Guided.length && byMode.Standard.length) {
          const wr = (rows) => (rows.filter((r) => norm(G("runs", r, "Outcome")) === "win").length / rows.length) * 100;
          const stM = (rows) => avg(rows.map((r) => N("runs", r, "FinalStress")).filter(Number.isFinite));
          const dWin = wr(byMode.Guided) - wr(byMode.Standard);
          const dStress = stM(byMode.Guided) - stM(byMode.Standard);
          add("info",
            `Mode comparison (Guided n = ${byMode.Guided.length}, Standard n = ${byMode.Standard.length}): ` +
            `win rate ${fmtPct(wr(byMode.Guided))} vs ${fmtPct(wr(byMode.Standard))} (Δ ${fmt(dWin, 0)} pts); ` +
            `final stress ${fmt(stM(byMode.Guided), 1)}% vs ${fmt(stM(byMode.Standard), 1)}% (Δ ${fmt(dStress, 0)} pts)` +
            `${dWin >= 10 && dStress <= -10 ? " — evidence that Kayal's guided scaffolding supports debt management with less pressure" : ""}.`);
        }
      } else {
        limitations.push("The run exports contain no Mode column, so Guided vs Standard mode could not be compared — add Mode to AnalyticsManager's CSV export.");
      }
      if (runs.length < 10) limitations.push(`Only ${runs.length} completed runs were available; gameplay statistics should be treated as preliminary.`);
    }

    // ----- day-by-day progress -----
    if (state.daily.length) {
      const add = grp("Progress across the in-game days");
      const bySess = new Map();
      for (const r of state.daily) {
        const sid = G("daily", r, "SessionId");
        if (!bySess.has(sid)) bySess.set(sid, []);
        bySess.get(sid).push(r);
      }
      const firstStress = [], lastStress = [], firstDebt = [], lastDebt = [];
      let peakStress = -Infinity;
      for (const rows of bySess.values()) {
        rows.sort((a, b) => N("daily", a, "Day") - N("daily", b, "Day"));
        const f = rows[0], l = rows[rows.length - 1];
        const push = (arr, v) => Number.isFinite(v) && arr.push(v);
        push(firstStress, N("daily", f, "Stress")); push(lastStress, N("daily", l, "Stress"));
        push(firstDebt, N("daily", f, "TotalDebt")); push(lastDebt, N("daily", l, "TotalDebt"));
        for (const r of rows) peakStress = Math.max(peakStress, N("daily", r, "Stress") || -Infinity);
      }
      const dStress = avg(lastStress) - avg(firstStress);
      add(dStress <= 0 ? "good" : "warn",
        `Stress moved from ${fmt(avg(firstStress), 1)}% on day 1 to ${fmt(avg(lastStress), 1)}% on the final recorded day ` +
        `(${dStress <= 0 ? "a decrease" : "an increase"} of ${fmt(Math.abs(dStress), 1)} pts on average), peaking at ${fmt(peakStress, 1)}%.`);
      add("info",
        `Total debt fell from RM ${fmt(avg(firstDebt))} to RM ${fmt(avg(lastDebt))} on average — ` +
        `a mean reduction of RM ${fmt(avg(firstDebt) - avg(lastDebt))} per run over the recorded days.`);
    }

    // ----- event stream -----
    if (state.events.length) {
      const add = grp("Player behaviour (event stream)");
      const byType = new Map();
      for (const r of state.events) {
        const t = G("events", r, "EventType") || "Unknown";
        if (!byType.has(t)) byType.set(t, { n: 0, stress: [] });
        const b = byType.get(t);
        b.n++;
        const v = N("events", r, "StressDelta");
        if (Number.isFinite(v)) b.stress.push(v);
      }
      const sessions = new Set(state.events.map((r) => G("events", r, "SessionId"))).size;
      const top = [...byType.entries()].sort((a, b) => b[1].n - a[1].n)[0];
      add("info",
        `${fmt(state.events.length)} individual actions were logged across ${sessions} session${sessions === 1 ? "" : "s"} ` +
        `(≈ ${fmt(state.events.length / sessions)} per session). The most frequent action type was ${top[0]} (${top[1].n}×).`);
      const withStress = [...byType.entries()].map(([t, b]) => [t, avg(b.stress)]).filter(([, v]) => Number.isFinite(v));
      if (withStress.length) {
        const relief = withStress.reduce((a, b) => (b[1] < a[1] ? b : a));
        const strain = withStress.reduce((a, b) => (b[1] > a[1] ? b : a));
        const parts = [];
        if (relief[1] <= -0.1) parts.push(`${relief[0]} actions relieved the most stress (${fmt(relief[1], 1)} per action on average)`);
        if (strain[1] >= 0.1 && strain[0] !== relief[0]) parts.push(`${strain[0]} actions added the most (+${fmt(strain[1], 1)})`);
        if (parts.length) add("info", `Stress dynamics: ${parts.join(", while ")}.`);
        else add("warn", `StressDelta is near zero for every logged action — stress changes may not be wired into the event logging yet, so per-action stress analysis isn't possible from this export.`);
      }
      limitations.push("EscapeDebt_Analytics.csv is overwritten on each export, so the event stream covers only the most recently exported session(s), not every run.");
    }

    // ----- GEQ -----
    if (state.geq.length) {
      const add = grp("Player experience (GEQ)");
      const n = state.geq.length;
      const comp = (col) => nums("geq", col);
      const m = Object.fromEntries(CORE.map(([l, col]) => [l, avg(comp(col))]));

      add("info", `Core module descriptives (0–4 scale, n = ${n}): ` +
        CORE.map(([l, col]) => `${l} ${MS(comp(col), 2)}`).join("; ") + ".");
      add(m["Pos. Affect"] >= 2.5 && m["Flow"] >= 1.5 ? "good" : "warn",
        `Engagement: Positive Affect was ${level(m["Pos. Affect"])} (${fmt(m["Pos. Affect"], 2)}/4), with ${level(m["Flow"])} Flow ` +
        `(${fmt(m["Flow"], 2)}/4) and ${level(m["Immersion"])} Sensory & Imaginative Immersion (${fmt(m["Immersion"], 2)}/4) — ` +
        `${m["Pos. Affect"] >= 2.5 ? "players enjoyed the experience" : "engagement has room to improve"}.`);
      add(m["Tension"] < 1.5 && m["Neg. Affect"] < 1.5 ? "good" : "warn",
        `Comfort: Tension/Annoyance (${fmt(m["Tension"], 2)}/4) and Negative Affect (${fmt(m["Neg. Affect"], 2)}/4) were ` +
        `${m["Tension"] < 1.5 && m["Neg. Affect"] < 1.5 ? "low — the debt-pressure theme did not translate into player frustration" : "elevated — consider tuning stress pacing or puzzle difficulty"}. ` +
        `Perceived Challenge was ${level(m["Challenge"])} (${fmt(m["Challenge"], 2)}/4)` +
        `${m["Challenge"] < 1.5 ? " — the game may be too easy for this audience" : ""}.`);
      add(m["Competence"] >= 2 ? "good" : "info",
        `Competence sat at ${fmt(m["Competence"], 2)}/4 (${level(m["Competence"])}) — how capable players felt while managing the debt scenarios.`);

      const pe = avg(comp("postgame_score_Positive_Experience"));
      const ne = avg(comp("postgame_score_Negative_Experience"));
      add(pe > ne ? "good" : "warn",
        `Post-game module: ` + POST.map(([l, col]) => `${l} ${MS(comp(col), 2)}`).join("; ") +
        `. Positive Experience ${pe > ne ? "outweighed" : "did not outweigh"} Negative Experience after play.`);
      if (n < 10) limitations.push(`The GEQ sample is small (n = ${n}); component means are descriptive and should not be generalised.`);
      limitations.push("GEQ scores are self-reported and were collected immediately after play, which can inflate positive affect (demand characteristics).");
    }

    // ----- combined -----
    if (state.runs.length && state.geq.length) {
      const add = grp("Experience × performance (matched participants)");
      const { matched, unmatched } = buildMatches();
      if (matched.length >= 3) {
        const n = matched.length;
        add("info", `${n} GEQ respondent${n === 1 ? "" : "s"} were matched to their game runs` +
          `${unmatched.length ? ` (${unmatched.length} unmatched)` : ""}. ` +
          `With n = ${n}, a Pearson correlation is significant at p < .05 only when |r| ≥ ${fmt(rCrit(n), 2)} (two-tailed).`);
        for (const [label, col, gameVal, gameLabel] of [
          ["Flow", "core_score_Flow", (g) => avg(g.scores), "in-game composite score"],
          ["Competence", "core_score_Competence", (g) => avg(g.debtPcts), "share of debt cleared"],
          ["Tension", "core_score_Tension_Annoyance", (g) => avg(g.stresses), "final stress level"],
        ]) {
          const xs = [], ys = [];
          for (const mm of matched) {
            const x = N("geq", mm.geq, col), y = gameVal(mm.game);
            if (Number.isFinite(x) && Number.isFinite(y)) { xs.push(x); ys.push(y); }
          }
          const r = pearson(xs, ys);
          if (Number.isFinite(r)) add(isSig(r, xs.length) ? "good" : "info",
            `GEQ ${label} vs ${gameLabel}: r = ${fmt(r, 2)} — a ${rStrength(r)} ${r >= 0 ? "positive" : "negative"} relationship, ` +
            `${isSig(r, xs.length) ? "statistically significant at p < .05" : "not statistically significant at this sample size"} (n = ${xs.length}). ` +
            `The full correlation matrix is in the Combined outcome section below.`);
        }
        limitations.push(`Correlations are based on n = ${matched.length} matched participants; report them as exploratory findings, not confirmatory evidence.`);
      } else if (matched.length > 0) {
        add("warn", `Only ${matched.length} GEQ participant${matched.length === 1 ? " was" : "s were"} matched to game runs — link more participants (table below) to enable correlation analysis (minimum 3).`);
      } else {
        add("warn", `No GEQ participant IDs matched any in-game PlayerName — connect them in the Link participants table below, or ask testers to enter the same ID (e.g. P01) in both the game and the questionnaire.`);
      }
    } else {
      const add = grp("Next step");
      add("info", state.runs.length
        ? "Upload the GEQ export to add player-experience findings and per-participant correlations."
        : "Upload EscapeDebt_RunSummary.csv to add gameplay findings.");
    }

    // ----- limitations -----
    if (limitations.length) {
      const add = grp("Data quality & limitations");
      for (const t of limitations) add("warn", t);
    }

    lastGroups = groups;
    $("#verdictList").innerHTML = groups.map((g) =>
      `<h3 class="v-head">${esc(g.title)}</h3>` +
      g.items.map((i) => `<div class="verdict ${i.tone}">${i.text}</div>`).join("")).join("");
  }

  function conclusionsAsText() {
    return lastGroups.map((g) =>
      g.title.toUpperCase() + "\n" + g.items.map((i) => "- " + i.text).join("\n")).join("\n\n");
  }

  // ---------- wiring ----------
  $("#combSeg").addEventListener("click", (e) => {
    const btn = e.target.closest(".seg-btn");
    if (!btn) return;
    combComponent = btn.dataset.comp;
    document.querySelectorAll("#combSeg .seg-btn").forEach((b) => b.classList.toggle("active", b === btn));
    renderCombined();
  });

  $("#copyConcBtn").addEventListener("click", async () => {
    const text = "ESCAPE THE DEBT — EVALUATION CONCLUSIONS\n" +
      "Generated " + new Date().toLocaleDateString() + "\n\n" + conclusionsAsText() + "\n";
    try {
      await navigator.clipboard.writeText(text);
      window.ETD.toast("Conclusions copied — paste into your report.");
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      window.ETD.toast("Conclusions copied — paste into your report.");
    }
  });

  $("#linkTable").addEventListener("change", (e) => {
    const sel = e.target.closest(".link-sel");
    if (!sel) return;
    if (sel.value) links[sel.dataset.id] = sel.value;
    else delete links[sel.dataset.id];
    saveLinks();
    renderLinks();
    renderCombined();
    renderConclusions();
  });
  $("#linkTable").addEventListener("click", (e) => {
    const btn = e.target.closest(".link-clear");
    if (!btn) return;
    delete links[btn.dataset.id];
    saveLinks();
    renderLinks();
    renderCombined();
    renderConclusions();
  });

  for (const ds of DATASETS) {
    const btn = $(`#dl-${ds}`);
    if (btn) btn.addEventListener("click", () =>
      downloadCSV(ds, FILE_NAME[ds].replace(".csv", "_merged.csv")));
  }
})();
