import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import lifecycle from '../lifecycle.js';

const source = await readFile(new URL('../markets.js', import.meta.url), 'utf8');

function loadMarkets(fields) {
  const sandbox = {
    console,
    Date,
    Promise,
    encodeURIComponent,
  };
  sandbox.window = sandbox;
  sandbox.fetch = async (url) => {
    const events = [];
    if (url.includes('slug=world-cup-winner')) {
      events.push({
        slug: 'world-cup-winner',
        ...fields,
        markets: [
          { groupItemTitle: 'Spain', outcomePrices: '["0.55","0.45"]' },
          { groupItemTitle: 'Argentina', outcomePrices: '["0.45","0.55"]' },
        ],
      });
    }
    if (url.includes('slug=world-cup-nation-to-reach-round-of-16')) {
      events.push({
        slug: 'world-cup-nation-to-reach-round-of-16',
        ...fields,
        // Keep the basket large enough that sum-to-16 normalization cannot
        // create impossible (>1) individual probabilities in this fixture.
        markets: [
          'Spain', 'Argentina', 'France', 'England', 'Brazil', 'Portugal',
          'Germany', 'Netherlands', 'Belgium', 'Croatia', 'Uruguay', 'Colombia',
          'United States', 'Mexico', 'Canada', 'Japan', 'Morocco', 'Senegal',
        ].map((name) => ({ groupItemTitle: name, outcomePrices: '["0.6","0.4"]' })),
      });
    }
    if (url.includes('slug=fifwc-usa-par-2026-06-12')) {
      events.push({
        slug: 'fifwc-usa-par-2026-06-12',
        title: 'United States vs. Paraguay',
        ...fields,
        markets: [
          { groupItemTitle: 'United States', outcomePrices: '["0.4","0.6"]' },
          { groupItemTitle: 'Draw', outcomePrices: '["0.3","0.7"]' },
          { groupItemTitle: 'Paraguay', outcomePrices: '["0.3","0.7"]' },
        ],
      });
    }
    return { ok: true, json: async () => events };
  };

  vm.runInContext(source, vm.createContext(sandbox), { filename: 'markets.js' });
  return sandbox.WCMarkets;
}

test('actual market adapter preserves missing lifecycle fields as unknown', async () => {
  const snapshot = await loadMarkets({}).fetchAll({ force: true });

  assert.equal(snapshot.champion.closed, null);
  assert.equal(snapshot.champion.active, null);
  assert.equal(snapshot.reachR16.closed, null);
  assert.equal(snapshot.reachR16.active, null);
  assert.equal(snapshot.perMatch[4].closed, null);
  assert.equal(snapshot.perMatch[4].active, null);
  assert.equal(lifecycle.snapshotUsability(snapshot).usable, false);
  assert.equal(lifecycle.marketRecordUsability(snapshot.reachR16, 'prices').usable, false);
  assert.equal(lifecycle.perMatchUsability(snapshot.perMatch[4]).usable, false);
});

test('string lifecycle fields are not coerced into trusted booleans', async () => {
  const snapshot = await loadMarkets({ closed: 'false', active: 'true' }).fetchAll({ force: true });

  assert.equal(snapshot.champion.closed, null);
  assert.equal(snapshot.champion.active, null);
  assert.equal(snapshot.reachR16.closed, null);
  assert.equal(snapshot.reachR16.active, null);
  assert.equal(snapshot.perMatch[4].closed, null);
  assert.equal(snapshot.perMatch[4].active, null);
});

test('explicit open booleans remain usable across applied market families', async () => {
  const snapshot = await loadMarkets({ closed: false, active: true }).fetchAll({ force: true });

  assert.equal(lifecycle.snapshotUsability(snapshot).usable, true);
  assert.equal(lifecycle.marketRecordUsability(snapshot.reachR16, 'prices').usable, true);
  assert.equal(lifecycle.perMatchUsability(snapshot.perMatch[4]).usable, true);
});
