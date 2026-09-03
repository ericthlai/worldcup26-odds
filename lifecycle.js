/* ============================================================================
 * lifecycle.js — deterministic tournament / market-data lifecycle policy.
 *
 * Keep the date gate and settled-market validation outside the UI so both are
 * independently testable. After the archive cutoff, the app is a frozen model
 * explorer: it must not poll Gamma or calibrate against resolved markets.
 * ==========================================================================*/
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WCOLifecycle = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var ARCHIVE_START_ISO = '2026-07-20T00:00:00.000Z';
  var ARCHIVE_START_MS = Date.parse(ARCHIVE_START_ISO);
  var MODEL_AS_OF = 'June 2026';

  function toMillis(value) {
    if (value == null) return Date.now();
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'string') return Date.parse(value);
    return Number(value);
  }

  function isArchiveMode(now) {
    var ms = toMillis(now);
    return !Number.isFinite(ms) || ms >= ARCHIVE_START_MS;
  }

  function shouldPollMarkets(now) {
    return !isArchiveMode(now);
  }

  function lifecycleUsability(record) {
    if (!record) return { usable: false, reason: 'unknown-market-lifecycle' };
    if (record.closed === true || record.active === false) {
      return { usable: false, reason: 'settled-market' };
    }
    if (record.closed !== false || record.active !== true) {
      return { usable: false, reason: 'unknown-market-lifecycle' };
    }
    return { usable: true, reason: 'open-market' };
  }

  function finiteProbabilityMap(prices) {
    if (!prices || typeof prices !== 'object') return false;
    var keys = Object.keys(prices);
    if (!keys.length) return false;
    var total = 0;
    for (var i = 0; i < keys.length; i++) {
      var value = prices[keys[i]];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) return false;
      total += value;
    }
    return Number.isFinite(total) && total > 0;
  }

  function marketRecordUsability(record, pricesKey) {
    var lifecycle = lifecycleUsability(record);
    if (!lifecycle.usable) return lifecycle;
    if (!finiteProbabilityMap(record[pricesKey])) {
      return { usable: false, reason: 'invalid-market-prices' };
    }
    return lifecycle;
  }

  function perMatchUsability(record) {
    var lifecycle = lifecycleUsability(record);
    if (!lifecycle.usable) return lifecycle;
    var p = record.devigged;
    if (!p || !['pA', 'pD', 'pB'].every(function (key) {
      return typeof p[key] === 'number' && Number.isFinite(p[key]) && p[key] >= 0 && p[key] <= 1;
    })) return { usable: false, reason: 'invalid-market-prices' };
    var sum = p.pA + p.pD + p.pB;
    if (!Number.isFinite(sum) || Math.abs(sum - 1) > 1e-6) {
      return { usable: false, reason: 'invalid-market-prices' };
    }
    return lifecycle;
  }

  function snapshotUsability(snapshot) {
    var champion = snapshot && snapshot.champion;
    var prices = champion && champion.normalized;
    if (!finiteProbabilityMap(prices)) {
      return { usable: false, reason: 'missing-champion-market' };
    }
    var lifecycle = lifecycleUsability(champion);
    if (lifecycle.reason === 'settled-market') {
      return { usable: false, reason: 'settled-champion-market' };
    }
    if (!lifecycle.usable) {
      return { usable: false, reason: 'unknown-champion-lifecycle' };
    }
    return { usable: true, reason: 'open-market' };
  }

  function shouldUseMarketSnapshot(snapshot, now) {
    if (isArchiveMode(now)) return false;
    return snapshotUsability(snapshot).usable;
  }

  // Run the network boundary only while markets are eligible. The clock is
  // injectable for deterministic tests and is checked again after the async
  // fetch so a request started before the cutoff cannot feed later calibration.
  function loadUsableMarketSnapshot(fetchSnapshot, nowFn) {
    var clock = typeof nowFn === 'function' ? nowFn : Date.now;
    if (!shouldPollMarkets(clock())) {
      return Promise.resolve({ usable: false, reason: 'archive-cutoff', snapshot: null });
    }
    // Check once more and invoke synchronously. This removes the microtask gap
    // in which the cutoff could pass after approval but before Gamma is called.
    if (!shouldPollMarkets(clock())) {
      return Promise.resolve({ usable: false, reason: 'archive-cutoff', snapshot: null });
    }
    var pending;
    try { pending = fetchSnapshot(); }
    catch (e) { return Promise.reject(e); }
    return Promise.resolve(pending).then(function (snapshot) {
      if (!shouldPollMarkets(clock())) {
        return { usable: false, reason: 'archive-cutoff', snapshot: null };
      }
      var status = snapshotUsability(snapshot);
      return {
        usable: status.usable,
        reason: status.reason,
        snapshot: status.usable ? snapshot : null
      };
    });
  }

  return {
    ARCHIVE_START_ISO: ARCHIVE_START_ISO,
    ARCHIVE_START_MS: ARCHIVE_START_MS,
    MODEL_AS_OF: MODEL_AS_OF,
    isArchiveMode: isArchiveMode,
    shouldPollMarkets: shouldPollMarkets,
    lifecycleUsability: lifecycleUsability,
    finiteProbabilityMap: finiteProbabilityMap,
    marketRecordUsability: marketRecordUsability,
    perMatchUsability: perMatchUsability,
    snapshotUsability: snapshotUsability,
    shouldUseMarketSnapshot: shouldUseMarketSnapshot,
    loadUsableMarketSnapshot: loadUsableMarketSnapshot
  };
});
