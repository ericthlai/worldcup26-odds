import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Engine = require('../engine.js');

// Group tiebreakers follow FIFA World Cup 26 Regulations, Article 13:
// points, then head-to-head points/GD/GF among the tied teams (reapplied to
// teams still level), then overall GD and GF. Elo stands in for the team
// conduct score and FIFA ranking, which the engine does not model.

const TEAMS = ['a', 'b', 'c', 'd'];
const ELO = { a: 1500, b: 1600, c: 1700, d: 1800 };
const m = (a, b, ga, gb) => ({ a, b, ga, gb });

test('head-to-head beats a better overall goal difference', () => {
  // A and B both finish on 4 points; A beat B 1-0 but B has the better GD.
  const results = [
    m('a', 'b', 1, 0), m('a', 'c', 0, 3), m('a', 'd', 1, 1),
    m('b', 'c', 1, 1), m('b', 'd', 5, 0), m('c', 'd', 2, 0)
  ];
  assert.deepEqual(Engine.rankGroup(TEAMS, results, null, ELO), ['c', 'a', 'b', 'd']);
});

test('head-to-head is reapplied to the teams still level', () => {
  // A, B, C are level on 6 points and form a cycle with identical head-to-head
  // points; A is last on head-to-head GD, while B and C are level on all three
  // head-to-head criteria. Their own match (B won 2-0) then decides it, even
  // though C has the better overall goal difference.
  const results = [
    m('a', 'b', 2, 1), m('b', 'c', 2, 0), m('c', 'a', 3, 0),
    m('a', 'd', 1, 0), m('b', 'd', 1, 0), m('c', 'd', 5, 0)
  ];
  assert.deepEqual(Engine.rankGroup(TEAMS, results, null, ELO), ['b', 'c', 'a', 'd']);
});

test('a perfect head-to-head cycle falls through to overall goal difference', () => {
  const results = [
    m('a', 'b', 1, 0), m('b', 'c', 1, 0), m('c', 'a', 1, 0),
    m('a', 'd', 3, 0), m('b', 'd', 2, 0), m('c', 'd', 1, 0)
  ];
  assert.deepEqual(Engine.rankGroup(TEAMS, results, null, ELO), ['a', 'b', 'c', 'd']);
});

test('overall goals scored break an equal overall goal difference', () => {
  const results = [
    m('a', 'b', 1, 0), m('b', 'c', 1, 0), m('c', 'a', 1, 0),
    m('a', 'd', 4, 1), m('b', 'd', 3, 0), m('c', 'd', 2, 0)
  ];
  // A and B both +3 overall; A scored 5, B scored 4. C is +2.
  assert.deepEqual(Engine.rankGroup(TEAMS, results, null, ELO), ['a', 'b', 'c', 'd']);
});

test('a group of 0-0 draws falls through to Elo', () => {
  const results = [
    m('a', 'b', 0, 0), m('a', 'c', 0, 0), m('a', 'd', 0, 0),
    m('b', 'c', 0, 0), m('b', 'd', 0, 0), m('c', 'd', 0, 0)
  ];
  assert.deepEqual(Engine.rankGroup(TEAMS, results, null, ELO), ['d', 'c', 'b', 'a']);
});

test('random groups: ranking is a permutation, non-increasing in points', () => {
  const rnd = Engine.mulberry32(20260701);
  for (let run = 0; run < 2000; run++) {
    const results = [];
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        results.push(m(TEAMS[i], TEAMS[j], Math.floor(rnd() * 4), Math.floor(rnd() * 4)));
      }
    }
    const pts = {};
    TEAMS.forEach((t) => { pts[t] = 0; });
    results.forEach((r) => {
      if (r.ga > r.gb) pts[r.a] += 3;
      else if (r.ga < r.gb) pts[r.b] += 3;
      else { pts[r.a] += 1; pts[r.b] += 1; }
    });
    const ranked = Engine.rankGroup(TEAMS, results, null, ELO);
    assert.deepEqual(ranked.slice().sort(), TEAMS);
    for (let k = 1; k < ranked.length; k++) {
      assert.ok(pts[ranked[k - 1]] >= pts[ranked[k]]);
    }
  }
});
