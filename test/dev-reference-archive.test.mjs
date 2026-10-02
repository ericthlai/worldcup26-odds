import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// dev/reference-prediction-app.html is a provenance copy of the sister app.
// It must not poll Polymarket after the archive cutoff (see lifecycle.js).

const HTML = readFileSync(new URL('../dev/reference-prediction-app.html', import.meta.url), 'utf8');
const scripts = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);

function run(nowIso) {
  assert.equal(scripts.length, 1, 'expected exactly one inline <script> block');
  const fetched = [];
  class FixedDate extends Date {
    static now() { return Date.parse(nowIso); }
  }
  function Component() {}
  Component.prototype.setState = function (patch) { Object.assign(this.state, patch); };
  const sandbox = {
    Date: FixedDate, console,
    preact: { h() {}, render() {}, Component, createRef: () => ({}) },
    htm: { bind: () => () => null },
    localStorage: { getItem: () => null, setItem() {} },
    document: { getElementById: () => ({}) },
    fetch: url => { fetched.push(String(url)); return Promise.resolve({ json: () => Promise.resolve([]) }); },
    setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {}
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(scripts[0] + '\n;globalThis.__App = App;', context);
  const app = new sandbox.__App({});
  return { app, fetched };
}

async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

for (const now of ['2026-07-20T00:00:00Z', '2026-10-01T00:00:00Z']) {
  test('reference app makes no market requests at ' + now, async () => {
    const { app, fetched } = run(now);
    app.componentDidMount();
    await app.fetchOdds();
    await settle();
    assert.deepEqual(fetched, []);
  });
}

test('reference app still targets only the Gamma API before the cutoff', async () => {
  const { app, fetched } = run('2026-07-19T23:59:59Z');
  await app.fetchOdds();
  await settle();
  assert.ok(fetched.length > 0);
  for (const url of fetched) assert.ok(url.startsWith('https://gamma-api.polymarket.com/'), url);
});
