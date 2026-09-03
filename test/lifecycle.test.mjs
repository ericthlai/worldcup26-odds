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

test('a snapshot settling while an async fetch is in flight cannot calibrate', async () => {
  const clock = [
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
