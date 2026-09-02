# WorldcupOdds — World Cup 2026 live probability & ticket planner

**Live demo:** https://ericthlai.github.io/worldcup26-odds/

[![CI](https://github.com/ericthlai/worldcup26-odds/actions/workflows/ci.yml/badge.svg)](https://github.com/ericthlai/worldcup26-odds/actions/workflows/ci.yml)

A static, no-build web app that answers one question: **which teams might play where, when — and with what probability — so you can decide which match tickets to buy.**

It runs a Monte Carlo simulation of the full 48-team tournament in the browser, blends it with live Polymarket prediction-market odds, and surfaces specific matchup/venue/date probabilities (e.g. *"Messi vs Ronaldo, QF, Arrowhead Stadium / Kansas City, 7/11 — 11%"*).

Sister project to the manual-prediction app in `../Worldcup/site` (this one is automatic probabilities, not hand-picking). Visual identity is intentionally shared.

## Run locally

It's a static site — any static server works:

```bash
python -m http.server 8766
# open http://localhost:8766
```

No build step, no dependencies to install. Preact + htm are vendored (`preact.min.umd.js`, `htm.umd.js`).

## Deploy (GitHub Pages)

Push this folder to a GitHub repo and enable Pages on the root. Live odds fetch directly from `gamma-api.polymarket.com` (CORS open, no backend/proxy needed).

## Tests

```bash
node test/engine.test.mjs
node test/selfcheck.js
node test/test-annexc-adversarial.js
```

These run on every push via GitHub Actions.

## The four views

1. **明星对阵雷达 / Star Matchup Radar** — pick two teams or two stars (Messi vs Ronaldo). Shows P(they meet in the knockouts) and every possible meeting: round, venue, city, date, probability. The most likely one is flagged "最值得买的票 / best ticket".
2. **场馆/日期浏览器 / Venue & Date Browser** — pick a knockout match (venue + date). Shows the most likely matchups there, a star-power index, and each contender's appearance probability.
3. **球队晋级路径 / Team Path Explorer** — pick a team. Round-by-round most-likely opponent, venue, date, and a funnel of stage-reach probabilities (R32 → Champion).
4. **全队阶段概率总表 / Stage Probability Table** — all 48 teams × every stage, sortable, with a model-vs-Polymarket side-by-side toggle.

Plus a **What-if** panel: lock a group winner or a finished result and watch the downstream probabilities recompute live.

## How the numbers are made

| Layer | What it does |
|---|---|
| **Ratings** | Hardcoded World-Football-Elo-style ratings for all 48 teams (`data.js`, `ELO`). eloratings.net isn't client-fetchable, so the seed is static; live-ness comes from the markets. |
| **Match model** | Elo gap → goal supremacy → two independent Poisson goal counts → score grid → W/D/L, with a Dixon-Coles low-score correction (ρ = −0.11) so draws land at a realistic ~25–28%. Knockout draws resolve via a penalty coin-flip nudged to the stronger side. Host advantage (+100 Elo) applies to the USA's group matches and to all knockout matches; it is not yet wired up for Mexico's or Canada's own group-stage games (see Known limitations). |
| **Tournament** | `simulate()` runs N = 20,000 tournaments (seeded `mulberry32`) in a Web Worker. Group round-robin with FIFA tiebreakers → top-2 auto-advance + 8 best third-placed → **FIFA Annex C** assignment of thirds to Round-of-32 slots → single-elimination to the final. Accumulates per-team stage-reach and per-slot matchup co-occurrence counters; every probability is a Monte-Carlo frequency. |
| **Best-third** | Uses the **literal 495-row FIFA Annex C lookup table** (`data.js`, `ANNEXC_TABLE`), transcribed from the official FIFA 2026 Competition Regulations PDF. (Eligibility + bipartite matching alone does **not** uniquely reproduce FIFA's published assignment — most qualifying sets admit several legal matchings.) |
| **Market blend** | (1) **Champion calibration** — de-vig the Polymarket champion market, then a per-team Elo-delta rake so the model's title odds match the market ordering (a single temperature can't reorder Elo). (2) **Group overrides** — played/live group matches use de-vigged Polymarket W/D/L. (3) Reach-stage markets (advance, R16/QF/SF/Final) are shown side-by-side for comparison. |
| **Live** | Markets refresh on a 5-minute cache cadence; finished matches can be locked. Calibration + group overrides re-feed the simulation, so when a group result lands the whole downstream chain shifts. |

## Files

```
index.html          shell — loads preact, htm, data, engine, markets, app
data.js             window.WC — TEAMS, GROUPS, VEN, GM, KO, ELO, STARS, VENMATCH, ANNEXC_TABLE
engine.js           window.WCEngine — match model, simulate(), calibrate(), queryMatchup/queryVenue
sim.worker.js       Web Worker wrapper around the engine
markets.js          window.WCMarkets — Polymarket Gamma API fetch + de-vig + normalization
app.js              Preact UI — the four views, status bar, what-if
test/               engine self-checks + adversarial Annex C verification
dev/                reference copy of the sister prediction app (provenance only)
```

## Known limitations

- Host-country advantage (+100 Elo) is fully modeled for the USA's group matches, but is not yet wired up for Mexico's or Canada's own group-stage games (knockout-stage host advantage works correctly for all three co-hosts).
- The "lock a group winner" what-if control only forces the specific group matches the engine has live data for. For Mexico and Canada it currently has no effect at all; for most other teams it only force-wins 1-2 of their 3 group games, not a guaranteed group win.
- Live Polymarket odds and result-locking only cover the 52 US-hosted group matches; the 20 group matches hosted in Mexico and Canada always run on the pure Elo model, with no live-market or what-if override available.
- Group tiebreaks use points, then goal difference, then goals scored, then Elo as a stand-in for fair play / drawing of lots. The official FIFA head-to-head step (used when teams are level on all three of the above) is not implemented, so some ties that FIFA would break by head-to-head record are instead broken by rating.
- The model is calibrated to Polymarket's champion market, not validated against it out-of-sample — it mirrors the market, it doesn't beat it. **Not betting advice.** Schedule and kickoff times follow FIFA's official sources.
- De-vigging is a simple proportional (sum-to-1) normalization, not a more accurate method (e.g. Shin's); it can slightly over- or under-correct heavy favorites vs. longshots.
- Elo ratings are a static late-2025/mid-2026 snapshot (see `data.js` header) and are not refreshed automatically as real-world results come in. Polymarket's `/events?slug=` endpoint is also past its stated deprecation sunset (2026-05-01) but still serves 200 as of this writing; migrate to `/events/keyset` if it ever 410s.
- The live-refresh pipeline has no protection against out-of-order network responses; in rare timing conditions (e.g. clicking Refresh just as the 5-minute auto-refresh also fires) the screen could briefly show a slightly stale blend before the next refresh corrects it.
