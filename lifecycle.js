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
    return Number.isFinite(ms) && ms >= ARCHIVE_START_MS;
  }

  function shouldPollMarkets(now) {
    return !isArchiveMode(now);
  }

  function snapshotUsability(snapshot) {
    var champion = snapshot && snapshot.champion;
    var prices = champion && champion.normalized;
    if (!prices || Object.keys(prices).length === 0) {
      return { usable: false, reason: 'missing-champion-market' };
    }
    if (champion.closed === true || champion.active === false) {
      return { usable: false, reason: 'settled-champion-market' };
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
    return Promise.resolve().then(fetchSnapshot).then(function (snapshot) {
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
    snapshotUsability: snapshotUsability,
    shouldUseMarketSnapshot: shouldUseMarketSnapshot,
    loadUsableMarketSnapshot: loadUsableMarketSnapshot
  };
});
