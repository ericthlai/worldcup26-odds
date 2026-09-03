/* Coverage test for WC.GM (group-stage fixture completeness).
 * Guards against the data-completeness gap fixed in this PR: WC.GM used to
 * list only the 52 US-hosted group matches, so hostAdvFor()/buildLockedResults
 * silently no-op'd for Mexico and Canada's own group games (see README "Known
 * limitations" history / code-review findings C1-C2).
 * Run: node test/fixtures.test.mjs
 * Loads the CommonJS data module the same way test/engine.test.mjs does. */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const WC = require(path.join(__dirname, '..', 'data.js'));

let failures = 0;
function check(name, cond, detail) {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}  ${detail || ''}`);
}

// Mirrors engine.js's hostAdvFor(team, venue) exactly (that function isn't
// exported on WCEngine, and this test must not modify engine.js).
function hostAdvFor(team, venue) {
  var hostCountry = WC.VENMATCH[venue];
  if (!hostCountry) return 0;
  return WC.HOST_TEAM[hostCountry] === team ? 100 : 0;
}

// ---- 1. exactly 72 group matches -----------------------------------------
check('WC.GM has exactly 72 group matches', WC.GM.length === 72, `got ${WC.GM.length}`);

// ---- 2. each of the 48 teams appears in exactly 3 group matches ----------
const teamCount = {};
Object.keys(WC.TEAMS).forEach(t => { teamCount[t] = 0; });
WC.GM.forEach(m => { teamCount[m[3]] = (teamCount[m[3]] || 0) + 1; teamCount[m[4]] = (teamCount[m[4]] || 0) + 1; });
const badTeamCounts = Object.keys(WC.TEAMS).filter(t => teamCount[t] !== 3);
check('every one of the 48 teams appears in exactly 3 group matches',
  badTeamCounts.length === 0,
  badTeamCounts.length ? badTeamCounts.map(t => `${t}=${teamCount[t]}`).join(', ') : 'ok');

// ---- 3. each group has exactly 6 matches ----------------------------------
const groupCount = {};
Object.keys(WC.GROUPS).forEach(g => { groupCount[g] = 0; });
WC.GM.forEach(m => { groupCount[m[2]] = (groupCount[m[2]] || 0) + 1; });
const badGroupCounts = Object.keys(WC.GROUPS).filter(g => groupCount[g] !== 6);
check('every one of the 12 groups has exactly 6 matches',
  badGroupCounts.length === 0,
  badGroupCounts.length ? badGroupCounts.map(g => `${g}=${groupCount[g]}`).join(', ') : 'ok');

// ---- 4. match numbers are unique ------------------------------------------
const nums = WC.GM.map(m => m[0]);
const dups = nums.filter((n, i) => nums.indexOf(n) !== i);
check('match numbers (WC.GM[i][0]) are unique', dups.length === 0,
  dups.length ? `duplicates: ${[...new Set(dups)].join(', ')}` : 'ok');

// ---- 5. every match has a resolvable host country -------------------------
const unresolved = WC.GM.filter(m => !WC.VENMATCH[m[5]]);
check('every match\'s venue resolves to a host country via WC.VENMATCH',
  unresolved.length === 0,
  unresolved.length ? `no host country for match(es): ${unresolved.map(m => m[0]).join(', ')}` : 'ok');

// ---- 6. hostAdvFor fires for at least one Mexico match and one Canada match
const mexHostMatches = WC.GM.filter(m => hostAdvFor(m[3], m[5]) === 100 || hostAdvFor(m[4], m[5]) === 100)
  .filter(m => (m[3] === 'mex' && hostAdvFor(m[3], m[5]) === 100) || (m[4] === 'mex' && hostAdvFor(m[4], m[5]) === 100));
const canHostMatches = WC.GM.filter(m => (m[3] === 'can' && hostAdvFor(m[3], m[5]) === 100) || (m[4] === 'can' && hostAdvFor(m[4], m[5]) === 100));
check('hostAdvFor resolves a +100 advantage for at least one Mexico group match',
  mexHostMatches.length > 0, `${mexHostMatches.length} match(es): ${mexHostMatches.map(m => m[0]).join(', ')}`);
check('hostAdvFor resolves a +100 advantage for at least one Canada group match',
  canHostMatches.length > 0, `${canHostMatches.length} match(es): ${canHostMatches.map(m => m[0]).join(', ')}`);

console.log(`\n=== ${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'} ===`);
process.exit(failures === 0 ? 0 : 1);
