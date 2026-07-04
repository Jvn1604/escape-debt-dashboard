/* Escape The Debt — All Data / Conclusions page (all-data.html)
   Combines gameplay results (Run Summary) with GEQ questionnaire results,
   matches participants by ID, and writes an auto-generated conclusion. */

(function () {
  "use strict";

  const { state, DATASETS, FILE_NAME, C, G, N, norm, avg, fmt, fmtPct, esc, matchKey,
          makeChart, downloadCSV, renderOutcomeDoughnut, renderModeComparison, splitByMode } = window.ETD;
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

  window.renderPage = function () {
    const any = DATASETS.some((ds) => state[ds].length > 0);
    $("#ad-empty").hidden = any;
    $("#ad-content").hidden = !any;
    if (!any) return;
    if (state.runs.length) {
      renderOutcomeDoughnut("adOutcomeChart");
      renderModeComparison("adModeChart", "#adModeStats");
    }
    if (state.geq.length) renderGeq();
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

  // one entry per participant that appears in BOTH the GEQ export and the run summary
  function buildMatches() {
    const games = new Map(); // matchKey -> aggregate of that player's runs
    for (const r of state.runs) {
      const k = matchKey(G("runs", r, "PlayerName"));
      if (!k) continue;
      if (!games.has(k)) games.set(k, { runs: [], scores: [], debtPcts: [], modes: new Set(), best: "" });
      const g = games.get(k);
      g.runs.push(r);
      const s = N("runs", r, "CompositeScore");
      if (Number.isFinite(s)) g.scores.push(s);
      const d = N("runs", r, "DebtReductionPct");
      if (Number.isFinite(d)) g.debtPcts.push(d);
      g.modes.add(norm(G("runs", r, "Mode")) === "guided" ? "Guided" : "Standard");
      const o = norm(G("runs", r, "Outcome"));
      const order = { win: 3, survived: 2, burnout: 1 };
      if ((order[o] || 0) > (order[norm(g.best)] || 0)) g.best = G("runs", r, "Outcome");
    }
    const matched = [], unmatched = [];
    for (const q of state.geq) {
      const id = G("geq", q, "participant_id");
      const g = games.get(matchKey(id));
      if (g) matched.push({ id, geq: q, game: g });
      else unmatched.push(id);
    }
    return { matched, unmatched };
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
        <td>${esc(m.id)}</td>
        <td>${[...m.game.modes].map((md) => `<span class="chip ${md.toLowerCase()}">${md}</span>`).join(" ")}</td>
        <td class="num">${m.game.runs.length}</td>
        <td><span class="chip ${norm(m.game.best)}">${esc(m.game.best)}</span></td>
        <td class="num">${fmt(avg(m.game.scores))}</td>
        <td class="num">${fmt(N("geq", m.geq, "core_score_Flow"), 2)}</td>
        <td class="num">${fmt(N("geq", m.geq, "core_score_Positive_Affect"), 2)}</td>
      </tr>`).join("");
    $("#unmatchedNote").textContent = unmatched.length
      ? `Not matched to any game run: ${unmatched.join(", ")} (check the PlayerName typed in-game).`
      : "";
  }

  // ---------- conclusions ----------
  function renderConclusions() {
    const items = []; // {tone: good|warn|info, text}
    const add = (tone, text) => items.push({ tone, text });

    if (state.runs.length) {
      const runs = state.runs;
      const players = new Set(runs.map((r) => G("runs", r, "PlayerName"))).size;
      const wins = runs.filter((r) => norm(G("runs", r, "Outcome")) === "win").length;
      const burnouts = runs.filter((r) => norm(G("runs", r, "Outcome")) === "burnout").length;
      const winPct = (wins / runs.length) * 100;
      const debtPct = avg(runs.map((r) => N("runs", r, "DebtReductionPct")).filter(Number.isFinite));
      add(winPct >= 50 ? "good" : "warn",
        `Across ${runs.length} completed runs by ${players} player${players === 1 ? "" : "s"}, ` +
        `the win rate was ${fmtPct(winPct)} with ${burnouts} burnout${burnouts === 1 ? "" : "s"}; ` +
        `players cleared on average ${fmtPct(debtPct)} of their starting debt.`);

      const byMode = splitByMode(runs, "runs");
      if (byMode.Guided.length && byMode.Standard.length) {
        const wr = (rows) => (rows.filter((r) => norm(G("runs", r, "Outcome")) === "win").length / rows.length) * 100;
        const st = (rows) => avg(rows.map((r) => N("runs", r, "FinalStress")).filter(Number.isFinite));
        const dWin = wr(byMode.Guided) - wr(byMode.Standard);
        const dStress = st(byMode.Guided) - st(byMode.Standard);
        if (Math.abs(dWin) >= 10 || Math.abs(dStress) >= 10) {
          const better = dWin >= 0 ? "Guided" : "Standard";
          add("info",
            `${better} mode performed better: ${fmt(Math.abs(dWin), 0)} pts ${dWin >= 0 ? "higher" : "lower"} win rate for Guided ` +
            `(${fmtPct(wr(byMode.Guided))} vs ${fmtPct(wr(byMode.Standard))}), and Guided runs ended with ` +
            `${fmt(Math.abs(dStress), 0)} pts ${dStress <= 0 ? "less" : "more"} stress — ` +
            `${dWin >= 0 && dStress <= 0 ? "evidence that Kayal's scaffolding helps players manage debt with less pressure" : "worth discussing in the report"}.`);
        } else {
          add("info", `Guided and Standard modes produced similar results (win rate within 10 pts) — the game is balanced across both modes.`);
        }
      }
    }

    if (state.geq.length) {
      const n = state.geq.length;
      const m = Object.fromEntries(CORE.map(([l, col]) => [l, compMean(col)]));
      add(m["Pos. Affect"] >= 2.5 && m["Flow"] >= 1.5 ? "good" : "warn",
        `The ${n} GEQ respondents reported ${level(m["Pos. Affect"])} Positive Affect (${fmt(m["Pos. Affect"], 2)}/4), ` +
        `${level(m["Flow"])} Flow (${fmt(m["Flow"], 2)}/4) and ${level(m["Immersion"])} Immersion (${fmt(m["Immersion"], 2)}/4) — ` +
        `${m["Pos. Affect"] >= 2.5 ? "players enjoyed the experience" : "engagement has room to improve"}.`);
      add(m["Tension"] < 1.5 && m["Neg. Affect"] < 1.5 ? "good" : "warn",
        `Tension (${fmt(m["Tension"], 2)}/4) and Negative Affect (${fmt(m["Neg. Affect"], 2)}/4) were ` +
        `${m["Tension"] < 1.5 && m["Neg. Affect"] < 1.5 ? "low — the debt-pressure theme did not frustrate players" : "elevated — consider tuning stress pacing or puzzle difficulty"}, ` +
        `while Challenge sat at ${fmt(m["Challenge"], 2)}/4 (${level(m["Challenge"])}).`);
      const pe = compMean("postgame_score_Positive_Experience");
      const ne = compMean("postgame_score_Negative_Experience");
      add(pe > ne ? "good" : "warn",
        `After playing, Positive Experience (${fmt(pe, 2)}/4) ${pe > ne ? "outweighed" : "did not outweigh"} ` +
        `Negative Experience (${fmt(ne, 2)}/4) in the post-game module.`);
    }

    if (state.runs.length && state.geq.length) {
      const { matched } = buildMatches();
      if (matched.length >= 3) {
        const pairs = [
          ["Flow", "core_score_Flow", (g) => avg(g.scores), "in-game composite score"],
          ["Competence", "core_score_Competence", (g) => avg(g.debtPcts), "share of debt cleared"],
        ];
        for (const [label, col, gameVal, gameLabel] of pairs) {
          const xs = [], ys = [];
          for (const mm of matched) {
            const x = N("geq", mm.geq, col), y = gameVal(mm.game);
            if (Number.isFinite(x) && Number.isFinite(y)) { xs.push(x); ys.push(y); }
          }
          const r = pearson(xs, ys);
          if (Number.isFinite(r)) {
            add("info",
              `Participants' GEQ ${label} shows a ${rStrength(r)} ${r >= 0 ? "positive" : "negative"} relationship ` +
              `with their ${gameLabel} (r = ${fmt(r, 2)}, n = ${xs.length}).`);
          }
        }
        add("info", `Small-sample caveat: with n = ${matched.length} matched participants these correlations are indicative, not statistically conclusive — report them as exploratory findings.`);
      } else if (matched.length > 0) {
        add("warn", `Only ${matched.length} GEQ participant${matched.length === 1 ? " was" : "s were"} matched to game runs — collect more paired data before drawing combined conclusions.`);
      } else {
        add("warn", `No GEQ participant IDs matched any in-game PlayerName — ask testers to enter the same ID (e.g. P01) in both the game and the questionnaire.`);
      }
    } else {
      add("info", state.runs.length
        ? "Upload the GEQ export to add player-experience conclusions and per-participant correlations."
        : "Upload EscapeDebt_RunSummary.csv to add gameplay conclusions.");
    }

    $("#verdictList").innerHTML = items.map((i) =>
      `<li class="verdict ${i.tone}">${i.text}</li>`).join("");
  }

  // ---------- wiring ----------
  $("#combSeg").addEventListener("click", (e) => {
    const btn = e.target.closest(".seg-btn");
    if (!btn) return;
    combComponent = btn.dataset.comp;
    document.querySelectorAll("#combSeg .seg-btn").forEach((b) => b.classList.toggle("active", b === btn));
    renderCombined();
  });

  for (const ds of DATASETS) {
    const btn = $(`#dl-${ds}`);
    if (btn) btn.addEventListener("click", () =>
      downloadCSV(ds, FILE_NAME[ds].replace(".csv", "_merged.csv")));
  }
})();
