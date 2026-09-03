# WorldcupOdds — World Cup 2026 probability archive

**Archived demo:** https://ericthlai.github.io/worldcup26-odds/

[![CI](https://github.com/ericthlai/worldcup26-odds/actions/workflows/ci.yml/badge.svg)](https://github.com/ericthlai/worldcup26-odds/actions/workflows/ci.yml)

A static, no-build browser app for exploring a frozen pre-tournament model of the 48-team 2026 World Cup. It simulates the full tournament, then exposes matchup, venue, date and stage-reach probabilities.

This is now an **engineering archive**, not a current forecast or results product. Model assumptions are frozen as of **June 2026**. Beginning at `2026-07-20T00:00:00Z`, the app does not call Polymarket's Gamma API, schedule refreshes, or calibrate against settled prices. It intentionally does not present the simulated output as actual tournament results.

## Run locally

It's a static site — any static server works:

```bash
python -m http.server 8766
# open http://localhost:8766
```

No build step, no dependencies to install. Preact + htm are vendored (`preact.min.umd.js`, `htm.umd.js`); reproducible hashes and licenses are recorded in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

## Deploy (GitHub Pages)

Push this folder to a GitHub repo and enable Pages on the root. The archived experience performs no market-data requests. The historical pre-cutoff integration remains in the source as part of the case study.

## Tests

```bash
node test/engine.test.mjs
node test/selfcheck.js
node test/test-annexc-adversarial.js
node test/fixtures.test.mjs
node --test test/lifecycle.test.mjs
```

These run on every push via GitHub Actions.

## The four views

1. **明星对阵雷达 / Star Matchup Radar** — pick two teams or two stars (Messi vs Ronaldo). Shows the modelled probability they meet in the knockouts and each possible round, venue, city and date.
2. **场馆/日期浏览器 / Venue & Date Browser** — pick a knockout match (venue + date). Shows the most likely matchups there, a star-power index, and each contender's appearance probability.
3. **球队晋级路径 / Team Path Explorer** — pick a team. Round-by-round most-likely opponent, venue, date, and a funnel of stage-reach probabilities (R32 → Champion).
4. **全队阶段概率总表 / Stage Probability Table** — all 48 teams × every stage, sortable. The archived experience shows model output only.

Plus a **What-if** panel: assume a group winner and recompute the downstream model probabilities.

## How the numbers are made

| Layer | What it does |
|---|---|
| **Ratings** | Hardcoded World-Football-Elo-style ratings for all 48 teams (`data.js`, `ELO`). The model snapshot is static and is not updated with actual results. |
| **Match model** | Elo gap → goal supremacy → two independent Poisson goal counts → score grid → W/D/L, with a Dixon-Coles low-score correction (ρ = −0.11) so draws land at a realistic ~25–28%. Knockout draws resolve via a penalty coin-flip nudged to the stronger side. Host advantage (+100 Elo) applies to all three co-hosts' (USA/Mexico/Canada) group matches and to all knockout matches. |
| **Tournament** | `simulate()` runs N = 20,000 tournaments (seeded `mulberry32`) in a Web Worker. Group round-robin with FIFA tiebreakers → top-2 auto-advance + 8 best third-placed → **FIFA Annex C** assignment of thirds to Round-of-32 slots → single-elimination to the final. Accumulates per-team stage-reach and per-slot matchup co-occurrence counters; every probability is a Monte-Carlo frequency. |
| **Best-third** | Uses the **literal 495-row FIFA Annex C lookup table** (`data.js`, `ANNEXC_TABLE`), transcribed from the official FIFA 2026 Competition Regulations PDF. (Eligibility + bipartite matching alone does **not** uniquely reproduce FIFA's published assignment — most qualifying sets admit several legal matchings.) |
| **Historical market blend** | Before the archive cutoff, an open champion market seeds a temperature + per-team Elo-delta fit. R16/QF/SF/Final baskets then refine the same Elo-delta vector through `calibrateReach()`. The R32/to-advance basket is comparison-only. De-vigged W/D/L prices can override the 52 mapped group fixtures. |
| **Lifecycle** | `lifecycle.js` permits market polling only before `2026-07-20T00:00:00Z` and rejects a closed or inactive champion snapshot. After the cutoff, no Gamma request, market calibration or refresh timer is started. |

## Engineering case study

- **Product framing:** turns a bracket simulator into four decision-oriented exploration paths instead of exposing raw simulation output.
- **Model architecture:** separates static tournament data, a seeded simulation engine, Web Worker orchestration, market adapters and UI state.
- **Reliability boundaries:** encodes the 72-fixture schedule and 495-row Annex C table as tested contracts; isolates partial market failures; makes the post-tournament transition deterministic and testable without network access.
- **Development method:** human-directed, AI-assisted iteration with source review, deterministic tests and CI as the evidence trail—no dynamic attribution or generated co-author counts.

## Files

```
index.html          shell — loads preact, htm, data, engine, markets, lifecycle, app
data.js             window.WC — TEAMS, GROUPS, VEN, GM, KO, ELO, STARS, VENMATCH, ANNEXC_TABLE
engine.js           window.WCEngine — match model, simulate(), calibrate(), queryMatchup/queryVenue
sim.worker.js       Web Worker wrapper around the engine
markets.js          window.WCMarkets — Polymarket Gamma API fetch + de-vig + normalization
lifecycle.js        window.WCOLifecycle — cutoff and settled-market policy
app.js              Preact UI — the four views, status bar, what-if
THIRD_PARTY_NOTICES.md  verified vendored-bundle hashes and licenses
test/               engine self-checks + adversarial Annex C verification
dev/                reference copy of the sister prediction app (provenance only)
```

## Known limitations

- This archive preserves a pre-tournament counterfactual model. It does not ingest or display actual 2026 results, and should not be read as a retrospective prediction scorecard.
- Host-country advantage is represented as a fixed +100 Elo adjustment for all three co-hosts' group matches and every knockout match. `WC.GM` lists all 72 group fixtures (`test/fixtures.test.mjs` guards this).
- The group-winner what-if is an approximation: it force-wins all three of the selected team's group matches rather than applying a literal final-table constraint.
- Historical Polymarket W/D/L overrides map 52 group fixtures. The other 20 use the Elo model; what-if group-winner assumptions still work across all 72. The archived experience does not fetch either set.
- Group tiebreaks use points, then goal difference, then goals scored, then Elo as a stand-in for fair play / drawing of lots. The official FIFA head-to-head step (used when teams are level on all three of the above) is not implemented, so some ties that FIFA would break by head-to-head record are instead broken by rating.
- The historical market fit was not validated out of sample; it was designed to align with market ordering, not beat the market. The reach-stage pass uses one shared Elo-delta vector, so it cannot independently match every stage marginal. **Not betting advice.**
- De-vigging is a simple proportional (sum-to-1) normalization, not a more accurate method (e.g. Shin's); it can slightly over- or under-correct heavy favorites vs. longshots.
- Elo ratings are a static late-2025/mid-2026 approximation (see the `data.js` header). The archived app does not refresh them.
- The historical Gamma adapter uses the sunset `/events?slug=` route. It is retained for code review, but archive mode does not invoke it and no future availability is claimed.
- The vendored Preact bytes match the official 10.26.4 npm artifact. The htm bytes match releases 3.0.1 through 3.1.1, so the exact htm release cannot be recovered; see `THIRD_PARTY_NOTICES.md`.
