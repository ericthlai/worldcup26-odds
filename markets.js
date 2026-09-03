/* =====================================================================
   markets.js  —  window.WCMarkets
   Polymarket live-data layer for the World Cup 2026 static app.

   Fetches NORMALIZED, code-keyed marginals + de-vig helpers from
   gamma-api.polymarket.com. CORS is open (Access-Control-Allow-Origin:*),
   so this runs as a direct browser fetch — no backend, no proxy.

   Verified live (build day 2026-06-13, all HTTP 200):
     world-cup-team-to-advance-to-knockout-stages : 48 binaries, Yes-sum 31.78 ~= 32
     world-cup-winner                             : 60 mkts negRisk,  Yes-sum 1.02 -> normalize
     world-cup-group-{a..l}-winner                : per-group negRisk, Yes-sum ~= 1.00
     world-cup-nation-to-reach-round-of-16        : 48 binaries, Yes-sum ~16.7  (-> basket 16)
     world-cup-nation-to-reach-quarterfinals      : 48 binaries, Yes-sum  ~8.9  (-> basket 8)
     world-cup-nation-to-reach-semifinals         : 48 binaries, Yes-sum  ~4.5  (-> basket 4)
     world-cup-nation-to-reach-final              : 48 binaries, Yes-sum  ~2.6  (-> basket 2)
     world-cup-{nation}-stage-of-elimination      : per-team negRisk exit distribution
     fifwc-* (52 group matches)                   : 3-way win/draw/loss per match

   NOTE ON /events DEPRECATION:
     Polymarket has marked the /events slug-lookup path with Sunset 2026-05-01.
     As of this build it still returns 200 for every slug above, and there is no
     drop-in batch replacement that preserves the groupItemTitle layout, so we
     keep using /events?slug=... lookups. If/when it 410s, the migration target
     is /markets?slug=... per-market (loses the event grouping; rebuild bySlug
     from market.events[] instead). Each family is fetched in its own try/catch,
     so a single sunset slug degrades to a partial result + errors[], not a crash.
   ===================================================================== */
(function (global) {
  'use strict';

  var GAMMA = 'https://gamma-api.polymarket.com';
  var CACHE_MS = 5 * 60 * 1000;        // respect 5-min cache; don't refetch faster
  var FETCH_TIMEOUT_MS = 12000;

  /* ---------------------------------------------------------------
     Team-name -> our 3-letter code.
     Prefer window.WC.NAME2CODE if the shared data module is loaded;
     otherwise fall back to this self-contained copy (ported verbatim
     from reference-prediction-app.html, extended with the extra
     spellings Polymarket uses across these markets).
     --------------------------------------------------------------- */
  var WC = global.WC || {};
  var NAME2CODE = (WC && WC.NAME2CODE) ? WC.NAME2CODE : {
    'Mexico': 'mex', 'South Africa': 'rsa', 'South Korea': 'kor', 'Korea Republic': 'kor', 'Korea': 'kor',
    'Czechia': 'cze', 'Czech Republic': 'cze',
    'Canada': 'can',
    'Bosnia and Herzegovina': 'bih', 'Bosnia & Herzegovina': 'bih',
    'Bosnia-Herzegovina': 'bih', 'Bosnia': 'bih',
    'Qatar': 'qat', 'Switzerland': 'sui',
    'Brazil': 'bra', 'Morocco': 'mar', 'Haiti': 'hai', 'Scotland': 'sco',
    'United States': 'usa', 'USA': 'usa', 'US': 'usa', 'Paraguay': 'par', 'Australia': 'aus',
    'Türkiye': 'tur', 'Turkey': 'tur', 'Turkiye': 'tur',
    'Germany': 'ger', 'Curaçao': 'cuw', 'Curacao': 'cuw',
    "Côte d'Ivoire": 'civ', "Côte d’Ivoire": 'civ', 'Ivory Coast': 'civ', "Cote d'Ivoire": 'civ',
    'Ecuador': 'ecu',
    'Netherlands': 'ned', 'Japan': 'jpn', 'Sweden': 'swe', 'Tunisia': 'tun',
    'Belgium': 'bel', 'Egypt': 'egy', 'Iran': 'irn', 'New Zealand': 'nzl',
    'Spain': 'esp', 'Cape Verde': 'cpv', 'Cabo Verde': 'cpv', 'Saudi Arabia': 'ksa', 'Uruguay': 'uru',
    'France': 'fra', 'Senegal': 'sen', 'Iraq': 'irq', 'Norway': 'nor',
    'Argentina': 'arg', 'Algeria': 'alg', 'Austria': 'aut', 'Jordan': 'jor',
    'Portugal': 'por', 'DR Congo': 'cod', 'Congo DR': 'cod', 'DRC': 'cod',
    'Democratic Republic of the Congo': 'cod', 'Uzbekistan': 'uzb', 'Colombia': 'col',
    'England': 'eng', 'Croatia': 'cro', 'Ghana': 'gha', 'Panama': 'pan',
    // Non-qualified nations that the live "world-cup-winner" market still lists
    // as longshots. Mapping them keeps the raw champion basket faithful to the
    // live data (no silent drop that inflates everyone else on sum->1 normalize).
    // These codes are NOT in WC.TEAMS, so the sim/calibration (which iterates
    // Object.keys(WC.TEAMS)) naturally ignores them.
    'Italy': 'ita', 'Peru': 'per'
  };

  /* Group letter -> slug suffix, for world-cup-group-{a..l}-winner */
  var GROUP_LETTERS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'];

  /* Marquee teams that have a -stage-of-elimination market (cross-check only).
     Polymarket spells these as full lowercase nation names in the slug. */
  var STAGE_ELIM_TEAMS = {
    arg: 'argentina', esp: 'spain', fra: 'france', eng: 'england', por: 'portugal',
    bra: 'brazil', ger: 'germany', ned: 'netherlands', usa: 'united-states', mex: 'mexico',
    alg: 'algeria', bel: 'belgium', cro: 'croatia', uru: 'uruguay', col: 'colombia',
    mar: 'morocco', jpn: 'japan', sen: 'senegal'
  };

  /* Stage-of-elimination outcome label -> normalized stage key. */
  var ELIM_STAGE_MAP = {
    'Group Stage': 'group', 'Groups': 'group',
    'Round of 32': 'r32', 'Round of 16': 'r16',
    'Quarterfinals': 'qf', 'Quarter Finals': 'qf', 'Quarter-finals': 'qf',
    'Semifinals': 'sf', 'Semi Finals': 'sf', 'Semi-finals': 'sf',
    'Final': 'final', 'Runner Up': 'runnerup', 'Runner-up': 'runnerup',
    'Winner': 'champion', 'Champion': 'champion',
    'Other': 'other'
  };

  /* fifwc-* per-match slugs for the 52 US group matches (matchNo -> slug).
     Ported verbatim from reference-prediction-app.html (ODDS_SLUGS).
     Prefer window.WC.ODDS_SLUGS / window.WC.GM if the data module is loaded. */
  var ODDS_SLUGS = (WC && WC.ODDS_SLUGS) ? WC.ODDS_SLUGS : {
    4: 'fifwc-usa-par-2026-06-12', 5: 'fifwc-qat-che-2026-06-13', 6: 'fifwc-bra-mar-2026-06-13',
    7: 'fifwc-hai-sco-2026-06-13', 9: 'fifwc-ger-kor-2026-06-14', 10: 'fifwc-nld-jpn-2026-06-14',
    11: 'fifwc-civ-ecu-2026-06-14', 13: 'fifwc-esp-cvi-2026-06-15', 14: 'fifwc-bel-egy-2026-06-15',
    15: 'fifwc-ksa-ury-2026-06-15', 16: 'fifwc-irn-nzl-2026-06-15', 17: 'fifwc-fra-sen-2026-06-16',
    18: 'fifwc-irq-nor-2026-06-16', 19: 'fifwc-arg-alg-2026-06-16', 20: 'fifwc-aut-jor-2026-06-17',
    21: 'fifwc-prt-cdr-2026-06-17', 22: 'fifwc-eng-hrv-2026-06-17', 25: 'fifwc-cze-rsa-2026-06-18',
    26: 'fifwc-che-bih-2026-06-18', 29: 'fifwc-usa-aus-2026-06-19', 30: 'fifwc-sco-mar-2026-06-19',
    31: 'fifwc-bra-hai-2026-06-19', 32: 'fifwc-tur-par-2026-06-19', 33: 'fifwc-nld-swe-2026-06-20',
    35: 'fifwc-ecu-kor-2026-06-20', 37: 'fifwc-esp-ksa-2026-06-21', 38: 'fifwc-bel-irn-2026-06-21',
    39: 'fifwc-ury-cvi-2026-06-21', 41: 'fifwc-nor-sen-2026-06-22', 42: 'fifwc-fra-irq-2026-06-22',
    43: 'fifwc-arg-aut-2026-06-22', 44: 'fifwc-jor-alg-2026-06-22', 45: 'fifwc-eng-gha-2026-06-23',
    47: 'fifwc-prt-uzb-2026-06-23', 49: 'fifwc-sco-bra-2026-06-24', 50: 'fifwc-mar-hai-2026-06-24',
    52: 'fifwc-bih-qat-2026-06-24', 55: 'fifwc-kor-civ-2026-06-25', 56: 'fifwc-ecu-ger-2026-06-25',
    57: 'fifwc-jpn-swe-2026-06-25', 58: 'fifwc-tun-nld-2026-06-25', 59: 'fifwc-tur-usa-2026-06-25',
    60: 'fifwc-par-aus-2026-06-25', 61: 'fifwc-nzl-bel-2026-06-26', 65: 'fifwc-nor-fra-2026-06-26',
    66: 'fifwc-sen-irq-2026-06-26', 67: 'fifwc-pan-eng-2026-06-27', 68: 'fifwc-hrv-gha-2026-06-27',
    69: 'fifwc-jor-arg-2026-06-27', 70: 'fifwc-alg-aut-2026-06-27', 71: 'fifwc-col-prt-2026-06-27',
    72: 'fifwc-cdr-uzb-2026-06-27'
  };
  /* slug team-order is reversed vs our GM[] order for these matches */
  var ODDS_SWAP = (WC && WC.ODDS_SWAP) ? WC.ODDS_SWAP : { 61: 1, 65: 1 };

  /* ===============================================================
     Low-level helpers
     =============================================================== */

  function fetchJson(url) {
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var to = ctrl ? setTimeout(function () { ctrl.abort(); }, FETCH_TIMEOUT_MS) : null;
    var opts = ctrl ? { signal: ctrl.signal } : {};
    return fetch(url, opts).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
      return r.json();
    }).then(function (j) {
      if (to) clearTimeout(to);
      return j;
    }, function (e) {
      if (to) clearTimeout(to);
      throw e;
    });
  }

  /* /events?slug=a&slug=b... -> array of events; build {slug: event} */
  function fetchEventsBySlug(slugs) {
    var qs = slugs.map(function (s) { return 'slug=' + encodeURIComponent(s); }).join('&');
    return fetchJson(GAMMA + '/events?' + qs).then(function (arr) {
      var bySlug = {};
      (Array.isArray(arr) ? arr : []).forEach(function (ev) {
        if (ev && ev.slug) bySlug[ev.slug] = ev;
      });
      return bySlug;
    });
  }

  /* Read a single market's Yes probability.
     Priority: JSON.parse(outcomePrices)[0] -> lastTradePrice -> mid(bestBid,bestAsk). */
  function marketProb(mk) {
    if (!mk) return null;
    try {
      var arr = JSON.parse(mk.outcomePrices);
      var p = parseFloat(arr[0]);
      if (!isNaN(p)) return p;
    } catch (e) { /* fall through */ }
    if (typeof mk.lastTradePrice === 'number' && !isNaN(mk.lastTradePrice)) return mk.lastTradePrice;
    var bid = parseFloat(mk.bestBid), ask = parseFloat(mk.bestAsk);
    if (!isNaN(bid) && !isNaN(ask)) return (bid + ask) / 2;
    if (!isNaN(ask)) return ask;
    if (!isNaN(bid)) return bid;
    return null;
  }

  /* clamp into (0,1) open interval to keep de-vig / KL stable */
  function clamp01(p) {
    if (p == null || isNaN(p)) return null;
    if (p < 1e-6) return 1e-6;
    if (p > 1 - 1e-6) return 1 - 1e-6;
    return p;
  }

  /* ===============================================================
     PUBLIC HELPERS
     =============================================================== */

  /* De-vig a 3-way (win/draw/loss) market by simple proportional
     normalization of the implied probabilities. Returns null-safe object. */
  function devig3(pA, pD, pB) {
    var a = clamp01(pA), d = clamp01(pD), b = clamp01(pB);
    if (a == null || d == null || b == null) return null;
    var s = a + d + b;
    if (s <= 0) return null;
    return { pA: a / s, pD: d / s, pB: b / s, overround: s };
  }

  /* Normalize a {code -> p} basket so the values sum to targetSum
     (e.g. 32 qualifiers, 16/8/4/2 stage slots, 1 for a coherent champ basket).
     Pure scaling — preserves the relative ordering the market expresses. */
  function normalizeBasket(obj, targetSum) {
    var out = {};
    var s = 0, k;
    for (k in obj) if (obj.hasOwnProperty(k) && obj[k] != null && !isNaN(obj[k])) s += obj[k];
    if (s <= 0) { for (k in obj) if (obj.hasOwnProperty(k)) out[k] = 0; return out; }
    var scale = (targetSum || 1) / s;
    for (k in obj) if (obj.hasOwnProperty(k)) {
      out[k] = (obj[k] == null || isNaN(obj[k])) ? 0 : obj[k] * scale;
    }
    return out;
  }

  /* Polymarket label -> our code (trims, tolerates the spelling variants above) */
  function nameToCode(name) {
    if (!name) return null;
    if (NAME2CODE[name]) return NAME2CODE[name];
    var t = String(name).trim();
    if (NAME2CODE[t]) return NAME2CODE[t];
    return null;
  }

  /* Collapse an event's markets into a {code -> Yes prob} map.
     Skips "Other"/unmatched buckets (no code) but counts them via onSkip. */
  function eventToCodeMap(ev) {
    var out = {};
    if (!ev || !ev.markets) return out;
    ev.markets.forEach(function (mk) {
      var p = marketProb(mk);
      if (p == null) return;
      var code = nameToCode(mk.groupItemTitle);
      if (code) out[code] = p;
    });
    return out;
  }

  /* ===============================================================
     PER-FAMILY FETCHERS  (each isolates its own failure)
     =============================================================== */

  function eventLifecycle(ev) {
    return {
      closed: ev && typeof ev.closed === 'boolean' ? ev.closed : null,
      active: ev && typeof ev.active === 'boolean' ? ev.active : null,
      endDate: ev && typeof ev.endDate === 'string' ? ev.endDate : null
    };
  }

  // champion: world-cup-winner (negRisk, ~coherent). Normalize Yes-sum to 1.
  function fetchChampion() {
    return fetchEventsBySlug(['world-cup-winner']).then(function (bySlug) {
      var ev = bySlug['world-cup-winner'];
      var raw = eventToCodeMap(ev);
      var normalized = normalizeBasket(raw, 1);
      var lifecycle = eventLifecycle(ev);
      return {
        code: raw,
        normalized: normalized,
        closed: lifecycle.closed,
        active: lifecycle.active,
        endDate: lifecycle.endDate
      };
    });
  }

  // to-advance (R32 marginal): 48 binaries, Yes-sum ~32. WELL CALIBRATED.
  function fetchAdvance() {
    return fetchEventsBySlug(['world-cup-team-to-advance-to-knockout-stages']).then(function (bySlug) {
      var ev = bySlug['world-cup-team-to-advance-to-knockout-stages'];
      return eventToCodeMap(ev); // leave as raw market probs (already ~well-calibrated)
    });
  }

  // group-winner: 12 per-group events, each negRisk (Yes-sum ~1).
  function fetchGroupWinner() {
    var slugs = GROUP_LETTERS.map(function (l) { return 'world-cup-group-' + l + '-winner'; });
    return fetchEventsBySlug(slugs).then(function (bySlug) {
      var out = {};
      GROUP_LETTERS.forEach(function (l) {
        var ev = bySlug['world-cup-group-' + l + '-winner'];
        var m = eventToCodeMap(ev);
        if (Object.keys(m).length) out[l.toUpperCase()] = normalizeBasket(m, 1);
      });
      return out;
    });
  }

  // reach-stage baskets. NOTE the slug/target mapping:
  //   round-of-16  -> 16 teams ; quarterfinals -> 8 ; semifinals -> 4 ; final -> 2.
  // Over-round grows toward the tail, so each basket is normalized to its slot count.
  function fetchReach(slug, targetSum) {
    return fetchEventsBySlug([slug]).then(function (bySlug) {
      var ev = bySlug[slug];
      var raw = eventToCodeMap(ev);
      var lifecycle = eventLifecycle(ev);
      return {
        prices: normalizeBasket(raw, targetSum),
        closed: lifecycle.closed,
        active: lifecycle.active,
        endDate: lifecycle.endDate
      };
    });
  }

  // per-match fifwc-* 3-way markets (52 group matches). De-vig before override.
  function fetchPerMatch() {
    var nos = Object.keys(ODDS_SLUGS);
    var batches = [];
    for (var i = 0; i < nos.length; i += 13) batches.push(nos.slice(i, i + 13));
    return Promise.all(batches.map(function (batch) {
      return fetchEventsBySlug(batch.map(function (n) { return ODDS_SLUGS[n]; }))
        .catch(function () { return {}; });
    })).then(function (maps) {
      var bySlug = {};
      maps.forEach(function (m) { for (var k in m) if (m.hasOwnProperty(k)) bySlug[k] = m[k]; });
      var out = {};
      nos.forEach(function (no) {
        var ev = bySlug[ODDS_SLUGS[no]];
        if (!ev || !ev.markets || !ev.title) return;
        var names = ev.title.split(' vs. ').map(function (s) { return s.trim(); });
        var pA = null, pD = null, pB = null;
        ev.markets.forEach(function (mk) {
          var g = mk.groupItemTitle || '';
          var p = marketProb(mk);
          if (p == null) return;
          if (g.indexOf('Draw') === 0) pD = p;
          else if (g === names[0]) pA = p;
          else if (g === names[1]) pB = p;
        });
        if (pA == null || pD == null || pB == null) return;
        if (ODDS_SWAP[no]) { var t = pA; pA = pB; pB = t; } // align to our GM team order
        var dv = devig3(pA, pD, pB);
        out[no] = {
          pA: pA, pD: pD, pB: pB,
          devigged: dv,                                  // {pA,pD,pB,overround} or null
          closed: typeof ev.closed === 'boolean' ? ev.closed : null,
          active: typeof ev.active === 'boolean' ? ev.active : null,
          live: typeof ev.live === 'boolean' ? ev.live : null
        };
      });
      return out;
    });
  }

  // stage-of-elimination (marquee teams only): per-team exit distribution.
  function fetchStageElim() {
    var codes = Object.keys(STAGE_ELIM_TEAMS);
    var slugs = codes.map(function (c) { return 'world-cup-' + STAGE_ELIM_TEAMS[c] + '-stage-of-elimination'; });
    return fetchEventsBySlug(slugs).then(function (bySlug) {
      var out = {};
      codes.forEach(function (code) {
        var ev = bySlug['world-cup-' + STAGE_ELIM_TEAMS[code] + '-stage-of-elimination'];
        if (!ev || !ev.markets) return;
        var dist = {};
        ev.markets.forEach(function (mk) {
          var p = marketProb(mk);
          if (p == null) return;
          var stage = ELIM_STAGE_MAP[mk.groupItemTitle] || (mk.groupItemTitle || '').toLowerCase();
          dist[stage] = p;
        });
        if (Object.keys(dist).length) out[code] = dist;
      });
      return out;
    });
  }

  /* ===============================================================
     CACHE + ORCHESTRATION
     =============================================================== */

  var _cache = null;        // last successful (possibly partial) fetchAll result
  var _cacheAt = 0;
  var _inflight = null;     // de-dupe concurrent callers

  // run a labeled fetcher, push any failure to errors[] and return fallback
  function guard(label, promise, fallback, errors) {
    return promise.catch(function (e) {
      errors.push({ market: label, error: String(e && e.message || e) });
      return fallback;
    });
  }

  /**
   * fetchAll(opts) -> Promise<normalized snapshot>
   * opts.force === true bypasses the 5-min cache.
   *
   * Resolves to:
   * {
   *   champion:   { code:{code->p}, normalized:{code->p sum 1}, closed, active, endDate },
   *   advance:    { code->p }                  // R32 qualify marginal (~well-calibrated)
   *   groupWinner:{ 'A'..'L' -> {code->p sum 1} },
   *   reachR16:   { prices:{code->p sum 16}, closed, active, endDate },
   *   reachQF:    { prices:{code->p sum 8}, closed, active, endDate },
   *   reachSF:    { prices:{code->p sum 4}, closed, active, endDate },
   *   reachFinal: { prices:{code->p sum 2}, closed, active, endDate },
   *   perMatch:   { matchNo -> {pA,pD,pB, devigged, closed, active, live} },
   *   stageElim:  { code -> {stageKey->p} },   // marquee cross-check
   *   fetchedAt:  Date,
   *   errors:     [ {market, error} ]
   * }
   * Partial failure returns whatever succeeded plus errors[].
   */
  function fetchAll(opts) {
    opts = opts || {};
    var now = Date.now();
    if (!opts.force && _cache && (now - _cacheAt) < CACHE_MS) {
      return Promise.resolve(_cache);
    }
    if (_inflight) return _inflight;

    var errors = [];
    var jobs = {
      champion:   guard('world-cup-winner', fetchChampion(), {
        code: {}, normalized: {}, closed: null, active: null, endDate: null
      }, errors),
      advance:    guard('world-cup-team-to-advance-to-knockout-stages', fetchAdvance(), {}, errors),
      groupWinner:guard('world-cup-group-{a..l}-winner', fetchGroupWinner(), {}, errors),
      reachR16:   guard('world-cup-nation-to-reach-round-of-16',  fetchReach('world-cup-nation-to-reach-round-of-16', 16),  { prices: {}, closed: null, active: null, endDate: null }, errors),
      reachQF:    guard('world-cup-nation-to-reach-quarterfinals', fetchReach('world-cup-nation-to-reach-quarterfinals', 8), { prices: {}, closed: null, active: null, endDate: null }, errors),
      reachSF:    guard('world-cup-nation-to-reach-semifinals',    fetchReach('world-cup-nation-to-reach-semifinals', 4),    { prices: {}, closed: null, active: null, endDate: null }, errors),
      reachFinal: guard('world-cup-nation-to-reach-final',         fetchReach('world-cup-nation-to-reach-final', 2),         { prices: {}, closed: null, active: null, endDate: null }, errors),
      perMatch:   guard('fifwc-* (52 group matches)', fetchPerMatch(), {}, errors),
      stageElim:  guard('world-cup-{nation}-stage-of-elimination', fetchStageElim(), {}, errors)
    };

    var keys = Object.keys(jobs);
    _inflight = Promise.all(keys.map(function (k) { return jobs[k]; })).then(function (vals) {
      var res = {};
      keys.forEach(function (k, i) { res[k] = vals[i]; });
      res.fetchedAt = new Date();
      res.errors = errors;
      // only overwrite cache if we got at least one core marginal
      if (Object.keys(res.advance).length || Object.keys(res.champion.code).length) {
        _cache = res; _cacheAt = Date.now();
      }
      _inflight = null;
      return res;
    }, function (e) {
      _inflight = null;
      throw e;
    });
    return _inflight;
  }

  /* ===============================================================
     EXPORT
     =============================================================== */
  global.WCMarkets = {
    fetchAll: fetchAll,
    // helpers
    devig3: devig3,
    normalizeBasket: normalizeBasket,
    nameToCode: nameToCode,
    marketProb: marketProb,
    // escape hatches / introspection
    clearCache: function () { _cache = null; _cacheAt = 0; },
    _config: { GAMMA: GAMMA, CACHE_MS: CACHE_MS, NAME2CODE: NAME2CODE, ODDS_SLUGS: ODDS_SLUGS }
  };

})(typeof window !== 'undefined' ? window : this);
