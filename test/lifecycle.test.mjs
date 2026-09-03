import assert from 'node:assert/strict';
import { test } from 'node:test';
import lifecycle from '../lifecycle.js';

const OPEN = {
  champion: {
    normalized: { esp: 0.2, arg: 0.18 },
    closed: false,
    active: true
  }
};

test('archive mode begins exactly at the UTC cutoff', () => {
  assert.equal(lifecycle.isArchiveMode('2026-07-19T23:59:59.999Z'), false);
  assert.equal(lifecycle.isArchiveMode('2026-07-20T00:00:00.000Z'), true);
  assert.equal(lifecycle.isArchiveMode('2026-09-03T00:00:00.000Z'), true);
});

test('market polling is disabled after the tournament cutoff', () => {
  assert.equal(lifecycle.shouldPollMarkets('2026-07-19T23:59:59.999Z'), true);
  assert.equal(lifecycle.shouldPollMarkets('2026-07-20T00:00:00.000Z'), false);
  assert.equal(lifecycle.shouldPollMarkets('not-a-date'), false);
});

test('settled or inactive champion markets are rejected', () => {
  assert.deepEqual(
    lifecycle.snapshotUsability({ champion: { ...OPEN.champion, closed: true } }),
    { usable: false, reason: 'settled-champion-market' }
  );
  assert.deepEqual(
    lifecycle.snapshotUsability({ champion: { ...OPEN.champion, active: false } }),
    { usable: false, reason: 'settled-champion-market' }
  );
});

test('missing or malformed lifecycle fields fail closed', () => {
  for (const champion of [
    { normalized: OPEN.champion.normalized },
    { normalized: OPEN.champion.normalized, closed: null, active: null },
    { normalized: OPEN.champion.normalized, closed: 'false', active: 'true' },
    { normalized: OPEN.champion.normalized, closed: false },
    { normalized: OPEN.champion.normalized, active: true },
  ]) {
    assert.deepEqual(
      lifecycle.snapshotUsability({ champion }),
      { usable: false, reason: 'unknown-champion-lifecycle' },
    );
  }
});

test('malformed champion probabilities fail closed', () => {
  for (const normalized of [
    { esp: Number.NaN },
    { esp: Number.POSITIVE_INFINITY },
    { esp: -0.1 },
    { esp: 1.1 },
    {},
  ]) {
    assert.equal(
      lifecycle.snapshotUsability({ champion: { ...OPEN.champion, normalized } }).usable,
      false,
    );
  }
});

test('reach and per-match inputs require explicit open lifecycle metadata', () => {
  const reach = { prices: { esp: 0.5 }, closed: false, active: true };
  assert.equal(lifecycle.marketRecordUsability(reach, 'prices').usable, true);
  assert.equal(lifecycle.marketRecordUsability({ ...reach, closed: true }, 'prices').usable, false);
  assert.equal(lifecycle.marketRecordUsability({ ...reach, active: null }, 'prices').usable, false);

  const match = {
    devigged: { pA: 0.4, pD: 0.3, pB: 0.3 },
    closed: false,
    active: true,
  };
  assert.equal(lifecycle.perMatchUsability(match).usable, true);
  assert.equal(lifecycle.perMatchUsability({ ...match, closed: true }).usable, false);
  assert.equal(lifecycle.perMatchUsability({ ...match, active: undefined }).usable, false);
});

test('only an open snapshot before the cutoff can drive calibration', () => {
  assert.equal(lifecycle.shouldUseMarketSnapshot(OPEN, '2026-06-20T00:00:00.000Z'), true);
  assert.equal(lifecycle.shouldUseMarketSnapshot(OPEN, '2026-07-20T00:00:00.000Z'), false);
  assert.equal(lifecycle.shouldUseMarketSnapshot(null, '2026-06-20T00:00:00.000Z'), false);
});

test('archive mode makes zero calls to the market fetcher', async () => {
  let calls = 0;
  const result = await lifecycle.loadUsableMarketSnapshot(
    async () => { calls += 1; return OPEN; },
    () => Date.parse('2026-07-20T00:00:00.000Z'),
  );

  assert.equal(calls, 0);
  assert.deepEqual(result, { usable: false, reason: 'archive-cutoff', snapshot: null });
});

test('crossing the cutoff between the two synchronous guards makes zero fetches', async () => {
  const clock = [
    Date.parse('2026-07-19T23:59:59.999Z'),
    Date.parse('2026-07-20T00:00:00.000Z'),
  ];
  let calls = 0;
  const result = await lifecycle.loadUsableMarketSnapshot(
    async () => { calls += 1; return OPEN; },
    () => clock.shift(),
  );

  assert.equal(calls, 0);
  assert.deepEqual(result, { usable: false, reason: 'archive-cutoff', snapshot: null });
});

test('a snapshot settling while an async fetch is in flight cannot calibrate', async () => {
  const clock = [
    Date.parse('2026-07-19T23:59:59.999Z'),
    Date.parse('2026-07-19T23:59:59.999Z'),
    Date.parse('2026-07-20T00:00:00.000Z'),
  ];
  let calls = 0;
  const result = await lifecycle.loadUsableMarketSnapshot(
    async () => { calls += 1; return OPEN; },
    () => clock.shift(),
  );

  assert.equal(calls, 1);
  assert.deepEqual(result, { usable: false, reason: 'archive-cutoff', snapshot: null });
});

test('settled snapshots return no calibration payload', async () => {
  const settled = { champion: { ...OPEN.champion, closed: true } };
  const result = await lifecycle.loadUsableMarketSnapshot(
    async () => settled,
    () => Date.parse('2026-06-20T00:00:00.000Z'),
  );

  assert.deepEqual(result, {
    usable: false,
    reason: 'settled-champion-market',
    snapshot: null,
  });
});
