import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function harness() {
  const callbacks = [];
  const engine = {};
  function Component() {}
  Component.prototype.setState = function (patch) { Object.assign(this.state, patch); };
  class Worker {
    postMessage() {}
    terminate() { this.terminated = true; }
  }
  class BeforeCutoffDate extends Date {
    static now() { return Date.parse('2026-07-01T00:00:00Z'); }
  }
  const sandbox = {
    Date: BeforeCutoffDate, console, Worker,
    preact: { Component, h() {}, render() {} },
    htm: { bind: () => () => null },
    localStorage: { getItem: () => null },
    document: { getElementById: () => ({}) },
    setTimeout: fn => callbacks.push(fn), clearTimeout() {}, clearInterval() {},
    WC: { TEAMS: {}, GROUPS: {}, KO: [], ELO: {}, VEN: {} },
    WCEngine: engine, WCMarkets: {}, __WCO_TEST__: {}
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  for (const file of ['lifecycle.js', 'app.js']) {
    vm.runInContext(readFileSync(new URL('../' + file, import.meta.url), 'utf8'), context);
  }
  return { app: new sandbox.__WCO_TEST__.App(), engine, callbacks };
}

function observe(promise) {
  const result = { state: 'pending' };
  promise.then(value => Object.assign(result, { state: 'resolved', value }),
    error => Object.assign(result, { state: 'rejected', error }));
  return result;
}

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

for (const failure of ['runtime', 'startup']) {
  test(failure + ' worker failure rejects all waiting jobs and permits fallback', async () => {
    const { app, engine, callbacks } = harness();
    app.bootWorker();
    const worker = app.worker;
    const first = observe(app.simulate({}));
    const second = observe(app.calibrateChampionWorker({}, {}));
    if (failure === 'runtime') worker.onerror({ message: 'worker failed' });
    else worker.onmessage({ data: { id: null, type: 'error', message: 'importScripts failed' } });
    await flush();
    assert.equal(first.state, 'rejected');
    assert.equal(second.state, 'rejected');
    assert.equal(Object.keys(app._pending).length, 0);
    assert.equal(worker.terminated, true);
    assert.equal(app.worker, null);
    engine.simulate = () => ({ recovered: true });
    const recovered = observe(app.simulate({}));
    callbacks.shift()();
    await flush();
    assert.equal(recovered.value.recovered, true);
  });
}

test('a job error rejects only that job', async () => {
  const { app } = harness();
  app.bootWorker();
  const first = observe(app.simulate({}));
  const second = observe(app.simulate({}));
  app.worker.onmessage({ data: { id: 1, type: 'error', message: 'invalid input' } });
  app.worker.onmessage({ data: { id: 2, type: 'result', results: { ok: true } } });
  await flush();
  assert.equal(first.state, 'rejected');
  assert.equal(second.value.ok, true);
  assert.equal(Object.keys(app._pending).length, 0);
});

for (const [method, engineMethod] of [
  ['simulate', 'simulate'], ['calibrateWorker', 'calibrate'],
  ['calibrateChampionWorker', 'calibrateChampion'], ['calibrateReachWorker', 'calibrateReach']
]) {
  test(method + ': synchronous postMessage errors do not leak pending jobs', async () => {
    const { app } = harness();
    app.bootWorker();
    app.worker.postMessage = () => { throw new Error('cannot clone'); };
    const result = observe(app[method]({}, {}));
    await flush();
    assert.equal(result.state, 'rejected');
    assert.equal(Object.keys(app._pending).length, 0);
  });

  test(method + ': fallback engine exceptions reject instead of escaping the timer', async () => {
    const { app, engine, callbacks } = harness();
    engine[engineMethod] = () => { throw new Error('invalid engine input'); };
    const result = observe(app[method]({}, {}));
    assert.doesNotThrow(() => callbacks.shift()());
    await flush();
    assert.equal(result.state, 'rejected');
    assert.equal(result.error.message, 'invalid engine input');
  });
}

test('unmount rejects outstanding worker requests without later state writes', async () => {
  const { app } = harness();
  app.bootWorker();
  const pending = observe(app.simulate({}));
  app.componentWillUnmount();
  app.setState = () => { throw new Error('state write after unmount'); };
  await flush();
  assert.equal(pending.state, 'rejected');
  assert.equal(Object.keys(app._pending).length, 0);
  assert.equal(app.worker, null);
});

test('recompute failures stop loading, retain previous results, and recover', async () => {
  const { app } = harness();
  const previous = { previous: true };
  app.state.results = previous;
  app.simulate = () => Promise.reject(new Error('simulation unavailable'));
  assert.equal(await app.recompute(), null);
  assert.equal(app.state.recomputing, false);
  assert.equal(app.state.results, previous);
  assert.equal(app.state.workerErr, 'simulation unavailable');
  const recovered = { recovered: true };
  app.simulate = () => Promise.resolve(recovered);
  assert.equal(await app.recompute(), recovered);
  assert.equal(app.state.workerErr, null);
});

test('a queued fallback simulation does not start after unmount', async () => {
  const { app, engine, callbacks } = harness();
  engine.simulate = () => { throw new Error('should not execute'); };
  const result = observe(app.simulate({}));
  app.componentWillUnmount();
  callbacks.shift()();
  await flush();
  assert.equal(result.state, 'rejected');
  assert.equal(result.error.message, 'App unmounted');
});
