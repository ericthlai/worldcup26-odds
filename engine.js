/* ============================================================================
 * engine.js — World Cup 2026 Monte Carlo simulation engine.
 * Pure, dependency-free. Attaches window.WCEngine (and module.exports in Node).
 * Consumes window.WC from data.js (TEAMS, GROUPS, VEN, GM, KO, ELO, VENMATCH,
 * HOST_TEAM, THIRD_SLOTS, ANNEXC_TABLE, ANNEXC_ANCHORS).
 *
 * Model summary:
 *   - Match win prob: We = 1/(1+10^(-dr/400)), dr=(EloA-EloB)+H_A-H_B.
 *   - Goal model: two independent Poisson(0..10) -> score grid, with
 *     Dixon-Coles low-score correction (rho=-0.11) to lift draws.
 *   - Knockout draws resolved by a penalty model.
 *   - Group: round-robin, FIFA tiebreakers (Pts>GD>GF>Elo).
 *   - Best-3rd: rank 12 thirds, take 8, then look up FIFA's published Annex C
 *     row (literal 495-row table from WC.ANNEXC_TABLE) for the slot assignment.
 *     A greedy eligibility matcher is kept only as a last-resort fallback.
 *   - Monte Carlo with mulberry32 PRNG, typed-array accumulators.
 *
 * Market calibration (see calibrate / calibrateChampion / calibrateReach):
 *   - calibrate(): grid-search a global temperature s that scales the Elo gap.
 *     s<1 flattens toward 50/50, s>1 sharpens; the grid spans both sides of 1.
 *   - calibrateChampion(): adds a per-team Elo-delta rake (IPF) so the sim
 *     champion vector can MATCH and REORDER to a market that disagrees with the
 *     Elo ranking (a scalar temperature alone can only stretch/compress it).
 *   - calibrateReach(): refits the same per-team Elo-delta vector against the
 *     R16/QF/SF/Final reach baskets and the champion market. The R32
 *     (to-advance) basket is not fitted and stays comparison-only; see the
 *     app.js header.
 * ==========================================================================*/
(function (root) {
  'use strict';

  var WC = (typeof module !== 'undefined' && module.exports)
    ? require('./data.js')
    : root.WC;
  if (!WC) throw new Error('engine.js: window.WC (data.js) not loaded');

  // -------------------------------------------------------------------------
  // Constants
  // -------------------------------------------------------------------------
  var GOALS_BASE = 2.7;
  var RHO = -0.11;          // Dixon-Coles low-score correction
  var MAXG = 10;            // goals modelled 0..10
  var GROUP_LETTERS = Object.keys(WC.GROUPS);          // [A..L]
  var KO_BY_NO = {};        // no -> KO match object
  WC.KO.forEach(function (m) { KO_BY_NO[m.no] = m; });
  // team -> group letter
  var TEAM_GROUP = {};
  GROUP_LETTERS.forEach(function (g) {
    WC.GROUPS[g].forEach(function (t) { TEAM_GROUP[t] = g; });
  });

  // The 8 third-place slots, in a fixed canonical order (sorted by match no).
  // slotKeys[i] -> {match, winner, gs}.
  var SLOT_KEYS = Object.keys(WC.THIRD_SLOTS).sort(function (a, b) {
    return WC.THIRD_SLOTS[a].match - WC.THIRD_SLOTS[b].match;
  });
  var SLOTS = SLOT_KEYS.map(function (k) {
    var s = WC.THIRD_SLOTS[k];
    return { key: k, match: s.match, winner: s.winner, gs: s.gs.slice() };
  });

  // -------------------------------------------------------------------------
  // PRNG — mulberry32 (deterministic, reproducible)
  // -------------------------------------------------------------------------
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // -------------------------------------------------------------------------
  // Host advantage: H=100 for usa/can/mex when playing in their own country.
  // -------------------------------------------------------------------------
  function hostAdvFor(team, venue) {
    var hostCountry = WC.VENMATCH[venue];           // 'US' | 'CA' | 'MX' | undefined
    if (!hostCountry) return 0;
    return WC.HOST_TEAM[hostCountry] === team ? 100 : 0;
  }

  // -------------------------------------------------------------------------
  // Poisson pmf table for goals 0..MAXG given lambda
  // -------------------------------------------------------------------------
  function poissonPmf(lambda) {
    var out = new Float64Array(MAXG + 1);
    var p = Math.exp(-lambda);
    out[0] = p;
    for (var k = 1; k <= MAXG; k++) { p = p * lambda / k; out[k] = p; }
    return out;
  }

  // Hot-path scratch buffers (reused across the Monte Carlo KO loop to avoid
  // allocating two Float64Arrays per match).
  var _pa = new Float64Array(MAXG + 1);
  var _pb = new Float64Array(MAXG + 1);
  function poissonInto(buf, lambda) {
    var p = Math.exp(-lambda);
    buf[0] = p;
    for (var k = 1; k <= MAXG; k++) { p = p * lambda / k; buf[k] = p; }
  }

  // Fast knockout-advance probability for side A (same DC model as matchProbs,
  // but allocation-free). Returns P(A advances). scaledDr already includes
  // host advantage and temperature: scaledDr = ((eloA-eloB)+host)*s.
  function koAdvProb(scaledDr) {
    var we = 1 / (1 + Math.pow(10, -scaledDr / 400));
    var diff = scaledDr / 400;
    var lamA = Math.max(0.15, GOALS_BASE / 2 + diff / 2);
    var lamB = Math.max(0.15, GOALS_BASE / 2 - diff / 2);
    poissonInto(_pa, lamA);
    poissonInto(_pb, lamB);
    var tau00 = 1 - lamA * lamB * RHO, tau01 = 1 + lamA * RHO,
        tau10 = 1 + lamB * RHO, tau11 = 1 - RHO;
    var pAwin = 0, pDraw = 0, total = 0;
    for (var i = 0; i <= MAXG; i++) {
      var ai = _pa[i];
      for (var j = 0; j <= MAXG; j++) {
        var cell = ai * _pb[j];
        if (i <= 1 && j <= 1) {
          if (i === 0) cell *= (j === 0) ? tau00 : tau01;
          else cell *= (j === 0) ? tau10 : tau11;
        }
        total += cell;
        if (i > j) pAwin += cell;
        else if (i === j) pDraw += cell;
      }
    }
    pAwin /= total; pDraw /= total;
    return pAwin + pDraw * (0.5 + 0.15 * (we - 0.5));
  }

  // -------------------------------------------------------------------------
  // matchProbs — the public probability model.
  //   group   -> {pA, pD, pB, we}
  //   knockout-> {pA, pB, we}  (draw resolved by penalties)
  // temperature s (default 1) scales the Elo gap (calibration knob); s<1 pulls
  // probabilities toward 50/50.
  // -------------------------------------------------------------------------
  function matchProbs(eloA, eloB, hostAdv, opts) {
    opts = opts || {};
    var s = (typeof opts.temperature === 'number' && opts.temperature > 0) ? opts.temperature : 1;
    var knockout = !!opts.knockout;
    var host = hostAdv || 0;

    var dr = ((eloA - eloB) + host) * s;
    var we = 1 / (1 + Math.pow(10, -dr / 400));     // expected score (win prob proxy)

    // Goal model: 1 goal per 400 Elo of (scaled) gap.
    var diff = dr / 400;                            // = (eloA-eloB+host)*s / 400
    var lamA = Math.max(0.15, GOALS_BASE / 2 + diff / 2);
    var lamB = Math.max(0.15, GOALS_BASE / 2 - diff / 2);

    var pa = poissonPmf(lamA), pb = poissonPmf(lamB);

    // Build the joint grid implicitly: accumulate triangles with Dixon-Coles.
    var pAwin = 0, pDraw = 0, pBwin = 0;
    // DC multipliers touch only the 2x2 low-score corner.
    var tau00 = 1 - lamA * lamB * RHO;
    var tau01 = 1 + lamA * RHO;
    var tau10 = 1 + lamB * RHO;
    var tau11 = 1 - RHO;
    var total = 0;
    for (var i = 0; i <= MAXG; i++) {
      for (var j = 0; j <= MAXG; j++) {
        var cell = pa[i] * pb[j];
        if (i <= 1 && j <= 1) {
          if (i === 0 && j === 0) cell *= tau00;
          else if (i === 0 && j === 1) cell *= tau01;
          else if (i === 1 && j === 0) cell *= tau10;
          else cell *= tau11;
        }
        total += cell;
        if (i > j) pAwin += cell;
        else if (i === j) pDraw += cell;
        else pBwin += cell;
      }
    }
    // renormalize (DC + the 0..10 truncation both lose a sliver of mass)
    pAwin /= total; pDraw /= total; pBwin /= total;

    if (!knockout) return { pA: pAwin, pD: pDraw, pB: pBwin, we: we };

    // Knockout: if drawn after 90', penalties.
    // P(A advances) = P(Awin90) + P(draw)*(0.5 + 0.15*(we - 0.5))
    var pAadv = pAwin + pDraw * (0.5 + 0.15 * (we - 0.5));
    return { pA: pAadv, pB: 1 - pAadv, we: we };
  }

  // -------------------------------------------------------------------------
  // Annex C assignment of the 8 best third-placed groups to the 8 R32 slots.
  //
  // FIFA's Annex C is, formally, a fixed 495-row lookup table; for a given set
  // of qualifying third-place groups it is NOT uniquely determined by the
  // per-slot eligibility lists alone (most sets admit several legal perfect
  // matchings, e.g. 14 for {E..L} and 29 for {A..H}). FIFA selects one specific
  // matching per scenario, which CANNOT be recovered from eligibility alone.
  //
  // PRIMARY path: the literal 495-row table (WC.ANNEXC_TABLE, sourced from the
  // official FIFA Competition Regulations PDF, Annexe C). Keyed by the sorted
  // 8-group qualifying set; each row maps winner-of-group -> 3rd-place group.
  // We translate that to slotKey -> groupLetter here.
  //
  // FALLBACK (only if a set is somehow absent from the table): a deterministic
  // greedy that returns *a* legal perfect matching (lowest-alphabetical with an
  // augmenting-path feasibility guard). It is NOT guaranteed to match FIFA's
  // published row — for a complete 495-row table it is never reached.
  //
  // Returns slotKey -> groupLetter, or null if no perfect matching exists
  // (should never happen for a valid 8-of-12 qualifying set).
  // -------------------------------------------------------------------------
  // winner-letter -> slotKey, derived once from SLOTS (e.g. 'E' -> 'M74').
  var SLOT_BY_WINNER = {};
  SLOTS.forEach(function (slot) { SLOT_BY_WINNER[slot.winner] = slot.key; });

  // Build the slotKey-form table from data.js's winner-form WC.ANNEXC_TABLE.
  function buildAnnexCTable(winnerForm) {
    if (!winnerForm) return null;
    var out = {};
    Object.keys(winnerForm).forEach(function (key) {
      var row = winnerForm[key], bySlot = {};
      Object.keys(row).forEach(function (winner) {
        var sk = SLOT_BY_WINNER[winner];
        if (sk) bySlot[sk] = row[winner];
      });
      out[key] = bySlot;
    });
    return out;
  }

  // ANNEXC_TABLE: { sortedKey -> {slotKey:group} }. Loaded from data.js by
  // default; overridable via setAnnexCTable() for tests.
  var ANNEXC_TABLE = buildAnnexCTable(WC.ANNEXC_TABLE);
  var ANNEXC_CACHE = {};         // memo: sortedKey -> {slotKey:group} (<=495 entries)

  // Feasibility: can the remaining slots [fromIdx..] be perfectly matched to
  // the still-available groups? Standard Kuhn augmenting-path test.
  function remainderMatchable(fromIdx, availSet) {
    var groups = [];
    availSet.forEach(function (g) { groups.push(g); });
    var gIndex = {};
    groups.forEach(function (g, i) { gIndex[g] = i; });
    var slots = [];
    for (var i = fromIdx; i < SLOTS.length; i++) slots.push(SLOTS[i]);
    var adj = slots.map(function (slot) {
      var list = [];
      for (var j = 0; j < slot.gs.length; j++) {
        var gi = gIndex[slot.gs[j]];
        if (gi !== undefined) list.push(gi);
      }
      return list;
    });
    var matchG = new Int32Array(groups.length).fill(-1);
    var seen;
    function aug(si) {
      var c = adj[si];
      for (var k = 0; k < c.length; k++) {
        var g = c[k];
        if (seen[g]) continue;
        seen[g] = 1;
        if (matchG[g] === -1 || aug(matchG[g])) { matchG[g] = si; return true; }
      }
      return false;
    }
    var cnt = 0;
    for (var s = 0; s < slots.length; s++) {
      seen = new Uint8Array(groups.length);
      if (aug(s)) cnt++;
    }
    return cnt === slots.length;
  }

  function matchThirdsToSlots(qualifyingGroups) {
    var key = qualifyingGroups.slice().sort().join('');

    // Optional literal-table fast path (drop-in for exact Annex C).
    if (ANNEXC_TABLE && ANNEXC_TABLE[key]) return ANNEXC_TABLE[key];

    // Memoized greedy: there are only C(12,8)=495 distinct qualifying sets, so
    // after warmup every Monte Carlo run is a cheap map hit.
    var cached = ANNEXC_CACHE[key];
    if (cached !== undefined) return cached;

    var avail = new Set(qualifyingGroups);
    var result = {};
    for (var si = 0; si < SLOTS.length; si++) {
      var slot = SLOTS[si];
      // eligible & available, lowest alphabetical first
      var cands = slot.gs.filter(function (g) { return avail.has(g); }).sort();
      var chosen = null;
      for (var c = 0; c < cands.length; c++) {
        var g = cands[c];
        avail.delete(g);
        if (remainderMatchable(si + 1, avail)) { chosen = g; break; }
        avail.add(g);
      }
      if (chosen === null) { ANNEXC_CACHE[key] = null; return null; } // no perfect matching
      result[slot.key] = chosen;
    }
    ANNEXC_CACHE[key] = result;
    return result;
  }

  // Allow callers / tests to install/override the literal Annex C table.
  //   setAnnexCTable(tableObj) -> use tableObj (already in {sortedKey:{slotKey:group}})
  //   setAnnexCTable(null)     -> restore the default table loaded from data.js
  function setAnnexCTable(table) {
    ANNEXC_TABLE = (table === null || table === undefined)
      ? buildAnnexCTable(WC.ANNEXC_TABLE)
      : table;
    ANNEXC_CACHE = {};
  }

  // -------------------------------------------------------------------------
  // Group tiebreaker comparison. Returns negative if a ranks ABOVE b.
  // Order: Points > Goal Difference > Goals For > higher Elo (proxy for
  // fair-play / drawing of lots).
  // st: per-team {pts, gd, gf}. elo: per-team Elo.
  // -------------------------------------------------------------------------
  function cmpTeam(a, b, st, elo) {
    if (st[b].pts !== st[a].pts) return st[b].pts - st[a].pts;
    if (st[b].gd !== st[a].gd) return st[b].gd - st[a].gd;
    if (st[b].gf !== st[a].gf) return st[b].gf - st[a].gf;
    return elo[b] - elo[a];
  }

  // -------------------------------------------------------------------------
  // Sample a group-stage match score from the goal model (for GF/GD).
  // Returns [goalsA, goalsB]. Uses inverse-CDF sampling on each Poisson.
  // (Independent Poissons; DC only nudges win/draw split, negligible for goals.)
  // -------------------------------------------------------------------------
  function sampleGoals(lambda, rnd) {
    // inverse transform on Poisson, capped at MAXG
    var u = rnd();
    var p = Math.exp(-lambda), cum = p, k = 0;
    while (u > cum && k < MAXG) { k++; p = p * lambda / k; cum += p; }
    return k;
  }

  // -------------------------------------------------------------------------
  // simulate(config) — the Monte Carlo driver.
  // config = {
  //   N            number of runs (default 20000)
  //   elo          {code:rating} overrides merged over WC.ELO
  //   temperature  s, scales Elo gaps (default 1)
  //   groupOverrides  {matchNo:{pA,pD,pB}} live-market W/D/L for group matches
  //   lockedResults   {matchNo:outcome} finished matches.
  //                   group:  'A'|'D'|'B' (home win / draw / away win) by t1/t2 order
  //                   OR {a,b} goal pair; knockout: winner code.
  //   seed         PRNG seed (default 0x9E3779B9)
  // }
  // -------------------------------------------------------------------------
  function simulate(config) {
    config = config || {};
    var N = config.N || 20000;
    var s = (typeof config.temperature === 'number' && config.temperature > 0) ? config.temperature : 1;
    var seed = (config.seed >>> 0) || 0x9E3779B9;
    var groupOverrides = config.groupOverrides || {};
    var locked = config.lockedResults || {};

    // merge Elo overrides
    var elo = {};
    Object.keys(WC.ELO).forEach(function (c) { elo[c] = WC.ELO[c]; });
    if (config.elo) Object.keys(config.elo).forEach(function (c) { elo[c] = config.elo[c]; });

    var codes = Object.keys(WC.TEAMS);
    var teamIdx = {};
    codes.forEach(function (c, i) { teamIdx[c] = i; });
    var T = codes.length; // 48

    // Stage accumulators (counts).  Stage codes:
    //  groupOut, r32(=reached R32), r16, qf, sf, final, champion
    var cnt = {
      r32: new Float64Array(T),  // reached round of 32 (top2 or best-3rd)
      r16: new Float64Array(T),
      qf: new Float64Array(T),
      sf: new Float64Array(T),
      final: new Float64Array(T),
      champion: new Float64Array(T)
    };

    // Per-team per-round opponent + venue counters (sparse maps keyed by round).
    // path[code][round] = { opp:{oppCode:count}, ven:{"venue|date":count}, reach:count }
    var ROUNDS = ['r32', 'r16', 'qf', 'sf', 'final'];
    var roundOfMatch = function (no) {
      if (no >= 73 && no <= 88) return 'r32';
      if (no >= 89 && no <= 96) return 'r16';
      if (no >= 97 && no <= 100) return 'qf';
      if (no === 101 || no === 102) return 'sf';
      if (no === 104) return 'final';
      return null; // 103 third-place: not part of the advancement path
    };
    var path = {};
    codes.forEach(function (c) {
      path[c] = {};
      ROUNDS.forEach(function (r) { path[c][r] = { opp: {}, ven: {}, reach: 0 }; });
    });

    // Per-KO-slot matchup co-occurrence: matchup[no] = { "a|b": count }
    // Stored with codes ordered as they appear at the slot (sideA|sideB).
    var matchup = {};
    WC.KO.forEach(function (m) { matchup[m.no] = {}; });

    var rnd = mulberry32(seed);

    // ---- reusable per-run scratch ----
    var ranks = {};            // group letter -> [1st,2nd,3rd,4th] codes
    var thirdsList = [];       // array of {code, g, pts, gd, gf}
    var winners = {};          // KO no -> winner code
    var slotThird = {};        // KO no -> third-place code (for {k:'t'} side B)

    // group fixtures precomputed: for each group, the 6 pairings (round-robin)
    var groupFixtures = {};
    GROUP_LETTERS.forEach(function (g) {
      var t = WC.GROUPS[g];
      groupFixtures[g] = [
        [t[0], t[1]], [t[2], t[3]],
        [t[0], t[2]], [t[1], t[3]],
        [t[0], t[3]], [t[1], t[2]]
      ];
    });

    // Map a group match number -> [t1,t2,venue] for override/lock lookups.
    var gmByPair = {}; // "g|t1|t2" and "g|t2|t1" -> {no,v}
    WC.GM.forEach(function (m) {
      gmByPair[m[2] + '|' + m[3] + '|' + m[4]] = { no: m[0], v: m[5] };
      gmByPair[m[2] + '|' + m[4] + '|' + m[3]] = { no: m[0], v: m[5], rev: true };
    });

    // resolve a KO side to a concrete team code given current run state
    function resolveSide(m, side) {
      var sd = m[side];
      if (sd.k === 'w') return ranks[sd.g] ? ranks[sd.g][0] : null;
      if (sd.k === 'r') return ranks[sd.g] ? ranks[sd.g][1] : null;
      if (sd.k === 't') return slotThird[m.no] || null;
      if (sd.k === 'f') return winners[sd.m] || null;
      if (sd.k === 'l') {
        var fm = KO_BY_NO[sd.m], w = winners[sd.m];
        if (!w) return null;
        var a = resolveSide(fm, 'a'), b = resolveSide(fm, 'b');
        return w === a ? b : a;
      }
      return null;
    }

    // ---- run the Monte Carlo ----
    for (var run = 0; run < N; run++) {
      // 1) GROUP STAGE -----------------------------------------------------
      thirdsList.length = 0;
      for (var gi2 = 0; gi2 < GROUP_LETTERS.length; gi2++) {
        var g = GROUP_LETTERS[gi2];
        var teams = WC.GROUPS[g];
        var st = {};
        for (var ti = 0; ti < 4; ti++) st[teams[ti]] = { pts: 0, gd: 0, gf: 0 };
        var fix = groupFixtures[g];
        for (var fi = 0; fi < fix.length; fi++) {
          var t1 = fix[fi][0], t2 = fix[fi][1];
          var ga, gb;
          var info = gmByPair[g + '|' + t1 + '|' + t2];
          var no = info ? info.no : null;

          // locked real result?
          var lk = no != null ? locked[no] : undefined;
          if (lk !== undefined) {
            if (typeof lk === 'object' && lk.a !== undefined) {
              // explicit score in t1/t2 orientation of the GM row
              if (info && info.rev) { ga = lk.b; gb = lk.a; } else { ga = lk.a; gb = lk.b; }
            } else {
              // outcome token 'A'/'D'/'B' relative to GM t1/t2; produce a
              // representative score (1-0 / 1-1 / 0-1), reoriented to fixture.
              var tok = lk;
              if (info && info.rev) tok = (tok === 'A') ? 'B' : (tok === 'B') ? 'A' : 'D';
              if (tok === 'A') { ga = 1; gb = 0; }
              else if (tok === 'B') { ga = 0; gb = 1; }
              else { ga = 1; gb = 1; }
            }
          } else {
            // simulate. honor groupOverrides (live W/D/L) if present for this match.
            var ov = no != null ? groupOverrides[no] : null;
            if (ov) {
              // sample the outcome from the market, then a plausible score.
              var pA = ov.pA, pD = ov.pD, pB = ov.pB;
              // reorient market (which is in GM t1/t2 order) to fixture order
              if (info && info.rev) { var tmp = pA; pA = pB; pB = tmp; }
              var u = rnd();
              if (u < pA) { ga = 1 + (rnd() < 0.45 ? 1 : 0); gb = (ga > 1 && rnd() < 0.4) ? 1 : 0; }
              else if (u < pA + pD) { ga = (rnd() < 0.55 ? 1 : 0); gb = ga; }
              else { gb = 1 + (rnd() < 0.45 ? 1 : 0); ga = (gb > 1 && rnd() < 0.4) ? 1 : 0; }
            } else {
              var host1 = hostAdvFor(t1, info ? info.v : null);
              var host2 = hostAdvFor(t2, info ? info.v : null);
              var dr = ((elo[t1] - elo[t2]) + host1 - host2) * s;
              var diff = dr / 400;
              var lamA = Math.max(0.15, GOALS_BASE / 2 + diff / 2);
              var lamB = Math.max(0.15, GOALS_BASE / 2 - diff / 2);
              ga = sampleGoals(lamA, rnd);
              gb = sampleGoals(lamB, rnd);
            }
          }

          // record
          var a1 = st[t1], a2 = st[t2];
          a1.gf += ga; a2.gf += gb; a1.gd += (ga - gb); a2.gd += (gb - ga);
          if (ga > gb) a1.pts += 3;
          else if (ga < gb) a2.pts += 3;
          else { a1.pts += 1; a2.pts += 1; }
        }
        // rank the 4 teams
        var ordered = teams.slice().sort(function (a, b) { return cmpTeam(a, b, st, elo); });
        ranks[g] = ordered;
        // top 2 reached R32
        cnt.r32[teamIdx[ordered[0]]]++;
        cnt.r32[teamIdx[ordered[1]]]++;
        // 3rd place -> candidate pool
        var third = ordered[2];
        thirdsList.push({ code: third, g: g, pts: st[third].pts, gd: st[third].gd, gf: st[third].gf });
      }

      // 2) BEST 8 OF 12 THIRDS --------------------------------------------
      thirdsList.sort(function (x, y) {
        if (y.pts !== x.pts) return y.pts - x.pts;
        if (y.gd !== x.gd) return y.gd - x.gd;
        if (y.gf !== x.gf) return y.gf - x.gf;
        return elo[y.code] - elo[x.code];
      });
      var top8 = thirdsList.slice(0, 8);
      var qualGroups = top8.map(function (o) { return o.g; });
      var thirdByGroup = {};
      top8.forEach(function (o) { thirdByGroup[o.g] = o.code; });

      // 3) BIPARTITE MATCH thirds -> slots --------------------------------
      var assign = matchThirdsToSlots(qualGroups); // slotKey -> groupLetter
      // clear & fill slotThird
      for (var sk in slotThird) delete slotThird[sk];
      for (var si2 = 0; si2 < SLOTS.length; si2++) {
        var slot = SLOTS[si2];
        var gLetter = assign ? assign[slot.key] : null;
        var thirdCode = gLetter ? thirdByGroup[gLetter] : null;
        slotThird[slot.match] = thirdCode;
        if (thirdCode) cnt.r32[teamIdx[thirdCode]]++; // best-3rd also reached R32
      }

      // 4) KNOCKOUT TREE ---------------------------------------------------
      for (var ki = 0; ki < WC.KO.length; ki++) {
        var m = WC.KO[ki];
        var a = resolveSide(m, 'a');
        var b = resolveSide(m, 'b');
        if (!a || !b) { continue; } // shouldn't happen with full bracket

        // record matchup co-occurrence at this slot
        var mk = a + '|' + b;
        var bucket = matchup[m.no];
        bucket[mk] = (bucket[mk] || 0) + 1;

        // per-team path: opponent + venue at this round (advancement rounds only)
        var rd = roundOfMatch(m.no);
        if (rd) {
          var venKey = m.v + '|' + m.d;
          var pa = path[a][rd], pb = path[b][rd];
          pa.opp[b] = (pa.opp[b] || 0) + 1; pa.ven[venKey] = (pa.ven[venKey] || 0) + 1; pa.reach++;
          pb.opp[a] = (pb.opp[a] || 0) + 1; pb.ven[venKey] = (pb.ven[venKey] || 0) + 1; pb.reach++;
        }

        // resolve winner
        var w;
        var lkK = locked[m.no];
        if (lkK !== undefined && (lkK === a || lkK === b)) {
          w = lkK;
        } else {
          var ha = hostAdvFor(a, m.v), hb = hostAdvFor(b, m.v);
          var scaledDr = ((elo[a] - elo[b]) + (ha - hb)) * s;
          var pAadv = koAdvProb(scaledDr);
          w = (rnd() < pAadv) ? a : b;
        }
        winners[m.no] = w;

        // tally stage reached for the WINNER advancing into the next round
        // (third-place match 103 excluded from advancement stats)
        if (m.no !== 103) {
          var loser = (w === a) ? b : a;
          // the loser is eliminated at this round; winner moves on.
          // Stage credit is assigned at the round they REACHED (handled below).
        }
      }

      // 5) STAGE CREDITS from winners -------------------------------------
      // r16 = winners of R32 (matches 73..88)
      // qf  = winners of R16 (89..96)
      // sf  = winners of QF  (97..100)
      // final = winners of SF (101,102)
      // champion = winner of 104
      for (var n73 = 73; n73 <= 88; n73++) if (winners[n73]) cnt.r16[teamIdx[winners[n73]]]++;
      for (var n89 = 89; n89 <= 96; n89++) if (winners[n89]) cnt.qf[teamIdx[winners[n89]]]++;
      for (var n97 = 97; n97 <= 100; n97++) if (winners[n97]) cnt.sf[teamIdx[winners[n97]]]++;
      if (winners[101]) cnt.final[teamIdx[winners[101]]]++;
      if (winners[102]) cnt.final[teamIdx[winners[102]]]++;
      if (winners[104]) cnt.champion[teamIdx[winners[104]]]++;

      // clear winners for next run
      for (var wn in winners) delete winners[wn];
    }

    // ---- assemble results ----------------------------------------------
    var teamStage = {};
    codes.forEach(function (c, i) {
      var r32 = cnt.r32[i] / N;
      teamStage[c] = {
        groupOut: 1 - r32,
        r32: r32,
        r16: cnt.r16[i] / N,
        qf: cnt.qf[i] / N,
        sf: cnt.sf[i] / N,
        final: cnt.final[i] / N,
        champion: cnt.champion[i] / N
      };
    });

    // matchupAtSlot: top opponent pairs per KO match (with raw counters kept)
    var matchupAtSlot = {};
    WC.KO.forEach(function (m) {
      var bucket = matchup[m.no];
      var arr = Object.keys(bucket).map(function (k) {
        var parts = k.split('|');
        return { a: parts[0], b: parts[1], prob: bucket[k] / N, count: bucket[k] };
      }).sort(function (x, y) { return y.count - x.count; });
      matchupAtSlot[m.no] = { top: arr.slice(0, 12), all: bucket, N: N };
    });

    // teamPath: per round opponents/venues/reach as probabilities
    var teamPath = {};
    codes.forEach(function (c) {
      teamPath[c] = {};
      ROUNDS.forEach(function (r) {
        var p = path[c][r];
        var opps = Object.keys(p.opp).map(function (o) {
          return { code: o, prob: p.opp[o] / N };
        }).sort(function (x, y) { return y.prob - x.prob; });
        var vens = Object.keys(p.ven).map(function (vk) {
          var parts = vk.split('|');
          return { venue: parts[0], date: parts[1], prob: p.ven[vk] / N };
        }).sort(function (x, y) { return y.prob - x.prob; });
        teamPath[c][r] = { opponents: opps, venues: vens, reach: p.reach / N };
      });
    });

    return {
      N: N,
      teamStage: teamStage,
      matchupAtSlot: matchupAtSlot,
      teamPath: teamPath,
      // raw counters for ad-hoc queries
      _matchupRaw: matchup,
      _codes: codes,
      config: { temperature: s, seed: seed }
    };
  }

  // -------------------------------------------------------------------------
  // calibrate(championMarket) — grid-search a single temperature s so the sim
  // champion vector matches the de-vigged champion market, minimizing KL.
  // championMarket: {code: prob} (should sum ~1; we de-vig/normalize here).
  // opts: { N (default 8000 for speed), grid (array of s), seed }
  // Returns { s, kl, championSim }.
  //
  // NOTE on the grid range: s<1 FLATTENS toward 50/50, s>1 SHARPENS the Elo
  // gap. A realistic champion market is MORE concentrated than the raw Elo sim
  // (clear favourites), so the KL minimum sits in the s>1 region. The grid must
  // therefore extend above 1.0 or the search pins to the 1.0 ceiling and never
  // sharpens. (Temperature still cannot REORDER teams vs Elo — that is what the
  // per-team champion rake in calibrateChampion() is for; see below.)
  // -------------------------------------------------------------------------
  function calibrate(championMarket, opts) {
    opts = opts || {};
    var N = opts.N || 8000;
    var seed = (opts.seed >>> 0) || 0x9E3779B9;
    var grid = opts.grid ||
      [0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 2.0];

    // normalize market to a proper distribution over the teams we know
    var codes = Object.keys(WC.TEAMS);
    var mkt = {}, msum = 0;
    codes.forEach(function (c) { var p = championMarket[c] || 0; mkt[c] = p; msum += p; });
    if (msum <= 0) throw new Error('calibrate: empty championMarket');
    codes.forEach(function (c) { mkt[c] /= msum; });

    var EPS = 1e-9;
    var best = null;
    for (var gi = 0; gi < grid.length; gi++) {
      var s = grid[gi];
      var res = simulate({ N: N, temperature: s, seed: seed });
      // KL(market || sim) = sum market * log(market/sim)
      var kl = 0;
      for (var ci = 0; ci < codes.length; ci++) {
        var c = codes[ci];
        var pm = mkt[c];
        if (pm <= 0) continue;
        var ps = Math.max(EPS, res.teamStage[c].champion);
        kl += pm * Math.log(pm / ps);
      }
      if (!best || kl < best.kl) {
        var champSim = {};
        codes.forEach(function (c) { champSim[c] = res.teamStage[c].champion; });
        best = { s: s, kl: kl, championSim: champSim };
      }
    }
    return best;
  }

  // -------------------------------------------------------------------------
  // calibrateChampion(championMarket) — two-stage fit that can also REORDER
  // teams to honour a champion market that disagrees with Elo ordering.
  //
  // Why a second stage: a single scalar temperature only stretches/compresses
  // the existing Elo-implied ranking; it can never move (say) Spain above
  // Argentina if Elo has Argentina higher. To actually land the top teams near
  // the market we fit a PER-TEAM Elo delta via iterative proportional fitting
  // (multiplicative raking) on the champion marginal:
  //
  //   1. coarse pre-step: grid-search temperature s (calibrate()).
  //   2. repeat `iters` times:
  //        simulate(elo + delta, temperature s)
  //        for each team: nudge delta by K * log(marketChamp / simChamp),
  //        capped to +/-maxDelta Elo so the model stays sane.
  //
  // The champion is the tip of the funnel, so a delta that fixes champion mass
  // also pulls that team's earlier-stage reach in the right direction. Returns
  // { s, deltas:{code:elo}, kl, championSim, iters }. The caller then runs the
  // production simulate() with { temperature:s, elo:eloOverrideFromDeltas }.
  //
  // opts: { N, seed, iters (default 6), K (default 90), maxDelta (default 220),
  //         grid (for the temperature pre-step) }
  // -------------------------------------------------------------------------
  function calibrateChampion(championMarket, opts) {
    opts = opts || {};
    var N = opts.N || 8000;
    var seed = (opts.seed >>> 0) || 0x9E3779B9;
    var iters = (opts.iters != null) ? opts.iters : 6;
    var K = (opts.K != null) ? opts.K : 90;
    var maxDelta = (opts.maxDelta != null) ? opts.maxDelta : 220;
    var EPS = 1e-9;

    // normalize market
    var codes = Object.keys(WC.TEAMS);
    var mkt = {}, msum = 0;
    codes.forEach(function (c) { var p = championMarket[c] || 0; mkt[c] = p; msum += p; });
    if (msum <= 0) throw new Error('calibrateChampion: empty championMarket');
    codes.forEach(function (c) { mkt[c] /= msum; });

    // stage 1: temperature pre-step
    var pre = calibrate(championMarket, { N: N, seed: seed, grid: opts.grid });
    var s = pre.s;

    // stage 2: per-team Elo-delta raking
    var deltas = {};
    codes.forEach(function (c) { deltas[c] = 0; });
    var lastKL = pre.kl, champSim = pre.championSim;
    for (var it = 0; it < iters; it++) {
      var res = simulate({ N: N, temperature: s, seed: seed, elo: deltaToElo(deltas) });
      var kl = 0;
      for (var ci = 0; ci < codes.length; ci++) {
        var c = codes[ci];
        var ps = Math.max(EPS, res.teamStage[c].champion);
        var pm = mkt[c];
        if (pm > 0) kl += pm * Math.log(pm / ps);
        // multiplicative rake in Elo space: bigger market share -> raise Elo.
        // Use a softened target (blend market with a floor) to avoid chasing
        // teams the market gives ~0.
        var target = Math.max(EPS, pm);
        var d = deltas[c] + K * Math.log(target / ps);
        if (d > maxDelta) d = maxDelta;
        if (d < -maxDelta) d = -maxDelta;
        deltas[c] = d;
      }
      lastKL = kl;
      champSim = {};
      codes.forEach(function (c) { champSim[c] = res.teamStage[c].champion; });
    }

    return { s: s, deltas: deltas, kl: lastKL, championSim: champSim, iters: iters };
  }

  // -------------------------------------------------------------------------
  // calibrateReach(reachMarkets, opts) — multi-stage IPF (iterative proportional
  // fitting) that rakes ONE per-team Elo delta against SEVERAL stage marginals
  // at once (reach-R16 / QF / SF / Final / champion), not just the champion tip.
  //
  // Why this exists (brief item 2): champion-only calibration sharpens the funnel
  // TIP but cannot add the early-round survival mass the market prices for
  // "reach QF/SF", and it has near-zero leverage on dark horses (e.g. Norway)
  // whose value lives entirely in reach markets — their tiny champion share means
  // the champion rake barely moves them. markets.js already fetches & basket-
  // normalizes the reach baskets (reachR16->16, reachQF->8, reachSF->4,
  // reachFinal->2, champion->1) but the app only displayed them. This stage
  // actually tilts the sim toward them.
  //
  // CRITICAL — rake in ELO SPACE (one delta per team), never per-stage additive
  // probability nudges. A single Elo delta shifts a team's WHOLE funnel
  // coherently, so the champion<=final<=sf<=qf<=r16<=r32 monotonicity invariant
  // is preserved automatically. Per-stage prob nudges would violate it and break
  // the test suite.
  //
  // reachMarkets: {
  //   reachR16:   {code->p, basket-summing to ~16},   (optional)
  //   reachQF:    {code->p, ~8},                       (optional)
  //   reachSF:    {code->p, ~4},                       (optional)
  //   reachFinal: {code->p, ~2},                       (optional)
  //   champion:   {code->p, ~1}                        (optional)
  // }
  // Any subset may be supplied; absent baskets are skipped. Each is re-normalized
  // to its slot count defensively so callers can pass raw or pre-normalized maps.
  //
  // opts: {
  //   N (default 8000), seed,
  //   iters (default 7), K (default 70), maxDelta (default 220),
  //   s (skip the temperature pre-step and use this fixed temperature),
  //   grid (for the temperature pre-step when s not supplied),
  //   deltas (warm-start per-team Elo deltas — e.g. reuse calibrateChampion's),
  //   weights ({r16,qf,sf,final,champion} stage weights; later stages weighted
  //            higher by default so the title signal isn't drowned by bulk
  //            survival mass)
  // }
  //
  // Returns { s, deltas:{code:elo}, stageErr:{stage:meanAbsPP}, iters }. The
  // caller then runs the production simulate() with
  // { temperature:s, elo: <abs Elo from deltaToElo(deltas)> } — i.e. the SAME
  // eloOverride path calibrateChampion already uses, so app.js recompute() is
  // unchanged apart from choosing which fit's deltas to feed it.
  // -------------------------------------------------------------------------
  var REACH_STAGES = [
    { key: 'r16', basket: 16 },
    { key: 'qf', basket: 8 },
    { key: 'sf', basket: 4 },
    { key: 'final', basket: 2 },
    { key: 'champion', basket: 1 }
  ];
  // Stage weights for the multi-stage rake. The reach tabs (radar / venue / path)
  // are the app's core product and live on bulk-survival mass, so R16/QF/SF carry
  // real weight; champion/final still carry the title signal but don't dominate
  // (a tip-heavy profile pulls strong teams DOWN at QF when chasing the
  // concentrated champion marginal). Tuned so a coherent reach market closes the
  // QF-reach gap rather than fighting it.
  var REACH_DEFAULT_WEIGHTS = { r16: 1.1, qf: 1.3, sf: 1.2, final: 1.0, champion: 1.0 };

  function calibrateReach(reachMarkets, opts) {
    opts = opts || {};
    reachMarkets = reachMarkets || {};
    var N = opts.N || 8000;
    var seed = (opts.seed >>> 0) || 0x9E3779B9;
    var iters = (opts.iters != null) ? opts.iters : 7;
    var K = (opts.K != null) ? opts.K : 70;
    var maxDelta = (opts.maxDelta != null) ? opts.maxDelta : 220;
    var weights = opts.weights || REACH_DEFAULT_WEIGHTS;
    var EPS = 1e-9;

    var codes = Object.keys(WC.TEAMS);

    // Which stage baskets did the caller actually provide? Re-normalize each to
    // its slot count defensively (so raw or pre-normalized input both work).
    var stages = [];
    for (var si = 0; si < REACH_STAGES.length; si++) {
      var st = REACH_STAGES[si];
      var raw = reachMarkets[st.key];
      if (!raw) continue;
      var sum = 0;
      codes.forEach(function (c) { var p = raw[c]; if (p != null && !isNaN(p) && p > 0) sum += p; });
      if (sum <= 0) continue;
      var scale = st.basket / sum;
      var norm = {};
      codes.forEach(function (c) {
        var p = raw[c];
        norm[c] = (p != null && !isNaN(p) && p > 0) ? p * scale : 0;
      });
      stages.push({ key: st.key, target: norm, w: (weights[st.key] != null ? weights[st.key] : 1) });
    }
    if (!stages.length) throw new Error('calibrateReach: no usable reach baskets supplied');

    // Temperature: fixed if provided, else a coarse champion-style pre-step if a
    // champion basket exists, else a plain grid pre-step against the latest
    // stage, else 1.
    var s;
    if (typeof opts.s === 'number' && opts.s > 0) {
      s = opts.s;
    } else if (reachMarkets.champion) {
      s = calibrate(reachMarkets.champion, { N: N, seed: seed, grid: opts.grid }).s;
    } else {
      // grid-search temperature against the strongest available stage marginal
      // by re-using calibrate() with that stage as a pseudo-champion target.
      var pseudo = stages[stages.length - 1].target;
      s = calibrate(pseudo, { N: N, seed: seed, grid: opts.grid }).s;
    }

    // Per-team Elo deltas (optionally warm-started from a champion fit).
    var deltas = {};
    codes.forEach(function (c) { deltas[c] = 0; });
    if (opts.deltas) codes.forEach(function (c) {
      if (typeof opts.deltas[c] === 'number') deltas[c] = opts.deltas[c];
    });

    var stageErr = {};
    for (var it = 0; it < iters; it++) {
      var res = simulate({ N: N, temperature: s, seed: seed, elo: deltaToElo(deltas) });
      // Accumulate a single weighted log-ratio nudge per team across all stages.
      var nudge = {};
      codes.forEach(function (c) { nudge[c] = 0; });
      var wsum = 0;
      for (var k = 0; k < stages.length; k++) {
        var stg = stages[k];
        wsum += stg.w;
        var err = 0, errN = 0;
        for (var ci = 0; ci < codes.length; ci++) {
          var c = codes[ci];
          var pm = stg.target[c];
          if (pm == null) pm = 0;
          var ps = Math.max(EPS, res.teamStage[c][stg.key]);
          // softened target with a floor: don't chase teams the market gives ~0
          var tgt = Math.max(EPS, pm);
          nudge[c] += stg.w * Math.log(tgt / ps);
          if (pm > 0) { err += Math.abs(ps - pm); errN++; }
        }
        stageErr[stg.key] = errN ? (err / errN) : 0;
      }
      // apply the weighted-average nudge as an Elo delta increment, capped.
      for (var cj = 0; cj < codes.length; cj++) {
        var cc = codes[cj];
        var d = deltas[cc] + K * (nudge[cc] / wsum);
        if (d > maxDelta) d = maxDelta;
        if (d < -maxDelta) d = -maxDelta;
        deltas[cc] = d;
      }
    }

    return { s: s, deltas: deltas, stageErr: stageErr, iters: iters };
  }

  // Build an Elo override map { code: absoluteElo } from a per-team delta map.
  function deltaToElo(deltas) {
    var elo = {};
    Object.keys(deltas).forEach(function (c) {
      if (WC.ELO[c] != null) elo[c] = WC.ELO[c] + deltas[c];
    });
    return elo;
  }

  // -------------------------------------------------------------------------
  // Query helpers
  // -------------------------------------------------------------------------
  // queryMatchup: P(codeA plays codeB) at any KO slot, sorted desc by prob.
  function queryMatchup(results, codeA, codeB) {
    var out = [];
    WC.KO.forEach(function (m) {
      var bucket = results._matchupRaw[m.no];
      var c1 = (bucket[codeA + '|' + codeB] || 0);
      var c2 = (bucket[codeB + '|' + codeA] || 0);
      var c = c1 + c2;
      if (c > 0) {
        var V = WC.VEN[m.v];
        out.push({
          matchNo: m.no, venue: m.v, venueName: V ? V[0] : m.v, city: V ? V[1] : '',
          date: m.d, round: roundLabel(m.no), prob: c / results.N
        });
      }
    });
    out.sort(function (x, y) { return y.prob - x.prob; });
    return out;
  }

  // queryVenue: at a given venue+date, the matchup pair distribution and
  // per-team appearance probabilities.
  function queryVenue(results, venue, date) {
    // find the KO match(es) at this venue+date
    var pairs = [], teamApp = {};
    WC.KO.forEach(function (m) {
      if (m.v !== venue || (date && m.d !== date)) return;
      var bucket = results._matchupRaw[m.no];
      Object.keys(bucket).forEach(function (k) {
        var parts = k.split('|'), prob = bucket[k] / results.N;
        pairs.push({ matchNo: m.no, pair: [parts[0], parts[1]], prob: prob, date: m.d });
        teamApp[parts[0]] = (teamApp[parts[0]] || 0) + prob;
        teamApp[parts[1]] = (teamApp[parts[1]] || 0) + prob;
      });
    });
    pairs.sort(function (x, y) { return y.prob - x.prob; });
    var apps = Object.keys(teamApp).map(function (c) { return { code: c, prob: teamApp[c] }; })
      .sort(function (x, y) { return y.prob - x.prob; });
    return { pairs: pairs, appearances: apps };
  }

  function roundLabel(no) {
    if (no >= 73 && no <= 88) return 'R32';
    if (no >= 89 && no <= 96) return 'R16';
    if (no >= 97 && no <= 100) return 'QF';
    if (no === 101 || no === 102) return 'SF';
    if (no === 103) return '3rd';
    if (no === 104) return 'Final';
    return '';
  }

  // -------------------------------------------------------------------------
  // Self-test of the Annex C bipartite matcher against the two official anchors.
  // Returns { ok, details }.
  // -------------------------------------------------------------------------
  function verifyAnnexC() {
    var details = [];
    var ok = true;
    WC.ANNEXC_ANCHORS.forEach(function (anchor) {
      var assign = matchThirdsToSlots(anchor.qualify); // slotKey -> group
      // build winner-group -> third-group map to compare to anchor.map
      var got = {};
      SLOTS.forEach(function (slot) {
        var g3 = assign ? assign[slot.key] : null;
        got[slot.winner] = g3;
      });
      var rowOk = true;
      Object.keys(anchor.map).forEach(function (winnerGroup) {
        if (got[winnerGroup] !== anchor.map[winnerGroup]) rowOk = false;
      });
      if (!rowOk) ok = false;
      details.push({ qualify: anchor.qualify.join(''), expected: anchor.map, got: got, ok: rowOk });
    });
    return { ok: ok, details: details };
  }

  var WCEngine = {
    matchProbs: matchProbs,
    simulate: simulate,
    calibrate: calibrate,
    calibrateChampion: calibrateChampion,
    calibrateReach: calibrateReach,
    deltaToElo: deltaToElo,
    queryMatchup: queryMatchup,
    queryVenue: queryVenue,
    matchThirdsToSlots: matchThirdsToSlots,
    setAnnexCTable: setAnnexCTable,
    verifyAnnexC: verifyAnnexC,
    mulberry32: mulberry32,
    _SLOTS: SLOTS
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = WCEngine;
  root.WCEngine = WCEngine;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
