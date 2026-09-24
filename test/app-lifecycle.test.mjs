import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const [appSource, lifecycleSource] = await Promise.all([
  readFile(new URL('../app.js', import.meta.url), 'utf8'),
  readFile(new URL('../lifecycle.js', import.meta.url), 'utf8'),
]);

const CUTOFF = Date.parse('2026-07-20T00:00:00.000Z');
const PRE_CUTOFF = CUTOFF - 1000;

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function flushUntil(predicate, message) {
  for (let i = 0; i < 20 && !predicate(); i += 1) await Promise.resolve();
  assert.ok(predicate(), message);
}

function makeSnapshot(options = {}) {
  const reachLifecycle = options.reachLifecycle || { closed: false, active: true };
  const matchLifecycle = options.matchLifecycle || { closed: false, active: true };
  return {
    champion: {
      normalized: { arg: 0.6, por: 0.4 },
      closed: false,
      active: true,
    },
    reachR16: {
      prices: { arg: 0.8, por: 0.7 },
      ...reachLifecycle,
    },
    reachQF: { prices: {}, closed: null, active: null },
    reachSF: { prices: {}, closed: null, active: null },
    reachFinal: { prices: {}, closed: null, active: null },
    perMatch: {
      1: {
        devigged: { pA: 0.5, pD: 0.25, pB: 0.25 },
        ...matchLifecycle,
      },
    },
  };
}

function createHarness(initialNow = PRE_CUTOFF) {
  const clock = { now: initialNow, samples: [] };
  let nextTimerId = 1;
  const timeouts = new Map();
  const intervals = new Map();
  const clearedTimeouts = [];
  const clearedIntervals = [];
  const listeners = new Map();
  let gammaCalls = 0;

  class FakeDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [clock.now]));
    }
    static now() {
      if (clock.samples.length) clock.now = clock.samples.shift();
      return clock.now;
    }
  }

  function Component() {}
  Component.prototype.setState = function (update, callback) {
    this.__setStateCalls = (this.__setStateCalls || 0) + 1;
    const patch = typeof update === 'function' ? update(this.state, this.props) : update;
    this.state = { ...this.state, ...patch };
    if (callback) callback();
  };

  const engineApi = {};
  const marketApi = {
    fetchAll: async () => {
      gammaCalls += 1;
      return makeSnapshot();
    },
  };
  const appElement = {
    innerHTML: '',
    replaceChildren() {},
    appendChild() {},
  };
  const sandbox = {
    console,
    Date: FakeDate,
    Promise,
    localStorage: { getItem() { return null; }, setItem() {} },
    preact: {
      Component,
      h(type, props) { return { type, props }; },
      render() {},
    },
    htm: { bind() { return function template() { return null; }; } },
    WC: {
      GROUPS: { A: ['arg', 'por', 'usa', 'par'] },
      GM: [[1, '', 'A', 'arg', 'por']],
      KO: [],
      ELO: { arg: 2100, por: 2000, usa: 1900, par: 1800 },
      TEAMS: {}, VEN: {}, STARS: {}, VENMATCH: {},
    },
    WCEngine: engineApi,
    WCMarkets: marketApi,
    __WCO_TEST__: {},
    document: {
      visibilityState: 'visible',
      getElementById() { return appElement; },
      createElement() { return { style: {}, textContent: '' }; },
      addEventListener(name, fn) { listeners.set(name, fn); },
      removeEventListener(name, fn) {
        if (listeners.get(name) === fn) listeners.delete(name);
      },
    },
    setTimeout(fn, delay) {
      const id = nextTimerId++;
      timeouts.set(id, { fn, delay });
      return id;
    },
    clearTimeout(id) {
      clearedTimeouts.push(id);
      timeouts.delete(id);
    },
    setInterval(fn, delay) {
      const id = nextTimerId++;
      intervals.set(id, { fn, delay });
      return id;
    },
    clearInterval(id) {
      clearedIntervals.push(id);
      intervals.delete(id);
    },
  };
  sandbox.window = sandbox;

  const context = vm.createContext(sandbox);
  vm.runInContext(lifecycleSource, context, { filename: 'lifecycle.js' });
  vm.runInContext(appSource, context, { filename: 'app.js' });
  const App = sandbox.__WCO_TEST__.App;
  assert.equal(typeof App, 'function', 'test seam should expose the real App constructor');

  return {
    app: new App(),
    clock,
    engineApi,
    marketApi,
    gammaCalls: () => gammaCalls,
    setGammaCalls(value) { gammaCalls = value; },
    timeouts,
    intervals,
    clearedTimeouts,
    clearedIntervals,
    listeners,
    runTimeout(id) {
      const timer = timeouts.get(id);
      assert.ok(timer, `timeout ${id} should exist`);
      timeouts.delete(id);
      return timer.fn();
    },
  };
}

test('post-cutoff refresh and cutoff scheduling make zero Gamma calls', async () => {
  const h = createHarness(CUTOFF);
  h.marketApi.fetchAll = async () => {
    h.setGammaCalls(h.gammaCalls() + 1);
    return makeSnapshot();
  };

  await h.app.scheduleArchiveCutoff();
  await h.app.refreshMarkets(true);

  assert.equal(h.gammaCalls(), 0);
  assert.equal(h.timeouts.size, 0);
  assert.equal(h.intervals.size, 0);
  assert.equal(h.app.state.archiveMode, true);
  assert.equal(h.app.state.snapshot, null);
});

test('a just-accepted fetch cannot launch calibration after the cutoff', async () => {
  const h = createHarness(PRE_CUTOFF);
  const response = deferred();
  let calibrations = 0;
  h.app.state.baseline = { kind: 'baseline' };
  h.app.state.results = { kind: 'baseline' };
  h.marketApi.fetchAll = () => response.promise;
  h.app.calibrateChampionWorker = async () => {
    calibrations += 1;
    return { s: 0.8, deltas: { arg: 20 } };
  };
  h.app.simulate = async () => ({ kind: 'pure' });

  const pending = h.app.refreshMarkets(true);
  response.resolve(makeSnapshot());
  // The lifecycle helper accepts the resolved fetch first. This queued clock
  // change runs before App's next .then callback and models the exact boundary
  // between accepting the response and launching champion calibration.
  queueMicrotask(() => { h.clock.now = CUTOFF; });
  await pending;

  assert.equal(calibrations, 0);
  assert.equal(h.app.state.archiveMode, true);
  assert.equal(h.app.state.snapshot, null);
});

test('a deferred Gamma response resolved after the cutoff cannot calibrate', async () => {
  const h = createHarness(CUTOFF - 10);
  const response = deferred();
  const configs = [];
  let gammaCalls = 0;
  let calibrations = 0;
  h.app.state.baseline = { kind: 'baseline' };
  h.app.state.results = { kind: 'baseline' };
  h.marketApi.fetchAll = () => {
    gammaCalls += 1;
    return response.promise;
  };
  h.app.calibrateChampionWorker = async () => {
    calibrations += 1;
    return { s: 0.8, deltas: { arg: 20 } };
  };
  h.app.simulate = async (config) => {
    configs.push(config);
    return { kind: 'pure' };
  };

  await h.app.scheduleArchiveCutoff();
  const timerId = [...h.timeouts.keys()][0];
  const pending = h.app.refreshMarkets(true);
  assert.equal(gammaCalls, 1, 'Gamma starts only while the lifecycle is open');
  h.clock.now = CUTOFF;
  h.runTimeout(timerId);
  response.resolve(makeSnapshot());
  await pending;

  assert.equal(calibrations, 0);
  assert.ok(configs.length >= 1);
  assert.ok(configs.every((config) => config.temperature === 1));
  assert.ok(configs.every((config) => config.elo === null));
  assert.ok(configs.every((config) => Object.keys(config.groupOverrides).length === 0));
  assert.equal(h.app.state.archiveMode, true);
  assert.equal(h.app.state.snapshot, null);
});

test('the exact cutoff timer immediately clears stale market state and recomputes model-only', async () => {
  const h = createHarness(CUTOFF - 10);
  const pureBaseline = { kind: 'baseline' };
  const pureResult = { kind: 'pure-what-if' };
  const simulation = deferred();
  const configs = [];
  h.app.state.baseline = pureBaseline;
  h.app.state.results = { kind: 'market-result' };
  h.app.state.snapshot = makeSnapshot();
  h.app.state.temp = 0.8;
  h.app.state.calib = { s: 0.8 };
  h.app.state.calibDeltas = { arg: 25 };
  h.app.state.reachMarketsApplied = { r16: { arg: 0.8 }, champion: { arg: 0.6 } };
  h.app.state.blended = true;
  h.app._refreshTimer = h.app._refreshTimer || [...h.intervals.keys()][0];
  if (!h.app._refreshTimer) {
    h.app._refreshTimer = 9001;
    h.intervals.set(9001, { fn() {}, delay: 300000 });
  }
  h.app.simulate = (config) => {
    configs.push(config);
    return simulation.promise;
  };

  await h.app.scheduleArchiveCutoff();
  const [[timerId, timer]] = [...h.timeouts.entries()];
  assert.equal(timer.delay, 10);
  h.clock.now = CUTOFF;
  h.runTimeout(timerId);

  assert.equal(h.app.state.results, pureBaseline, 'market result is removed synchronously');
  assert.equal(h.app.state.snapshot, null);
  assert.equal(h.app.state.temp, 1);
  assert.equal(h.app.state.calib, null);
  assert.equal(h.app.state.calibDeltas, null);
  assert.equal(h.app.state.reachMarketsApplied, null);
  assert.equal(h.app.state.blended, false);
  assert.equal(h.intervals.size, 0);
  assert.equal(configs.length, 1);
  assert.equal(configs[0].temperature, 1);
  assert.equal(configs[0].elo, null);
  assert.deepEqual(plain(configs[0].groupOverrides), {});

  simulation.resolve(pureResult);
  await simulation.promise;
  await Promise.resolve();
  assert.equal(h.app.state.results, pureResult);
});

test('post-cutoff what-if keeps locks but strips every market-derived input', async () => {
  const h = createHarness(CUTOFF);
  const configs = [];
  h.app.state.baseline = { kind: 'baseline' };
  h.app.state.results = { kind: 'market-result' };
  h.app.state.snapshot = makeSnapshot();
  h.app.state.temp = 0.75;
  h.app.state.calibDeltas = { arg: 40 };
  h.app.state.reachMarketsApplied = { r16: { arg: 0.8 }, champion: { arg: 0.6 } };
  h.app.state.lockGroup = { A: 'arg' };
  h.app.simulate = async (config) => {
    configs.push(config);
    return { kind: 'pure-locked' };
  };

  await h.app.recompute();

  assert.equal(configs.length, 1);
  assert.equal(configs[0].temperature, 1);
  assert.equal(configs[0].elo, null);
  assert.deepEqual(plain(configs[0].groupOverrides), {});
  assert.deepEqual(plain(configs[0].lockedResults), { 1: 'A' });
  assert.equal(h.app.state.snapshot, null);
});

test('the cutoff timer invalidates a deferred champion calibration before it resolves', async () => {
  const h = createHarness(CUTOFF - 10);
  const configs = [];
  const calibration = deferred();
  let championCalibrations = 0;
  let reachCalibrations = 0;
  h.app.state.baseline = { kind: 'baseline' };
  h.app.state.results = { kind: 'baseline' };
  h.marketApi.fetchAll = async () => makeSnapshot();
  h.app.calibrateChampionWorker = () => {
    championCalibrations += 1;
    return calibration.promise;
  };
  h.app.calibrateReachWorker = async () => {
    reachCalibrations += 1;
    return { s: 0.7, deltas: { arg: 30 } };
  };
  h.app.simulate = async (config) => {
    configs.push(config);
    return { kind: 'pure' };
  };

  await h.app.scheduleArchiveCutoff();
  const timerId = [...h.timeouts.keys()][0];
  const pending = h.app.refreshMarkets(true);
  await flushUntil(() => championCalibrations === 1, 'champion calibration should be pending');
  h.clock.now = CUTOFF;
  h.runTimeout(timerId);
  calibration.resolve({ s: 0.8, deltas: { arg: 20 } });
  await pending;

  assert.equal(championCalibrations, 1);
  assert.equal(reachCalibrations, 0);
  assert.ok(configs.length >= 1);
  assert.ok(configs.every((config) => config.temperature === 1));
  assert.ok(configs.every((config) => config.elo === null));
  assert.ok(configs.every((config) => Object.keys(config.groupOverrides).length === 0));
  assert.equal(h.app.state.archiveMode, true);
  assert.equal(h.app.state.snapshot, null);
});

test('the cutoff timer invalidates a deferred reach calibration before it resolves', async () => {
  const h = createHarness(CUTOFF - 10);
  const configs = [];
  const calibration = deferred();
  let reachCalibrations = 0;
  h.app.state.baseline = { kind: 'baseline' };
  h.app.state.results = { kind: 'baseline' };
  h.marketApi.fetchAll = async () => makeSnapshot();
  h.app.calibrateChampionWorker = async () => ({ s: 0.8, deltas: { arg: 20 } });
  h.app.calibrateReachWorker = () => {
    reachCalibrations += 1;
    return calibration.promise;
  };
  h.app.simulate = async (config) => {
    configs.push(config);
    return { kind: 'pure' };
  };

  await h.app.scheduleArchiveCutoff();
  const timerId = [...h.timeouts.keys()][0];
  const pending = h.app.refreshMarkets(true);
  await flushUntil(() => reachCalibrations === 1, 'reach calibration should be pending');
  h.clock.now = CUTOFF;
  h.runTimeout(timerId);
  calibration.resolve({ s: 0.7, deltas: { arg: 30 } });
  await pending;

  assert.equal(reachCalibrations, 1);
  assert.ok(configs.length >= 1);
  assert.ok(configs.every((config) => config.temperature === 1));
  assert.ok(configs.every((config) => config.elo === null));
  assert.ok(configs.every((config) => Object.keys(config.groupOverrides).length === 0));
  assert.equal(h.app.state.snapshot, null);
});

test('main-thread fallback calibration cannot start from a queued callback after cutoff', async (t) => {
  for (const [name, method, engineMethod, input] of [
    ['champion', 'calibrateChampionWorker', 'calibrateChampion', { arg: 0.6, por: 0.4 }],
    ['reach', 'calibrateReachWorker', 'calibrateReach', { r16: { arg: 0.8 } }],
  ]) {
    await t.test(name, async () => {
      const h = createHarness(CUTOFF - 10);
      let engineCalls = 0;
      h.engineApi[engineMethod] = () => {
        engineCalls += 1;
        return { s: 0.8, deltas: { arg: 20 } };
      };

      await h.app.scheduleArchiveCutoff();
      const archiveTimerId = [...h.timeouts].find(([, timer]) => timer.delay === 10)[0];
      const pending = h.app[method](input, {});
      const calibrationTimerId = [...h.timeouts].find(([, timer]) => timer.delay === 0)[0];
      h.clock.now = CUTOFF;
      h.runTimeout(archiveTimerId);
      h.runTimeout(calibrationTimerId);

      await assert.rejects(pending, /market lifecycle is closed/);
      assert.equal(engineCalls, 0);
    });
  }
});

test('settled or unknown refreshes clear stale results before a failed pure recompute', async (t) => {
  for (const [name, championPatch] of [
    ['settled', { closed: true, active: false }],
    ['unknown', { closed: null, active: null }],
  ]) {
    await t.test(name, async () => {
      const h = createHarness(PRE_CUTOFF);
      const pureBaseline = { kind: `baseline-${name}` };
      const simulation = deferred();
      let simulationCalls = 0;
      const snapshot = makeSnapshot();
      Object.assign(snapshot.champion, championPatch);
      h.app.state.baseline = pureBaseline;
      h.app.state.results = { kind: 'stale-market' };
      h.app.state.snapshot = makeSnapshot();
      h.app.state.temp = 0.8;
      h.app.state.calib = { s: 0.8 };
      h.app.state.calibDeltas = { arg: 20 };
      h.app.state.reachMarketsApplied = { r16: { arg: 0.8 }, champion: { arg: 0.6 } };
      h.app.state.blended = true;
      h.marketApi.fetchAll = async () => snapshot;
      h.app.simulate = () => {
        simulationCalls += 1;
        return simulation.promise;
      };

      const pending = h.app.refreshMarkets(true);
      await flushUntil(() => simulationCalls === 1, 'pure recompute should start');
      assert.equal(h.app.state.results, pureBaseline, 'stale market result is removed immediately');
      assert.equal(h.app.state.snapshot, null);
      assert.equal(h.app.state.temp, 1);
      assert.equal(h.app.state.blended, false);
      simulation.reject(new Error('synthetic pure-model failure'));
      await pending;

      assert.equal(h.app.state.results, pureBaseline, 'failed recompute cannot restore stale results');
      assert.equal(h.app.state.snapshot, null);
      assert.equal(h.app.state.blended, false);
    });
  }
});

test('unknown reach and per-match lifecycles never enter calibration or recompute', async () => {
  const h = createHarness(PRE_CUTOFF);
  const configs = [];
  let reachCalibrations = 0;
  const snapshot = makeSnapshot({
    reachLifecycle: { closed: null, active: null },
    matchLifecycle: { closed: false, active: null },
  });
  h.marketApi.fetchAll = async () => snapshot;
  h.app.calibrateChampionWorker = async () => ({ s: 0.8, deltas: { arg: 20 } });
  h.app.calibrateReachWorker = async () => {
    reachCalibrations += 1;
    return { s: 0.7, deltas: { arg: 30 } };
  };
  h.app.simulate = async (config) => {
    configs.push(config);
    return { kind: 'champion-only' };
  };

  await h.app.refreshMarkets(true);

  assert.equal(reachCalibrations, 0);
  assert.equal(configs.length, 1);
  assert.deepEqual(plain(configs[0].groupOverrides), {});
  assert.equal(configs[0].temperature, 0.8);
  assert.equal(configs[0].elo.arg, 2120);
  assert.equal(h.app.state.reachMarketsApplied, null);
});

test('every applied reach and per-match market is revalidated before results commit', async () => {
  const h = createHarness(PRE_CUTOFF);
  const snapshot = makeSnapshot();
  const reachMarkets = h.app.buildReachMarkets(snapshot, snapshot.champion.normalized);
  const marketSimulation = deferred();
  const configs = [];
  h.app.state.snapshot = snapshot;
  h.app.state.temp = 0.8;
  h.app.state.calibDeltas = { arg: 20 };
  h.app.state.reachMarketsApplied = reachMarkets;
  h.app.simulate = (config) => {
    configs.push(config);
    return configs.length === 1
      ? marketSimulation.promise
      : Promise.resolve({ kind: 'pure-fallback' });
  };

  const pending = h.app.recompute();
  assert.deepEqual(plain(configs[0].groupOverrides), {
    1: { pA: 0.5, pD: 0.25, pB: 0.25 },
  });
  snapshot.reachR16.closed = true;
  snapshot.perMatch[1].active = false;
  marketSimulation.resolve({ kind: 'stale-market' });
  await pending;

  assert.equal(configs.length, 2);
  assert.equal(configs[1].temperature, 1);
  assert.equal(configs[1].elo, null);
  assert.deepEqual(plain(configs[1].groupOverrides), {});
  assert.deepEqual(h.app.state.results, { kind: 'pure-fallback' });
  assert.equal(h.app.state.snapshot, null);
  assert.equal(h.app.state.reachMarketsApplied, null);
});

test('a cutoff between final validation and commit cannot restore a market result', async () => {
  const h = createHarness(PRE_CUTOFF);
  const snapshot = makeSnapshot();
  const reachMarkets = h.app.buildReachMarkets(snapshot, snapshot.champion.normalized);
  const marketSimulation = deferred();
  const configs = [];
  h.app.state.baseline = { kind: 'baseline' };
  h.app.state.results = { kind: 'previous-market' };
  h.app.state.snapshot = snapshot;
  h.app.state.temp = 0.8;
  h.app.state.calibDeltas = { arg: 20 };
  h.app.state.reachMarketsApplied = reachMarkets;
  h.app.simulate = (config) => {
    configs.push(config);
    return configs.length === 1
      ? marketSimulation.promise
      : Promise.resolve({ kind: 'pure-after-boundary' });
  };

  const pending = h.app.recompute();
  // The first sample lets appliedMarketInputsUsable() pass. The second lands
  // exactly at cutoff in the immediately-following pre-commit guard.
  h.clock.samples.push(PRE_CUTOFF, CUTOFF);
  marketSimulation.resolve({ kind: 'must-not-commit' });
  await pending;

  assert.equal(configs.length, 2);
  assert.equal(configs[1].temperature, 1);
  assert.equal(configs[1].elo, null);
  assert.deepEqual(plain(configs[1].groupOverrides), {});
  assert.deepEqual(h.app.state.results, { kind: 'pure-after-boundary' });
  assert.equal(h.app.state.archiveMode, true);
  assert.equal(h.app.state.snapshot, null);
});

test('unmount clears both lifecycle timers and invalidates pending market work', async () => {
  const h = createHarness(PRE_CUTOFF);
  let terminated = 0;
  h.app._archiveTimer = h.app._archiveTimer || 7001;
  h.timeouts.set(h.app._archiveTimer, { fn() {}, delay: 1000 });
  h.app._refreshTimer = 7002;
  h.intervals.set(7002, { fn() {}, delay: 300000 });
  h.app._onVisibilityChange = function () {};
  h.listeners.set('visibilitychange', h.app._onVisibilityChange);
  h.app.worker = { terminate() { terminated += 1; } };
  const epoch = h.app._marketEpoch;

  h.app.componentWillUnmount();

  assert.equal(h.timeouts.size, 0);
  assert.equal(h.intervals.size, 0);
  assert.equal(h.listeners.has('visibilitychange'), false);
  assert.equal(h.app._archiveTimer, null);
  assert.equal(h.app._refreshTimer, null);
  assert.equal(h.app._marketEpoch, epoch + 1);
  assert.equal(terminated, 1);
});

test('async market work resolving after unmount cannot set state or start new simulation', async (t) => {
  await t.test('queued fallback calibration', async () => {
    const h = createHarness(PRE_CUTOFF);
    let engineCalls = 0;
    let simulationCalls = 0;
    h.engineApi.calibrateChampion = () => {
      engineCalls += 1;
      return { s: 0.8, deltas: { arg: 20 } };
    };
    h.marketApi.fetchAll = async () => makeSnapshot({
      reachLifecycle: { closed: null, active: null },
    });
    h.app.simulate = async () => {
      simulationCalls += 1;
      return { kind: 'unexpected' };
    };

    const pending = h.app.refreshMarkets(true);
    await flushUntil(
      () => [...h.timeouts.values()].some((timer) => timer.delay === 0),
      'fallback calibration callback should be queued',
    );
    h.app.componentWillUnmount();
    const stateCallsAtUnmount = h.app.__setStateCalls;
    const calibrationTimerId = [...h.timeouts].find(([, timer]) => timer.delay === 0)[0];
    h.runTimeout(calibrationTimerId);
    await pending;

    assert.equal(engineCalls, 0);
    assert.equal(simulationCalls, 0);
    assert.equal(h.app.__setStateCalls, stateCallsAtUnmount);
  });

  await t.test('deferred recompute', async () => {
    const h = createHarness(PRE_CUTOFF);
    const simulation = deferred();
    const snapshot = makeSnapshot();
    let simulationCalls = 0;
    h.app.state.results = { kind: 'previous' };
    h.app.state.snapshot = snapshot;
    h.app.state.temp = 0.8;
    h.app.state.calibDeltas = { arg: 20 };
    h.app.simulate = () => {
      simulationCalls += 1;
      return simulation.promise;
    };

    const pending = h.app.recompute();
    h.app.componentWillUnmount();
    const stateCallsAtUnmount = h.app.__setStateCalls;
    simulation.resolve({ kind: 'late-market' });
    await pending;

    assert.equal(simulationCalls, 1);
    assert.equal(h.app.__setStateCalls, stateCallsAtUnmount);
    assert.deepEqual(h.app.state.results, { kind: 'previous' });
  });
});
