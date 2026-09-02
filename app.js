/* ============================================================================
 * app.js — WorldcupOdds front-end (Preact + htm, no build step).
 *
 * PURPOSE: see WHICH teams might play WHERE and WHEN, with probabilities, so
 * the user can decide which tickets to buy — and watch it move live as
 * results / markets shift.
 *
 * Pipeline on load:
 *   1. sim baseline (ELO, temperature 1) via the Web Worker  → instant skeleton
 *   2. markets.fetchAll()  → live Polymarket marginals
 *   3. calibrate to the champion market in TWO stages: a global temperature
 *      pre-step, then a per-team Elo rake so the sim champion vector can match
 *      (and reorder to) the market — a single scalar temperature alone cannot
 *      reorder teams away from the Elo ranking.
 *   4. re-simulate with calibrated temperature + per-team Elo deltas + group
 *      W/D/L overrides (de-vigged per-match market) + what-if locked results.
 *   5. status bar: model ⊕ market blend, last update, auto-refresh every 5 min
 *   Any what-if change (lock group winner / match result) → recompute.
 *
 * NOTE on stage marginals: the champion market drives calibration (temp + rake).
 * The reach-stage markets (reachR16/QF/SF/Final) and the to-advance/R32 basket
 * are fetched and shown SIDE-BY-SIDE with the model in the stage table for
 * comparison, but are NOT raked into the sim. (A per-stage IPF pass toward the
 * well-calibrated R32/to-advance basket, with per-team stage monotonicity, is a
 * possible future enhancement — the champion rake already pulls each team's
 * earlier-stage reach in the right direction via the funnel.)
 *
 * Reads window.WC (data.js), window.WCEngine (engine.js, also runs in worker),
 * window.WCMarkets (markets.js). Worker = sim.worker.js.
 * ==========================================================================*/
(function () {
'use strict';

var h = preact.h, render = preact.render, Component = preact.Component;
var html = htm.bind(h);
var WC = window.WC, ENG = window.WCEngine, MK = window.WCMarkets;

/* ---------------- i18n ---------------------------------------------------- */
var I18N = {
  zh: {
    tagline: '哪些球队 · 在哪 · 什么时候碰面 — 实时概率帮你挑票',
    sub: '模型 ⊕ Polymarket · 自动更新',
    window: 'JUN 11 — JUL 19',
    tabs: { radar: '明星对阵', venue: '场馆/日期', path: '球队路径', table: '阶段概率' },
    tabsSub: { radar: '谁会碰面', venue: '哪场好看', path: '能走多远', table: '全队对比' },
    simming: '模拟中…',
    statusModel: '纯模型 (ELO)',
    statusBlend: '模型 ⊕ Polymarket',
    statusCalib: '已校准 · 温度',
    updated: '更新于',
    refreshing: '刷新行情中…',
    refresh: '刷新',
    live: '实时',
    runs: '次模拟',
    // radar
    radarTitle: '明星对阵雷达',
    radarIntro: '选两支球队(或两位球星),看他们在淘汰赛碰面的概率 — 以及每一种可能的碰面:轮次、场馆、城市、日期与概率。最可能的一场,就是最值得买的票。',
    pickMode: '选择方式',
    byTeam: '按球队',
    byStar: '按球星',
    teamA: '球队 A', teamB: '球队 B',
    starA: '球星 A', starB: '球星 B',
    pickPlaceholder: '— 选择 —',
    meetProb: '碰面概率(任意淘汰赛)',
    sameGroup: '同组提示',
    sameGroupNote: '两队同在一组,小组赛必碰;此处只算淘汰赛再相遇。',
    noMeet: '在当前模型下,这两队几乎不会在淘汰赛相遇(< 0.1%)。',
    everyMeeting: '所有可能的碰面',
    bestTicket: '🎟️ 最值得买的票',
    round: '轮次', venueCol: '场馆 / 城市', dateCol: '日期', probCol: '概率',
    pickTwo: '请在上方选择两支球队 / 两位球星。',
    samePick: '请选择两支不同的球队。',
    // venue
    venueTitle: '场馆 / 日期浏览器',
    venueIntro: '挑一场淘汰赛(按场馆 + 日期),看最可能在那里上演的对阵、明星指数,以及每支热门球队现身的概率。买票前先看看哪场最有看头。',
    pickMatch: '选择淘汰赛',
    starPower: '明星指数',
    starPowerNote: '= 预计现身的明星分之和(STARS 加权)',
    likelyPairs: '最可能的对阵',
    marqueeApp: '热门球队现身概率',
    appProb: '现身概率',
    vs: '对',
    // path
    pathTitle: '球队晋级路径',
    pathIntro: '选一支球队,看它一轮一轮最可能的对手、场馆、日期,以及打进各阶段(32/16/8/4 强、决赛、夺冠)的概率。',
    pickTeam: '选择球队',
    funnel: '晋级漏斗',
    roundByRound: '逐轮路径',
    likelyOpp: '最可能对手',
    likelyVenue: '最可能场馆 · 日期',
    reachProb: '打进概率',
    noPath: '请在上方选择一支球队。',
    champion: '夺冠',
    // table
    tableTitle: '全队阶段概率表',
    tableIntro: '48 支球队 × 各阶段概率。点表头排序。可切换「模型」与「Polymarket 行情」并排对照。',
    showModel: '模型',
    showMarket: 'Polymarket',
    showBoth: '并排',
    teamCol: '球队',
    // whatif
    whatifTitle: '情景假设 (What-if)',
    whatifIntro: '锁定一个小组头名,或锁定一场已结束比赛的胜方,然后看概率怎么变。',
    lockGroupWinner: '锁定小组头名',
    lockMatch: '锁定比赛结果',
    noGroup: '— 不锁定 —',
    clearAll: '清空所有假设',
    delta: '相对基线变化',
    recomputing: '重新计算中…',
    activeWhatif: '当前假设',
    // stages
    st: { r32: '32 强', r16: '16 强', qf: '8 强', sf: '4 强', final: '决赛', champion: '夺冠' },
    footer: '模型校准至 Polymarket,仅供娱乐;以 FIFA 官方为准 · 行情来自 Polymarket · 概率为模型推演',
    lang: 'EN',
    // goal hint banner
    goalHint: '想知道买哪张票?选两支球队 → 看「最值得买的票」→ 一键跳到场馆浏览器。',
    goalHintRadar: '明星对阵',
    goalHintVenue: '场馆浏览器',
    dismiss: '知道了',
    // cross-links + CTA
    scoutInVenue: '在场馆浏览器查看这场',
    seeInRadar: '在雷达里看这组对决',
    openInPath: '看这支球队的路径',
    // marquee
    nowPlaying: '热门对决',
    tryMarquee: '梅西 vs C罗',
    // pickers / sheet
    searchPlaceholder: '搜索球队…',
    searchStarPlaceholder: '搜索球星…',
    allGroups: '全部',
    groupSuffix: '组',
    natTeam: '国家队',
    closeSheet: '关闭',
    pickATeam: '点击选择球队',
    pickAStar: '点击选择球星',
    // venue location-first
    byCity: '按城市',
    byDate: '按日期',
    allRounds: '全部轮次',
    matchesHere: '场',
    regionW: '西区', regionE: '东区', regionC: '中区',
    sortByStar: '按明星指数',
    // info popovers
    meetInfo: '这是模型推演两队在淘汰赛(16/8/4 强、决赛)相遇的概率,综合 20000 次模拟并校准到 Polymarket 行情。同组球队的小组赛相遇不计入。',
    tempInfo: '温度 = 模型对行情的信任程度。温度越低,越贴近 Polymarket;越高,越接近原始 ELO 模型。',
    // loading / empty
    simmingShort: '模拟计算中…',
    tooEarly: '这场比赛的对阵还太早,无法预测具体球队 — 试试更靠后的轮次。',
    // what-if
    whatifSubGeneric: '锁定一个结果,看概率实时变化 — 例如锁阿根廷小组头名'
  },
  en: {
    tagline: 'Which teams · where · when they meet — live odds to pick your tickets',
    sub: 'Model ⊕ Polymarket · auto-updating',
    window: 'JUN 11 — JUL 19',
    tabs: { radar: 'Star Radar', venue: 'Venue/Date', path: 'Team Path', table: 'Stage Odds' },
    tabsSub: { radar: 'who meets', venue: 'best match', path: 'how far', table: 'compare all' },
    simming: 'Simulating…',
    statusModel: 'Model only (ELO)',
    statusBlend: 'Model ⊕ Polymarket',
    statusCalib: 'Calibrated · temp',
    updated: 'Updated',
    refreshing: 'Refreshing odds…',
    refresh: 'Refresh',
    live: 'live',
    runs: 'runs',
    radarTitle: 'Star Matchup Radar',
    radarIntro: 'Pick two teams (or two stars) and see the probability they meet in the knockouts — plus every possible meeting: round, venue, city, date and the odds. The single most likely one is the ticket worth buying.',
    pickMode: 'Pick by',
    byTeam: 'Team',
    byStar: 'Star',
    teamA: 'Team A', teamB: 'Team B',
    starA: 'Star A', starB: 'Star B',
    pickPlaceholder: '— choose —',
    meetProb: 'P(meet in any knockout)',
    sameGroup: 'Same group',
    sameGroupNote: 'These two share a group, so they meet in the group stage; this only counts a knockout rematch.',
    noMeet: 'Under the current model these two almost never meet in the knockouts (< 0.1%).',
    everyMeeting: 'Every possible meeting',
    bestTicket: '🎟️ Best ticket to buy',
    round: 'Round', venueCol: 'Venue / City', dateCol: 'Date', probCol: 'Prob',
    pickTwo: 'Pick two teams / stars above.',
    samePick: 'Pick two different teams.',
    venueTitle: 'Venue / Date Browser',
    venueIntro: 'Pick a knockout match (by venue + date) to see the most likely matchups there, a star-power score, and how likely each marquee team is to appear. Scout the best ticket before you buy.',
    pickMatch: 'Pick a knockout',
    starPower: 'Star power',
    starPowerNote: '= sum of STARS expected to appear',
    likelyPairs: 'Most likely matchups',
    marqueeApp: 'Marquee team appearance',
    appProb: 'Appears',
    vs: 'vs',
    pathTitle: 'Team Path Explorer',
    pathIntro: 'Pick a team to see its round-by-round most likely opponents, venues and dates, plus the probability of reaching each stage (R32/R16/QF/SF/Final/Champion).',
    pickTeam: 'Pick a team',
    funnel: 'Advancement funnel',
    roundByRound: 'Round by round',
    likelyOpp: 'Most likely opponent',
    likelyVenue: 'Most likely venue · date',
    reachProb: 'Reach',
    noPath: 'Pick a team above.',
    champion: 'Champion',
    tableTitle: 'Stage Probability Table',
    tableIntro: '48 teams × stage probabilities. Click a header to sort. Toggle model vs Polymarket marginals side by side.',
    showModel: 'Model',
    showMarket: 'Polymarket',
    showBoth: 'Both',
    teamCol: 'Team',
    whatifTitle: 'What-if',
    whatifIntro: 'Lock a group winner, or lock the winner of a finished match, then watch the probabilities move.',
    lockGroupWinner: 'Lock a group winner',
    lockMatch: 'Lock a match result',
    noGroup: '— none —',
    clearAll: 'Clear all',
    delta: 'Δ vs baseline',
    recomputing: 'Recomputing…',
    activeWhatif: 'Active assumptions',
    st: { r32: 'R32', r16: 'R16', qf: 'QF', sf: 'SF', final: 'Final', champion: 'Champion' },
    footer: 'Model calibrated to Polymarket · for fun only; FIFA is authoritative · odds from Polymarket · probabilities are model output',
    lang: '中文',
    goalHint: 'Want to know which ticket to buy? Pick two teams → see the Best ticket → jump to the Venue browser.',
    goalHintRadar: 'Star Radar',
    goalHintVenue: 'Venue browser',
    dismiss: 'Got it',
    scoutInVenue: 'Scout this match in the Venue browser',
    seeInRadar: 'See this duel in the radar',
    openInPath: 'Open this team’s path',
    nowPlaying: 'Now playing',
    tryMarquee: 'Messi vs Ronaldo',
    searchPlaceholder: 'Search teams…',
    searchStarPlaceholder: 'Search stars…',
    allGroups: 'All',
    groupSuffix: '',
    natTeam: 'national team',
    closeSheet: 'Close',
    pickATeam: 'Tap to pick a team',
    pickAStar: 'Tap to pick a star',
    byCity: 'By city',
    byDate: 'By date',
    allRounds: 'All rounds',
    matchesHere: 'matches',
    regionW: 'West', regionE: 'East', regionC: 'Central',
    sortByStar: 'By star power',
    meetInfo: 'The model’s probability the two meet in a knockout (R16/QF/SF/Final), from 20,000 simulations calibrated to Polymarket. A group-stage meeting between same-group teams is not counted.',
    tempInfo: 'Temperature = how much the model trusts the market vs the raw ELO. Lower hugs Polymarket; higher leans on raw ELO.',
    simmingShort: 'Simulating…',
    tooEarly: 'Too early to predict specific teams for this match — try a later round.',
    whatifSubGeneric: 'Lock a result and watch the odds move live — e.g. lock Argentina to win its group'
  }
};

/* ---------------- marquee stars -> team code -----------------------------
 * The brief wants "Messi vs Ronaldo" pickable. A star resolves to its team;
 * the simulation is team-level, so two stars meet exactly when their teams do.
 * Order roughly by STARS tier then fame. */
var STARS_PLAYERS = [
  ['梅西 Messi', 'Messi', 'arg'], ['C罗 Ronaldo', 'Ronaldo', 'por'],
  ['姆巴佩 Mbappé', 'Mbappé', 'fra'], ['亚马尔 Yamal', 'Yamal', 'esp'],
  ['哈兰德 Haaland', 'Haaland', 'nor'], ['贝林厄姆 Bellingham', 'Bellingham', 'eng'],
  ['维尼修斯 Vinícius', 'Vinícius', 'bra'], ['凯恩 Kane', 'Kane', 'eng'],
  ['德布劳内 De Bruyne', 'De Bruyne', 'bel'], ['范戴克 Van Dijk', 'Van Dijk', 'ned'],
  ['穆西亚拉 Musiala', 'Musiala', 'ger'], ['莫德里奇 Modrić', 'Modrić', 'cro'],
  ['普利西奇 Pulisic', 'Pulisic', 'usa'], ['哈基米 Hakimi', 'Hakimi', 'mar'],
  ['奥纳纳 / 三笘 Mitoma', 'Mitoma', 'jpn'], ['努涅斯 Núñez', 'Núñez', 'uru'],
  ['迪亚斯 L. Díaz', 'L. Díaz', 'col'], ['马内 / 凯塔', 'Mané', 'sen'],
  ['劳塔罗 Lautaro', 'Lautaro', 'arg'], ['菲利克斯 Félix', 'Félix', 'por']
];

/* Marquee star duels for the radar quick-pick rail (indices into STARS_PLAYERS).
 * First entry is the KEY DEMO Messi(arg) × Ronaldo(por). All teams differ within
 * a pair so the meet-prob is meaningful. */
var MARQUEE_DUELS = [[0, 1], [2, 3], [4, 5], [6, 11], [8, 9], [18, 1]];

/* ---------------- helpers ------------------------------------------------ */
// English display names. TEAMS holds only [zhName, flag] and VEN only Chinese
// cities, so EN mode reads these maps. CUR_LANG is set by render() each cycle so
// the helpers don't need a lang arg threaded through every call site.
var CUR_LANG = 'zh';
var EN_TEAM = {
  mex: 'Mexico', rsa: 'South Africa', kor: 'South Korea', cze: 'Czechia', can: 'Canada',
  bih: 'Bosnia & Herz.', qat: 'Qatar', sui: 'Switzerland', bra: 'Brazil', mar: 'Morocco',
  hai: 'Haiti', sco: 'Scotland', usa: 'USA', par: 'Paraguay', aus: 'Australia', tur: 'Türkiye',
  ger: 'Germany', cuw: 'Curaçao', civ: "Côte d'Ivoire", ecu: 'Ecuador', ned: 'Netherlands',
  jpn: 'Japan', swe: 'Sweden', tun: 'Tunisia', bel: 'Belgium', egy: 'Egypt', irn: 'Iran',
  nzl: 'New Zealand', esp: 'Spain', cpv: 'Cape Verde', ksa: 'Saudi Arabia', uru: 'Uruguay',
  fra: 'France', sen: 'Senegal', irq: 'Iraq', nor: 'Norway', arg: 'Argentina', alg: 'Algeria',
  aut: 'Austria', jor: 'Jordan', por: 'Portugal', cod: 'DR Congo', uzb: 'Uzbekistan',
  col: 'Colombia', eng: 'England', cro: 'Croatia', gha: 'Ghana', pan: 'Panama'
};
var EN_CITY = {
  sofi: 'Los Angeles', levis: 'Santa Clara', lumen: 'Seattle', metlife: 'New York/NJ',
  gillette: 'Boston', linc: 'Philadelphia', mbs: 'Atlanta', hardrock: 'Miami', nrg: 'Houston',
  att: 'Dallas', arrowhead: 'Kansas City', azteca: 'Mexico City', bbva: 'Monterrey',
  bmo: 'Toronto', bcplace: 'Vancouver'
};
function teamName(code, lang) {
  var t = WC.TEAMS[code];
  if (!t) return code || '?';
  lang = lang || CUR_LANG;
  return t[1] + ' ' + (lang === 'en' && EN_TEAM[code] ? EN_TEAM[code] : t[0]);
}
function flag(code) { var t = WC.TEAMS[code]; return t ? t[1] : '🏳️'; }
function shortName(code, lang) {
  var t = WC.TEAMS[code]; if (!t) return code || '?';
  lang = lang || CUR_LANG;
  return (lang === 'en' && EN_TEAM[code]) ? EN_TEAM[code] : t[0];
}
function venName(v, idx) { var V = WC.VEN[v]; return V ? V[idx] : v; }
function cityName(v, lang) {
  lang = lang || CUR_LANG;
  if (lang === 'en' && EN_CITY[v]) return EN_CITY[v];
  var V = WC.VEN[v]; return V ? V[1] : v;
}
function pct(p, dp) { if (p == null || isNaN(p)) return '—'; return (p * 100).toFixed(dp == null ? 1 : dp) + '%'; }
function fmtDate(d) { var x = new Date(d + 'T12:00:00'); return (x.getMonth() + 1) + '/' + x.getDate(); }
function weekday(d, lang) {
  var wd = lang === 'en'
    ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    : ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  var x = new Date(d + 'T12:00:00'); return wd[x.getDay()];
}
function roundLabelZh(no, lang) {
  var T = I18N[lang].st;
  if (no >= 73 && no <= 88) return T.r32;
  if (no >= 89 && no <= 96) return T.r16;
  if (no >= 97 && no <= 100) return T.qf;
  if (no === 101 || no === 102) return T.sf;
  if (no === 103) return lang === 'en' ? '3rd' : '季军战';
  if (no === 104) return T.final;
  return '';
}
// team -> group letter
var TEAM_GROUP = {};
Object.keys(WC.GROUPS).forEach(function (g) {
  WC.GROUPS[g].forEach(function (t) { TEAM_GROUP[t] = g; });
});
// KO matches that are real fixtures with a venue+date (the bracket).
var KO_MATCHES = WC.KO.slice();

/* ---------------- App component ------------------------------------------ */
function App() {
  Component.call(this);
  var lang = 'zh';
  var goalHintDismissed = false;
  try {
    var l = localStorage.getItem('wco-lang'); if (l === 'en' || l === 'zh') lang = l;
    if (localStorage.getItem('wco-goalhint') === '1') goalHintDismissed = true;
  } catch (e) {}
  this.state = {
    lang: lang,
    tab: 'radar',
    results: null,        // latest sim results (blended if market loaded)
    baseline: null,       // pure-ELO baseline results (for what-if deltas)
    N: 20000,
    phase: 'init',        // 'init' | 'ready'
    simming: true,
    recomputing: false,
    snapshot: null,       // markets.fetchAll() output
    temp: 1,
    calib: null,          // {s, kl, deltas}
    calibDeltas: null,    // per-team Elo deltas from the champion rake
    blended: false,
    updatedAt: null,
    refreshing: false,
    workerErr: null,
    // selections
    rTeamA: 'arg', rTeamB: 'por', rMode: 'team', rStarA: 0, rStarB: 1,
    vMatch: 100,          // default to 7/11 Arrowhead QF (the showcase case)
    vRegion: '',          // venue filter: '' | 'W' | 'E' | 'C' (location-first)
    vRound: '',           // venue filter: '' | 'r32' | 'r16' | 'qf' | 'sf' | 'final'
    vSort: 'date',        // venue list sort: 'date' | 'star'
    pTeam: 'usa',
    tblSort: 'champion', tblDir: -1, tblView: 'both',
    // findability / UX
    goalHintDismissed: goalHintDismissed,
    sheet: null,          // searchable picker bottom-sheet: {kind, field, query} | null
    popover: null,        // info popover key: 'meet' | 'temp' | null
    // what-if
    lockGroup: {},        // groupLetter -> winner code
    lockMatch: {}         // koMatchNo -> winner code
  };
  this._reqId = 0;
  this._pending = {};     // reqId -> {resolve}
}
App.prototype = Object.create(Component.prototype);
App.prototype.constructor = App;

App.prototype.componentDidMount = function () {
  this.bootWorker();
  this.runBaseline();
};

App.prototype.componentWillUnmount = function () {
  if (this._refreshTimer) clearInterval(this._refreshTimer);
  if (this.worker) this.worker.terminate();
};

/* ---- worker plumbing ---- */
App.prototype.bootWorker = function () {
  var self = this;
  try {
    this.worker = new Worker('./sim.worker.js');
    this.worker.onmessage = function (ev) {
      var msg = ev.data || {};
      if (msg.type === 'ready') { self._workerReady = true; return; }
      if (msg.type === 'error') {
        self.setState({ workerErr: msg.message, simming: false, recomputing: false });
        var p0 = self._pending[msg.id]; if (p0) { p0.reject(new Error(msg.message)); delete self._pending[msg.id]; }
        return;
      }
      var p = self._pending[msg.id];
      if (p) { p.resolve(msg); delete self._pending[msg.id]; }
    };
    this.worker.onerror = function (e) {
      self.setState({ workerErr: (e && e.message) || 'worker error', simming: false, recomputing: false });
    };
  } catch (e) {
    self.worker = null; // fall back to main-thread sim
  }
};

// run a worker job; if worker unavailable, run on main thread synchronously.
App.prototype.simulate = function (config) {
  var self = this;
  if (this.worker) {
    var id = ++this._reqId;
    return new Promise(function (resolve, reject) {
      self._pending[id] = {
        resolve: function (msg) { resolve(msg.results); },
        reject: reject
      };
      self.worker.postMessage({ id: id, type: 'simulate', config: config });
    });
  }
  // main-thread fallback
  return new Promise(function (resolve) {
    setTimeout(function () { resolve(ENG.simulate(config)); }, 0);
  });
};

App.prototype.calibrateWorker = function (championMarket, opts) {
  var self = this;
  if (this.worker) {
    var id = ++this._reqId;
    return new Promise(function (resolve, reject) {
      self._pending[id] = { resolve: function (msg) { resolve(msg.fit); }, reject: reject };
      self.worker.postMessage({ id: id, type: 'calibrate', championMarket: championMarket, opts: opts });
    });
  }
  return new Promise(function (resolve) {
    setTimeout(function () { resolve(ENG.calibrate(championMarket, opts)); }, 0);
  });
};

// Two-stage fit: temperature pre-step + per-team Elo rake so the sim champion
// vector can REORDER to honour a market that disagrees with Elo ordering.
// Returns { s, deltas, kl, championSim }.
App.prototype.calibrateChampionWorker = function (championMarket, opts) {
  var self = this;
  if (this.worker) {
    var id = ++this._reqId;
    return new Promise(function (resolve, reject) {
      self._pending[id] = { resolve: function (msg) { resolve(msg.fit); }, reject: reject };
      self.worker.postMessage({ id: id, type: 'calibrateChampion', championMarket: championMarket, opts: opts });
    });
  }
  return new Promise(function (resolve) {
    setTimeout(function () { resolve(ENG.calibrateChampion(championMarket, opts)); }, 0);
  });
};

// Multi-stage IPF rake: refine the per-team Elo deltas against SEVERAL reach
// markets (R16/QF/SF/Final + champion) at once so mid-stage reach probabilities
// track the market — champion-only calibration systematically under-shoots them.
App.prototype.calibrateReachWorker = function (reachMarkets, opts) {
  var self = this;
  if (this.worker) {
    var id = ++this._reqId;
    return new Promise(function (resolve, reject) {
      self._pending[id] = { resolve: function (msg) { resolve(msg.fit); }, reject: reject };
      self.worker.postMessage({ id: id, type: 'calibrateReach', reachMarkets: reachMarkets, opts: opts });
    });
  }
  return new Promise(function (resolve) {
    setTimeout(function () { resolve(ENG.calibrateReach(reachMarkets, opts)); }, 0);
  });
};

// Assemble the {r16,qf,sf,final,champion} baskets calibrateReach expects from a
// markets snapshot. Returns null if none are usable (then we keep champion-only).
App.prototype.buildReachMarkets = function (snap, champNorm) {
  if (!snap) return null;
  var rm = {};
  if (snap.reachR16 && Object.keys(snap.reachR16).length) rm.r16 = snap.reachR16;
  if (snap.reachQF && Object.keys(snap.reachQF).length) rm.qf = snap.reachQF;
  if (snap.reachSF && Object.keys(snap.reachSF).length) rm.sf = snap.reachSF;
  if (snap.reachFinal && Object.keys(snap.reachFinal).length) rm.final = snap.reachFinal;
  if (champNorm && Object.keys(champNorm).length) rm.champion = champNorm;
  return Object.keys(rm).length ? rm : null;
};

/* ---- pipeline ---- */
App.prototype.runBaseline = function () {
  var self = this;
  this.setState({ simming: true });
  this.simulate({ N: this.state.N, temperature: 1, seed: 0x9E3779B9 }).then(function (res) {
    self.setState({ baseline: res, results: res, simming: false, phase: 'ready' });
    // then layer in live markets
    self.refreshMarkets(true);
    self._refreshTimer = setInterval(function () { self.refreshMarkets(false); }, 5 * 60 * 1000);
  }).catch(function (e) {
    self.setState({ simming: false, workerErr: String(e && e.message || e) });
  });
};

// fetch markets, calibrate, then re-simulate blended (with any what-if locks).
App.prototype.refreshMarkets = function (force) {
  var self = this;
  if (!MK) return;
  this.setState({ refreshing: true });
  MK.fetchAll({ force: !!force }).then(function (snap) {
    self.setState({ snapshot: snap });
    var champ = snap.champion && snap.champion.normalized;
    if (champ && Object.keys(champ).length) {
      // Two-stage fit on a smaller N for speed: temperature pre-step + per-team
      // Elo rake so the sim champion vector can match (and reorder to) the
      // market. Then full re-sim with both temp AND the per-team deltas.
      return self.calibrateChampionWorker(champ, { N: 5000, iters: 4, grid: [0.7, 0.9, 1.1, 1.3, 1.5, 1.7, 2.0] }).then(function (fit) {
        var temp = (fit && fit.s) ? fit.s : 1;
        var deltas = (fit && fit.deltas) ? fit.deltas : null;
        // Second pass: rake the deltas toward the reach-stage markets (R16/QF/SF/
        // Final), warm-started from the champion fit, so mid-stage reach tracks the
        // market too. Fall back to the champion-only fit if reach data is missing
        // or the rake errors — never block the blended render.
        var reachMk = self.buildReachMarkets(snap, champ);
        if (reachMk) {
          return self.calibrateReachWorker(reachMk, { N: 5000, iters: 5, s: temp, deltas: deltas }).then(function (rfit) {
            var rtemp = (rfit && rfit.s) ? rfit.s : temp;
            var rdeltas = (rfit && rfit.deltas) ? rfit.deltas : deltas;
            self.setState({ calib: fit, reachCalib: rfit, temp: rtemp, calibDeltas: rdeltas });
            return self.recompute(rtemp, snap, rdeltas);
          }, function () {
            self.setState({ calib: fit, temp: temp, calibDeltas: deltas });
            return self.recompute(temp, snap, deltas);
          });
        }
        self.setState({ calib: fit, temp: temp, calibDeltas: deltas });
        return self.recompute(temp, snap, deltas);
      });
    }
    return self.recompute(self.state.temp, snap);
  }).then(function () {
    self.setState({ refreshing: false, updatedAt: new Date(), blended: true });
  }).catch(function (e) {
    self.setState({ refreshing: false });
  });
};

// build group overrides + locked results from snapshot & what-if, re-simulate.
App.prototype.recompute = function (temp, snap, deltas) {
  var self = this;
  snap = snap || this.state.snapshot;
  temp = temp || this.state.temp;
  // per-team Elo deltas from the champion rake (reorder to market). Fall back to
  // the last calibrated deltas so what-if recomputes keep the market fit.
  if (deltas === undefined) deltas = this.state.calibDeltas || null;
  this.setState({ recomputing: true });

  var groupOverrides = {};
  if (snap && snap.perMatch) {
    Object.keys(snap.perMatch).forEach(function (no) {
      var pm = snap.perMatch[no];
      var dv = pm && pm.devigged;
      if (dv && dv.pA != null) groupOverrides[no] = { pA: dv.pA, pD: dv.pD, pB: dv.pB };
    });
  }

  // Translate per-team Elo deltas into an absolute-Elo override for the sim.
  var eloOverride = null;
  if (deltas) {
    eloOverride = {};
    Object.keys(deltas).forEach(function (c) {
      if (WC.ELO[c] != null) eloOverride[c] = WC.ELO[c] + deltas[c];
    });
  }

  // locked results: from what-if group winners + match winners.
  var locked = this.buildLockedResults();

  var cfg = {
    N: this.state.N,
    temperature: temp,
    elo: eloOverride,
    groupOverrides: groupOverrides,
    lockedResults: locked,
    seed: 0x9E3779B9
  };
  return this.simulate(cfg).then(function (res) {
    self.setState({ results: res, recomputing: false });
    return res;
  });
};

// Translate what-if state into engine lockedResults.
//   - lockGroup[g] = code: force that team to top its group. We approximate by
//     locking each of that team's 3 group matches as a win for them (token by
//     GM t1/t2 orientation). Engine reorients reversed fixtures internally.
//   - lockMatch[no] = winnerCode for a knockout match.
App.prototype.buildLockedResults = function () {
  var locked = {};
  var lg = this.state.lockGroup, lm = this.state.lockMatch;
  // group winner: lock all of that team's group matches as a 1-0 win.
  Object.keys(lg).forEach(function (g) {
    var code = lg[g];
    if (!code) return;
    WC.GM.forEach(function (m) {
      var no = m[0], grp = m[2], t1 = m[3], t2 = m[4];
      if (grp !== g) return;
      if (t1 === code) locked[no] = 'A';      // home win
      else if (t2 === code) locked[no] = 'B'; // away win
    });
  });
  // knockout match winners.
  Object.keys(lm).forEach(function (no) {
    if (lm[no]) locked[no] = lm[no];
  });
  return locked;
};

App.prototype.setLang = function () {
  var nl = this.state.lang === 'zh' ? 'en' : 'zh';
  try { localStorage.setItem('wco-lang', nl); } catch (e) {}
  this.setState({ lang: nl });
};

/* ---- what-if actions ---- */
App.prototype.setGroupLock = function (g, code) {
  var lg = {}; for (var k in this.state.lockGroup) lg[k] = this.state.lockGroup[k];
  if (code) lg[g] = code; else delete lg[g];
  var self = this;
  this.setState({ lockGroup: lg }, function () { self.recompute(); });
};
App.prototype.setMatchLock = function (no, code) {
  var lm = {}; for (var k in this.state.lockMatch) lm[k] = this.state.lockMatch[k];
  if (code) lm[no] = code; else delete lm[no];
  var self = this;
  this.setState({ lockMatch: lm }, function () { self.recompute(); });
};
App.prototype.clearWhatif = function () {
  var self = this;
  this.setState({ lockGroup: {}, lockMatch: {} }, function () { self.recompute(); });
};

/* ---- findability / UX actions ---- */
App.prototype.dismissGoalHint = function () {
  try { localStorage.setItem('wco-goalhint', '1'); } catch (e) {}
  this.setState({ goalHintDismissed: true });
};
// Open the searchable bottom-sheet picker.
//   kind: 'team' | 'star'   field: which selection to write
//     'team' fields -> 'rTeamA' | 'rTeamB' | 'pTeam'
//     'star' fields -> 'rStarA' | 'rStarB'
App.prototype.openSheet = function (kind, field) {
  this.setState({ sheet: { kind: kind, field: field, query: '' } });
};
App.prototype.closeSheet = function () { this.setState({ sheet: null }); };
App.prototype.setSheetQuery = function (q) {
  var s = this.state.sheet; if (!s) return;
  this.setState({ sheet: { kind: s.kind, field: s.field, query: q } });
};
// Commit a pick from the sheet. For teams, value = team code; for stars, value =
// index into STARS_PLAYERS (number).
App.prototype.pickFromSheet = function (value) {
  var s = this.state.sheet; if (!s) return;
  var patch = { sheet: null };
  patch[s.field] = value;
  this.setState(patch);
};
App.prototype.togglePopover = function (key) {
  this.setState({ popover: this.state.popover === key ? null : key });
};
// Jump to the venue browser focused on a specific knockout match (cross-tab CTA).
App.prototype.scoutMatch = function (no) {
  this.setState({ tab: 'venue', vMatch: no, vRegion: '', vRound: '' });
  try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) {}
};
// Jump to the radar pre-set to a team duel (cross-tab CTA from venue browser).
App.prototype.scoutDuel = function (codeA, codeB) {
  this.setState({ tab: 'radar', rMode: 'team', rTeamA: codeA, rTeamB: codeB });
  try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) {}
};
// Jump to the team-path explorer for a team (cross-tab CTA).
App.prototype.openPath = function (code) {
  this.setState({ tab: 'path', pTeam: code });
  try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) {}
};

/* ====================================================================== *
 * RENDER
 * ====================================================================== */
App.prototype.render = function () {
  var st = this.state || {};
  var lang = (st.lang === 'en' || st.lang === 'zh') ? st.lang : 'zh';
  CUR_LANG = lang; // helpers (teamName/shortName/cityName) read this
  var T = I18N[lang];
  var self = this;

  var tabs = ['radar', 'venue', 'path', 'table'];

  return html`
<div style="min-height:100vh">
  ${this.renderHeader(T, lang)}
  ${this.renderStatusBar(T, lang)}
  ${this.renderNav(tabs, T)}
  ${this.renderGoalHint(T, lang)}
  <main style="min-height:60vh">
    ${st.phase === 'init' || (st.simming && !st.results)
      ? this.renderBoot(T)
      : html`
        ${st.tab === 'radar' && this.renderRadar(T, lang)}
        ${st.tab === 'venue' && this.renderVenue(T, lang)}
        ${st.tab === 'path' && this.renderPath(T, lang)}
        ${st.tab === 'table' && this.renderTable(T, lang)}
      `}
    ${this.renderWhatif(T, lang)}
  </main>
  ${this.renderSheet(T, lang)}
  <footer style="padding:22px 16px calc(34px + env(safe-area-inset-bottom));text-align:center;font-size:11px;color:#6F6856;line-height:1.7">
    ${T.footer}
  </footer>
</div>`;
};

/* ---- header (accent band reused from reference) ---- */
App.prototype.renderHeader = function (T, lang) {
  var self = this;
  return html`
<div style="position:relative;overflow:hidden;background:#142019;color:#F4F0E4;padding:calc(22px + env(safe-area-inset-top)) calc(18px + env(safe-area-inset-right)) 18px calc(18px + env(safe-area-inset-left))">
  <span style="position:absolute;right:-12px;top:-40px;font-family:'Anton',sans-serif;font-size:190px;line-height:1;color:rgba(244,240,228,.07);letter-spacing:-6px;pointer-events:none">26</span>
  <button class="pressable" onClick=${function () { self.setLang(); }} aria-label="language" style="position:absolute;top:calc(16px + env(safe-area-inset-top));right:calc(14px + env(safe-area-inset-right));z-index:3;background:rgba(244,240,228,.12);border:1px solid rgba(244,240,228,.28);color:#F4F0E4;font-weight:700;border-radius:8px;padding:5px 12px;cursor:pointer;font-size:12px;letter-spacing:1px;font-family:'Barlow','Noto Sans SC',sans-serif">🌐 ${T.lang}</button>
  <div style="display:flex;gap:8px;align-items:center;font-size:11px;letter-spacing:2.5px;color:#9FB8A8;font-weight:600;font-family:'Barlow',sans-serif">
    <span>${T.window}</span><span style="width:4px;height:4px;border-radius:50%;background:#C8332B"></span><span>WORLDCUP<span style="color:#E8C25A">ODDS</span></span>
  </div>
  <div style="margin-top:9px;font-family:'Barlow Condensed','Noto Sans SC',sans-serif;font-weight:700;font-size:clamp(30px,7vw,44px);line-height:1.05;letter-spacing:.5px">${lang === 'en'
    ? html`World Cup <span style="font-family:'Anton',sans-serif;color:#E8C25A;letter-spacing:1px">2026</span> Live Odds · Pick Your Ticket`
    : html`世界杯 <span style="font-family:'Anton',sans-serif;color:#E8C25A;letter-spacing:1px">2026</span> 实时概率 · 看球买票`}</div>
  <div style="margin-top:8px;font-size:12.5px;color:#B9C4B6">${T.tagline}</div>
</div>
<div style="height:5px;display:flex"><i style="flex:1;background:#C8332B"></i><i style="flex:1;background:#0E8C4F"></i><i style="flex:1;background:#1D5FBF"></i></div>`;
};

/* ---- live status bar ---- */
App.prototype.renderStatusBar = function (T, lang) {
  var st = this.state, self = this;
  var blended = st.blended;
  var label = blended ? T.statusBlend : T.statusModel;
  var time = st.updatedAt ? st.updatedAt.toLocaleTimeString(lang === 'en' ? 'en-US' : 'zh-CN', { hour: '2-digit', minute: '2-digit' }) : '';
  var calibTxt = (blended && st.calib) ? (T.statusCalib + ' ' + (st.temp).toFixed(2)) : '';
  return html`
<div style="position:sticky;top:0;z-index:60;display:flex;align-items:center;gap:9px;flex-wrap:wrap;background:#1B2A21;color:#D8E2D5;padding:7px calc(14px + env(safe-area-inset-right)) 7px calc(14px + env(safe-area-inset-left));font-size:11.5px;border-bottom:1px solid #0E1B15">
  <span style="display:flex;align-items:center;gap:6px;font-weight:700;color:#EEF3EC"><span class="livedot"></span>${label}</span>
  ${calibTxt && html`<span style="position:relative;display:flex;align-items:center;gap:5px;color:#9FB8A8">${calibTxt} ${infoButton(self, 'temp')}${infoPopover(self, 'temp', st.popover, T.tempInfo)}</span>`}
  <span style="flex:1"></span>
  ${(st.refreshing || st.recomputing)
    ? html`<span style="display:flex;align-items:center;gap:6px;color:#E8C25A"><span style="width:11px;height:11px;border:2px solid rgba(232,194,90,.35);border-top-color:#E8C25A;border-radius:50%;display:inline-block;animation:spin .7s linear infinite"></span>${st.recomputing ? T.recomputing : T.refreshing}</span>`
    : html`<span style="color:#9FB8A8">${time ? (T.updated + ' ' + time) : ('N=' + st.N.toLocaleString())}</span>`}
  <button class="pressable" onClick=${function () { self.refreshMarkets(true); }} style="background:none;border:1px solid #2E4435;color:#B9C4B6;border-radius:6px;padding:3px 9px;cursor:pointer;font-size:11px;font-weight:600">↻ ${T.refresh}</button>
</div>`;
};

/* ---- nav (sticky, reused style) ---- */
App.prototype.renderNav = function (tabs, T) {
  var st = this.state, self = this;
  return html`
<nav style="position:sticky;top:33px;z-index:50;display:flex;background:rgba(242,238,226,.96);backdrop-filter:blur(8px);border-bottom:1px solid #DCD6C2">
  ${tabs.map(function (t) {
    var on = st.tab === t;
    return html`
    <button onClick=${function () { self.setState({ tab: t }); }} style=${'flex:1;padding:10px 3px 7px;background:none;border:none;cursor:pointer;font-family:\'Barlow Condensed\',\'Noto Sans SC\',sans-serif;font-weight:600;letter-spacing:1px;color:' + (on ? '#191D17' : '#8B8770')}>
      <div style="font-size:16px">${T.tabs[t]}</div>
      <div style="font-size:9.5px;letter-spacing:1.5px;color:#A9A38C;margin-top:1px">${T.tabsSub[t]}</div>
      <div style=${'height:3px;width:34px;border-radius:2px;margin:5px auto 0;background:' + (on ? '#C8332B' : 'transparent')}></div>
    </button>`;
  })}
</nav>`;
};

/* ---- goal-hint banner (one-tap orientation; dismissible, persists) ---- */
App.prototype.renderGoalHint = function (T, lang) {
  var st = this.state, self = this;
  if (st.goalHintDismissed) return null;
  return html`
<div style="max-width:980px;margin:0 auto;padding:10px 14px 0;animation:fadeup .25s ease">
  <div style="display:flex;align-items:flex-start;gap:10px;background:linear-gradient(135deg,#FBF4DD,#F4E9C8);border:1px solid #E6D49A;border-radius:11px;padding:11px 13px">
    <span style="font-size:17px;flex:none;line-height:1.3">🎟️</span>
    <div style="flex:1;font-size:12.5px;color:#5C4E22;line-height:1.55">
      ${T.goalHint}
      <div style="display:flex;gap:7px;margin-top:8px;flex-wrap:wrap">
        <button class="pressable" onClick=${function () { self.setState({ tab: 'radar' }); }} style="background:#191D17;color:#F2EEE2;border:none;border-radius:7px;padding:5px 11px;font-size:11.5px;font-weight:700;cursor:pointer">⭐ ${T.goalHintRadar}</button>
        <button class="pressable" onClick=${function () { self.setState({ tab: 'venue' }); }} style="background:#FFF;color:#191D17;border:1px solid #D8C98F;border-radius:7px;padding:5px 11px;font-size:11.5px;font-weight:700;cursor:pointer">🏟️ ${T.goalHintVenue}</button>
      </div>
    </div>
    <button class="pressable" onClick=${function () { self.dismissGoalHint(); }} style="flex:none;background:none;border:none;color:#9A8A4E;font-size:11.5px;font-weight:700;cursor:pointer;padding:2px 4px">${T.dismiss} ✕</button>
  </div>
</div>`;
};

/* ---- searchable bottom-sheet picker (.sheet-ov / .sheet-pn) ----
 * Replaces the small native <select> on a phone with a full-height, searchable
 * list. Teams are grouped by ELO and filtered by name (zh + en + code); stars
 * are filtered by player name and team. */
App.prototype.renderSheet = function (T, lang) {
  var st = this.state, self = this, s = st.sheet;
  if (!s) return null;
  var q = (s.query || '').trim().toLowerCase();

  var rows;
  if (s.kind === 'star') {
    rows = STARS_PLAYERS.map(function (p, i) { return { i: i, p: p }; })
      .filter(function (r) {
        if (!q) return true;
        var hay = (r.p[0] + ' ' + r.p[1] + ' ' + shortName(r.p[2]) + ' ' + r.p[2]).toLowerCase();
        return hay.indexOf(q) >= 0;
      });
  } else {
    rows = Object.keys(WC.TEAMS).sort(function (a, b) { return (WC.ELO[b] || 0) - (WC.ELO[a] || 0); })
      .filter(function (c) {
        if (!q) return true;
        var t = WC.TEAMS[c];
        var hay = ((t ? t[0] : '') + ' ' + (EN_TEAM[c] || '') + ' ' + c).toLowerCase();
        return hay.indexOf(q) >= 0;
      });
  }

  var title = s.kind === 'star' ? T.pickAStar : T.pickATeam;
  var placeholder = s.kind === 'star' ? T.searchStarPlaceholder : T.searchPlaceholder;

  return html`
<div class="sheet-ov" onClick=${function () { self.closeSheet(); }}>
  <div class="sheet-pn" onClick=${function (e) { e.stopPropagation(); }}>
    <div style="display:flex;align-items:center;gap:10px;padding:14px 16px 10px;border-bottom:1px solid #ECE6D4">
      <div style="flex:1;font-family:'Barlow Condensed','Noto Sans SC',sans-serif;font-size:18px;font-weight:700;color:#191D17">${title}</div>
      <button class="pressable" onClick=${function () { self.closeSheet(); }} style="background:none;border:1px solid #D8D2BE;color:#6B7263;border-radius:7px;padding:4px 11px;font-size:12px;font-weight:600;cursor:pointer">${T.closeSheet}</button>
    </div>
    <div style="padding:11px 16px 8px">
      <input autofocus value=${s.query} onInput=${function (e) { self.setSheetQuery(e.target.value); }} placeholder=${placeholder} style="width:100%;box-sizing:border-box;padding:11px 13px;border-radius:10px;border:1px solid #D8D2BE;background:#FFF;font-size:15px;color:#191D17" />
    </div>
    <div style="overflow-y:auto;-webkit-overflow-scrolling:touch;padding:4px 10px 16px">
      ${s.kind === 'star'
        ? rows.map(function (r) {
            return html`
            <button class="presslight" onClick=${function () { self.pickFromSheet(r.i); }} style="width:100%;display:flex;align-items:center;gap:10px;padding:10px 12px;background:none;border:none;border-bottom:1px solid #F0EBDC;cursor:pointer;text-align:left">
              <span style="font-size:18px;flex:none">${flag(r.p[2])}</span>
              <span style="flex:1;font-size:14.5px;font-weight:600;color:#191D17">${lang === 'en' ? r.p[1] : r.p[0]}</span>
              <span style="font-size:12px;color:#857E68">${shortName(r.p[2])}</span>
            </button>`;
          })
        : rows.map(function (c) {
            return html`
            <button class="presslight" onClick=${function () { self.pickFromSheet(c); }} style="width:100%;display:flex;align-items:center;gap:10px;padding:10px 12px;background:none;border:none;border-bottom:1px solid #F0EBDC;cursor:pointer;text-align:left">
              <span style="font-size:18px;flex:none">${flag(c)}</span>
              <span style="flex:1;font-size:14.5px;font-weight:600;color:#191D17">${shortName(c)}</span>
              <span style="font-size:11.5px;color:#857E68">${TEAM_GROUP[c] ? (TEAM_GROUP[c] + (lang === 'en' ? '' : T.groupSuffix)) : T.natTeam}</span>
              <span style="font-size:11px;color:#A9A38C;min-width:34px;text-align:right">ELO ${WC.ELO[c] || '—'}</span>
            </button>`;
          })}
      ${rows.length === 0 && html`<div style="padding:24px 14px;text-align:center;font-size:13px;color:#8B8770">∅</div>`}
    </div>
  </div>
</div>`;
};

/* ---- info popover (i): small dismissible explanation card ---- */
function infoButton(self, key) {
  return html`<button class="pressable" onClick=${function (e) { e.stopPropagation(); self.togglePopover(key); }} style="flex:none;width:17px;height:17px;border-radius:50%;border:1px solid currentColor;background:none;color:inherit;font-size:11px;font-weight:700;line-height:1;cursor:pointer;opacity:.65;padding:0">i</button>`;
}
function infoPopover(self, key, activeKey, text) {
  if (activeKey !== key) return null;
  return html`
  <div onClick=${function (e) { e.stopPropagation(); }} style="position:absolute;z-index:80;left:0;top:100%;margin-top:8px;width:min(82vw,300px);background:#191D17;color:#F2EEE2;border-radius:10px;padding:11px 13px;font-size:12px;line-height:1.6;box-shadow:0 6px 22px rgba(20,32,25,.32);text-align:left;white-space:normal;font-weight:400">
    ${text}
    <button class="pressable" onClick=${function () { self.togglePopover(key); }} style="margin-top:8px;background:none;border:1px solid rgba(244,240,228,.4);color:#F2EEE2;border-radius:6px;padding:3px 10px;font-size:11px;font-weight:600;cursor:pointer">OK</button>
  </div>`;
}

/* ---- boot shimmer ---- */
App.prototype.renderBoot = function (T) {
  return html`
<section style="max-width:780px;margin:0 auto;padding:24px 14px;animation:fadeup .25s ease">
  <div style="display:flex;align-items:center;gap:10px;font-size:15px;font-weight:700;color:#3D443C;margin-bottom:16px">
    <span style="width:16px;height:16px;border:3px solid #D5CEB8;border-top-color:#0E8C4F;border-radius:50%;display:inline-block;animation:spin .8s linear infinite"></span>
    ${T.simming}
  </div>
  ${[0, 1, 2, 3].map(function (i) {
    return html`<div class="shim" style=${'height:' + (i === 0 ? 64 : 48) + 'px;border-radius:12px;margin-bottom:10px'}></div>`;
  })}
</section>`;
};

/* intro note block (reused warm style) */
function introBox(text) {
  return html`<div style="font-size:12.5px;color:#6B7263;background:#E9E4D2;border-radius:10px;padding:11px 14px;margin-bottom:14px;line-height:1.6">${text}</div>`;
}
function sectionTitle(title) {
  return html`<div style="font-family:'Barlow Condensed','Noto Sans SC',sans-serif;font-size:22px;font-weight:700;margin:4px 2px 4px">${title}</div>`;
}
function selectBox(value, onChange, options) {
  return html`
<select value=${value} onChange=${onChange} style="width:100%;padding:11px 12px;border-radius:10px;border:1px solid #D8D2BE;background:#FFFFFF;font-size:15px;color:#191D17;font-weight:600">
  ${options.map(function (o) { return html`<option value=${o.v} disabled=${o.dis}>${o.label}</option>`; })}
</select>`;
}
/* Button that opens the searchable bottom-sheet picker. Shows the current pick. */
function sheetTrigger(self, kind, field, label) {
  return html`
<button class="presslight" onClick=${function () { self.openSheet(kind, field); }} style="width:100%;display:flex;align-items:center;gap:8px;padding:11px 12px;border-radius:10px;border:1px solid #D8D2BE;background:#FFFFFF;font-size:15px;color:#191D17;font-weight:600;cursor:pointer;text-align:left">
  <span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${label}</span>
  <span style="flex:none;color:#857E68;font-size:12px">🔍</span>
</button>`;
}

/* ---- marquee duel quick-pick rail (Messi vs Ronaldo etc.) ----
 * One-tap entry into the showcase star duels. Tapping a chip switches to star
 * mode and sets both star indices from MARQUEE_DUELS. */
App.prototype.renderMarqueeRail = function (T, lang) {
  var st = this.state, self = this;
  return html`
<div style="margin-bottom:13px">
  <div style="display:flex;align-items:center;gap:6px;font-size:11px;letter-spacing:1.5px;color:#8B8770;font-weight:700;margin-bottom:7px">
    <span style="width:6px;height:6px;border-radius:50%;background:#C8332B"></span>${T.nowPlaying}
  </div>
  <div style="display:flex;gap:8px;overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:3px">
    ${MARQUEE_DUELS.map(function (d, idx) {
      var pa = STARS_PLAYERS[d[0]], pb = STARS_PLAYERS[d[1]];
      var on = st.rMode === 'star' && st.rStarA === d[0] && st.rStarB === d[1];
      var nameA = lang === 'en' ? pa[1] : pa[0].split(' ')[0];
      var nameB = lang === 'en' ? pb[1] : pb[0].split(' ')[0];
      var label = idx === 0 ? T.tryMarquee : (nameA + ' vs ' + nameB);
      return html`
      <button class="pressable" onClick=${function () { self.setState({ rMode: 'star', rStarA: d[0], rStarB: d[1] }); }} style=${'flex:none;display:flex;align-items:center;gap:6px;padding:7px 12px;border-radius:20px;border:1px solid ' + (on ? '#C8332B' : '#D8D2BE') + ';background:' + (on ? '#C8332B' : '#FFF') + ';color:' + (on ? '#FFF' : '#191D17') + ';font-size:12.5px;font-weight:700;cursor:pointer;white-space:nowrap'}>
        <span>${flag(pa[2])}</span><span>${label}</span><span>${flag(pb[2])}</span>
      </button>`;
    })}
  </div>
</div>`;
};

/* ====================================================================== *
 * VIEW 1 — Star Matchup Radar
 * ====================================================================== */
App.prototype.renderRadar = function (T, lang) {
  var st = this.state, self = this, res = st.results;

  var codeA, codeB, labelA, labelB;
  if (st.rMode === 'star') {
    var pa = STARS_PLAYERS[st.rStarA], pb = STARS_PLAYERS[st.rStarB];
    codeA = pa[2]; codeB = pb[2];
    labelA = (lang === 'en' ? pa[1] : pa[0]); labelB = (lang === 'en' ? pb[1] : pb[0]);
  } else {
    codeA = st.rTeamA; codeB = st.rTeamB;
    labelA = teamName(codeA, lang); labelB = teamName(codeB, lang);
  }

  var meetings = (res && codeA && codeB && codeA !== codeB)
    ? ENG.queryMatchup(res, codeA, codeB) : [];
  var totalProb = meetings.reduce(function (s, m) { return s + m.prob; }, 0);
  var sameGroup = TEAM_GROUP[codeA] && TEAM_GROUP[codeA] === TEAM_GROUP[codeB];

  return html`
<section style="max-width:820px;margin:0 auto;padding:16px 14px 10px;animation:fadeup .25s ease">
  ${sectionTitle('⭐ ' + T.radarTitle)}
  ${introBox(T.radarIntro)}

  <div style="display:flex;gap:6px;margin-bottom:12px">
    ${[['team', T.byTeam], ['star', T.byStar]].map(function (m) {
      var on = st.rMode === m[0];
      return html`<button class="pressable" onClick=${function () { self.setState({ rMode: m[0] }); }} style=${'flex:1;padding:9px;border-radius:9px;border:1px solid ' + (on ? '#191D17' : '#D8D2BE') + ';background:' + (on ? '#191D17' : '#FFF') + ';color:' + (on ? '#F2EEE2' : '#191D17') + ';font-weight:700;font-size:13.5px;cursor:pointer'}>${m[1]}</button>`;
    })}
  </div>

  ${this.renderMarqueeRail(T, lang)}

  <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:9px;align-items:center;margin-bottom:14px">
    <div>
      <div style="font-size:11px;letter-spacing:1px;color:#8B8770;font-weight:600;margin-bottom:5px">${st.rMode === 'star' ? T.starA : T.teamA}</div>
      ${st.rMode === 'star'
        ? sheetTrigger(self, 'star', 'rStarA', (lang === 'en' ? STARS_PLAYERS[st.rStarA][1] : STARS_PLAYERS[st.rStarA][0]) + ' · ' + shortName(STARS_PLAYERS[st.rStarA][2]))
        : sheetTrigger(self, 'team', 'rTeamA', flag(codeA) + ' ' + shortName(codeA))}
    </div>
    <div style="font-family:'Anton',sans-serif;font-size:20px;color:#C8332B;padding-top:18px">VS</div>
    <div>
      <div style="font-size:11px;letter-spacing:1px;color:#8B8770;font-weight:600;margin-bottom:5px">${st.rMode === 'star' ? T.starB : T.teamB}</div>
      ${st.rMode === 'star'
        ? sheetTrigger(self, 'star', 'rStarB', (lang === 'en' ? STARS_PLAYERS[st.rStarB][1] : STARS_PLAYERS[st.rStarB][0]) + ' · ' + shortName(STARS_PLAYERS[st.rStarB][2]))
        : sheetTrigger(self, 'team', 'rTeamB', flag(codeB) + ' ' + shortName(codeB))}
    </div>
  </div>

  ${codeA === codeB
    ? html`<div style="font-size:13px;color:#A23227;background:#FBEDEA;border:1px solid #E3C7C2;border-radius:10px;padding:12px 14px">${T.samePick}</div>`
    : html`
  <div style="position:relative;background:linear-gradient(135deg,#14261E,#0E1B15);color:#F4F0E4;border-radius:14px;padding:16px;text-align:center;margin-bottom:14px">
    <div style="display:flex;align-items:center;justify-content:center;gap:10px;font-size:15px;font-weight:700">
      <span>${flag(codeA)} ${labelA}</span><span style="color:#E8C25A">⚔</span><span>${flag(codeB)} ${labelB}</span>
    </div>
    <div style="display:flex;align-items:center;justify-content:center;gap:6px;font-size:11px;letter-spacing:2px;color:#9FB8A8;margin-top:12px">${T.meetProb} ${infoButton(self, 'meet')}</div>
    <div style="font-family:'Anton',sans-serif;font-size:46px;line-height:1.1;margin-top:2px;color:${totalProb > 0.001 ? '#E8C25A' : '#7C8C82'}">${pct(totalProb, totalProb < 0.1 ? 2 : 1)}</div>
    ${sameGroup && html`<div style="font-size:11px;color:#C8A95A;margin-top:6px">⚠ ${T.sameGroupNote}</div>`}
    ${infoPopover(self, 'meet', st.popover, T.meetInfo)}
  </div>

  ${meetings.length === 0
    ? html`<div style="font-size:13px;color:#6B7263;background:#E9E4D2;border-radius:10px;padding:14px">${T.noMeet}</div>`
    : html`
    <div style="font-family:'Barlow Condensed','Noto Sans SC',sans-serif;font-size:18px;font-weight:700;margin:4px 2px 8px">${T.everyMeeting}</div>
    ${meetings.map(function (m, i) {
      var best = i === 0;
      return html`
      <div style=${'display:flex;align-items:stretch;background:#FFF;border:1px solid ' + (best ? '#E0C77F' : '#DCD6C2') + ';border-radius:12px;margin-bottom:8px;overflow:hidden;' + (best ? 'box-shadow:0 2px 12px rgba(184,134,11,.14)' : '')}>
        <div style=${'width:6px;flex:none;background:' + (best ? '#E8C25A' : '#D5CEB8')}></div>
        <div style="flex:1;padding:11px 13px">
          ${best && html`<div style="display:inline-block;font-size:10.5px;font-weight:700;letter-spacing:.5px;color:#7A5A00;background:#F4E3AC;padding:2px 8px;border-radius:5px;margin-bottom:6px">${T.bestTicket}</div>`}
          <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
            <span style="font-family:'Anton',sans-serif;font-size:15px">${roundLabelZh(m.matchNo, lang)}</span>
            <span style="font-size:11px;color:#857E68;font-weight:600">M${m.matchNo}</span>
            <span style="flex:1"></span>
            <span style="font-family:'Anton',sans-serif;font-size:22px;color:${best ? '#B8860B' : '#191D17'}">${pct(m.prob, m.prob < 0.1 ? 2 : 1)}</span>
          </div>
          <div style="font-size:12.5px;color:#6B7263;margin-top:5px">📍 <b style="color:#191D17;font-weight:600">${m.venueName}</b> · ${cityName(m.venue)}</div>
          <div style="font-size:12px;color:#6B7263;margin-top:2px">🗓️ ${fmtDate(m.date)} ${weekday(m.date, lang)}</div>
          <button class="pressable" onClick=${function () { self.scoutMatch(m.matchNo); }} style=${'margin-top:9px;display:inline-flex;align-items:center;gap:6px;border-radius:8px;padding:6px 11px;font-size:11.5px;font-weight:700;cursor:pointer;border:1px solid ' + (best ? '#E0C77F' : '#D8D2BE') + ';background:' + (best ? '#FBF4DD' : '#FAF8F0') + ';color:#7A5A00'}>🏟️ ${T.scoutInVenue} →</button>
        </div>
      </div>`;
    })}`}
  `}
</section>`;
};

/* ---- venue location-first filters (region / round / sort) ---- */
App.prototype.renderVenueFilters = function (T, lang, count) {
  var st = this.state, self = this;
  function chip(active, label, onClick) {
    return html`<button class="pressable" onClick=${onClick} style=${'flex:none;padding:6px 12px;border-radius:18px;border:1px solid ' + (active ? '#191D17' : '#D8D2BE') + ';background:' + (active ? '#191D17' : '#FFF') + ';color:' + (active ? '#F2EEE2' : '#191D17') + ';font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap'}>${label}</button>`;
  }
  var regions = [['W', T.regionW], ['E', T.regionE], ['C', T.regionC]];
  var rounds = [['r32', T.st.r32], ['r16', T.st.r16], ['qf', T.st.qf], ['sf', T.st.sf], ['final', T.st.final]];
  return html`
<div style="background:#FFF;border:1px solid #DCD6C2;border-radius:12px;padding:11px 12px;margin-bottom:12px">
  <div style="display:flex;align-items:center;gap:7px;font-size:11px;letter-spacing:1px;color:#8B8770;font-weight:700;margin-bottom:7px">${T.byCity}</div>
  <div style="display:flex;gap:7px;overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:2px;margin-bottom:9px">
    ${chip(!st.vRegion, T.allGroups, function () { self.setState({ vRegion: '' }); })}
    ${regions.map(function (r) { return chip(st.vRegion === r[0], r[1], function () { self.setState({ vRegion: st.vRegion === r[0] ? '' : r[0] }); }); })}
  </div>
  <div style="display:flex;gap:7px;overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:2px;margin-bottom:9px">
    ${chip(!st.vRound, T.allRounds, function () { self.setState({ vRound: '' }); })}
    ${rounds.map(function (r) { return chip(st.vRound === r[0], r[1], function () { self.setState({ vRound: st.vRound === r[0] ? '' : r[0] }); }); })}
  </div>
  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
    <span style="font-size:11px;color:#8B8770;font-weight:600;margin-right:2px">${count} ${T.matchesHere}</span>
    <span style="flex:1"></span>
    ${chip(st.vSort === 'date', '🗓️ ' + T.byDate, function () { self.setState({ vSort: 'date' }); })}
    ${chip(st.vSort === 'star', '⭐ ' + T.sortByStar, function () { self.setState({ vSort: 'star' }); })}
  </div>
</div>`;
};

/* ====================================================================== *
 * VIEW 2 — Venue / Date Browser
 * ====================================================================== */
App.prototype.renderVenue = function (T, lang) {
  var st = this.state, self = this, res = st.results;

  // round-bucket of a KO match number, for the round filter.
  function roundKey(no) {
    if (no >= 73 && no <= 88) return 'r32';
    if (no >= 89 && no <= 96) return 'r16';
    if (no >= 97 && no <= 100) return 'qf';
    if (no === 101 || no === 102) return 'sf';
    return 'final'; // 103 (3rd) + 104 (final) bucket together under Final
  }
  // per-match star power, memoized on the results object so the location-first
  // star sort doesn't recompute queryVenue for all 32 matches every render.
  function starPowerOf(m) {
    if (!res) return 0;
    if (!res._starPowerCache) res._starPowerCache = {};
    if (res._starPowerCache[m.no] != null) return res._starPowerCache[m.no];
    var q = ENG.queryVenue(res, m.v, m.d), sp = 0;
    q.appearances.forEach(function (a) { sp += a.prob * (WC.STARS[a.code] || 1); });
    res._starPowerCache[m.no] = sp;
    return sp;
  }

  // all KO matches, then apply location-first filters (region + round).
  var allMatches = KO_MATCHES.slice();
  var matches = allMatches.filter(function (m) {
    var Vv = WC.VEN[m.v];
    if (st.vRegion && (!Vv || Vv[2] !== st.vRegion)) return false;
    if (st.vRound && roundKey(m.no) !== st.vRound) return false;
    return true;
  });
  // sort by date (default) or by star power (location-first "best match" first).
  matches.sort(function (a, b) {
    if (st.vSort === 'star') {
      var d = starPowerOf(b) - starPowerOf(a);
      if (Math.abs(d) > 1e-9) return d > 0 ? 1 : -1;
    }
    if (a.d !== b.d) return a.d < b.d ? -1 : 1;
    return a.no - b.no;
  });

  var matchOpts = matches.map(function (m) {
    var Vv = WC.VEN[m.v];
    return { v: String(m.no), label: 'M' + m.no + ' · ' + roundLabelZh(m.no, lang) + ' · ' + fmtDate(m.d) + ' · ' + (Vv ? Vv[0] : m.v) + ' / ' + cityName(m.v) };
  });

  // keep the selected match valid under the active filter; else fall to first.
  var sel = null;
  for (var i = 0; i < matches.length; i++) if (matches[i].no === st.vMatch) { sel = matches[i]; break; }
  if (!sel) sel = matches.length ? matches[0] : allMatches[0];

  var vq = (res && sel) ? ENG.queryVenue(res, sel.v, sel.d) : { pairs: [], appearances: [] };

  // star power = sum over teams of (P(appear) * STARS tier)
  var starPower = 0;
  vq.appearances.forEach(function (a) { starPower += a.prob * (WC.STARS[a.code] || 1); });

  // marquee appearance list: top teams by appearance prob, STARS>=3 highlighted.
  var apps = vq.appearances.slice(0, 12);
  var maxApp = apps.length ? apps[0].prob : 1;

  // most likely pairs (already sorted desc)
  var pairs = vq.pairs.slice(0, 10);
  var maxPair = pairs.length ? pairs[0].prob : 1;

  var V = WC.VEN[sel.v];

  return html`
<section style="max-width:820px;margin:0 auto;padding:16px 14px 10px;animation:fadeup .25s ease">
  ${sectionTitle('🏟️ ' + T.venueTitle)}
  ${introBox(T.venueIntro)}

  ${this.renderVenueFilters(T, lang, matches.length)}

  <div style="font-size:11px;letter-spacing:1px;color:#8B8770;font-weight:600;margin-bottom:5px">${T.pickMatch}</div>
  ${selectBox(String(sel.no), function (e) { self.setState({ vMatch: parseInt(e.target.value, 10) }); }, matchOpts)}

  <div style="background:#FFF;border:1px solid #DCD6C2;border-radius:14px;padding:14px;margin:14px 0 12px">
    <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
      <span style="font-family:'Anton',sans-serif;font-size:18px">${roundLabelZh(sel.no, lang)}</span>
      <span style="font-size:11px;color:#857E68;font-weight:600">M${sel.no}</span>
    </div>
    <div style="font-size:13.5px;color:#191D17;font-weight:600;margin-top:6px">📍 ${V ? V[0] : sel.v} · ${cityName(sel.v)}</div>
    <div style="font-size:12.5px;color:#6B7263;margin-top:2px">🗓️ ${fmtDate(sel.d)} ${weekday(sel.d, lang)} · ${sel.d}</div>
    <div style="display:flex;align-items:center;gap:10px;margin-top:12px;padding-top:11px;border-top:1px dashed #E0DAC6">
      <div style="flex:none">
        <div style="font-size:10.5px;letter-spacing:1px;color:#8B8770;font-weight:600">${T.starPower}</div>
        <div style="font-family:'Anton',sans-serif;font-size:30px;color:#B8860B;line-height:1">${starPower.toFixed(1)}</div>
      </div>
      <div style="flex:1">
        <div style="display:flex;height:9px;border-radius:5px;overflow:hidden;background:#EFEADB">
          <i style=${'display:block;height:100%;width:' + Math.min(100, starPower / 10 * 100) + '%;background:linear-gradient(90deg,#E8C25A,#B8860B)'}></i>
        </div>
        <div style="font-size:10.5px;color:#8B8770;margin-top:4px">${T.starPowerNote}</div>
      </div>
    </div>
  </div>

  <div style="font-family:'Barlow Condensed','Noto Sans SC',sans-serif;font-size:17px;font-weight:700;margin:4px 2px 8px">${T.likelyPairs}</div>
  ${pairs.length === 0
    ? html`<div class="shim" style="height:48px;border-radius:10px;margin-bottom:8px"></div>`
    : pairs.map(function (p) {
      var a = p.pair[0], b = p.pair[1];
      return html`
      <button class="presslight" title=${T.seeInRadar} onClick=${function () { self.scoutDuel(a, b); }} style="width:100%;display:flex;align-items:center;gap:8px;padding:8px 6px;border:none;border-bottom:1px solid #EFEADB;background:none;cursor:pointer;text-align:left">
        <span style="min-width:120px;flex:none;font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${flag(a)} ${shortName(a)} <span style="color:#857E68;font-size:11px">${T.vs}</span> ${flag(b)} ${shortName(b)}</span>
        <span style="flex:1;height:8px;border-radius:4px;background:#EFEADB;overflow:hidden"><i style=${'display:block;height:100%;width:' + Math.max(2, Math.round(p.prob / maxPair * 100)) + '%;background:#0E8C4F'}></i></span>
        <span style="width:50px;flex:none;text-align:right;font-size:12.5px;font-weight:700">${pct(p.prob, 1)}</span>
        <span style="flex:none;color:#857E68;font-size:13px">›</span>
      </button>`;
    })}
  ${pairs.length > 0 && html`<div style="font-size:10.5px;color:#A9A38C;margin:6px 2px 0">${T.seeInRadar} →</div>`}

  <div style="font-family:'Barlow Condensed','Noto Sans SC',sans-serif;font-size:17px;font-weight:700;margin:18px 2px 8px">${T.marqueeApp}</div>
  ${apps.map(function (a) {
    var star = (WC.STARS[a.code] || 1) >= 4;
    return html`
    <button class="presslight" title=${T.openInPath} onClick=${function () { self.openPath(a.code); }} style="width:100%;display:flex;align-items:center;gap:8px;padding:5px 6px;border:none;background:none;cursor:pointer;text-align:left">
      <span style="font-size:16px;flex:none">${flag(a.code)}</span>
      <span style="min-width:66px;flex:none;font-size:13px;font-weight:600;color:${star ? '#191D17' : '#3D443C'}">${shortName(a.code)}${star ? ' ⭐' : ''}</span>
      <span style="flex:1;height:8px;border-radius:4px;background:#EFEADB;overflow:hidden"><i style=${'display:block;height:100%;width:' + Math.max(2, Math.round(a.prob / maxApp * 100)) + '%;background:' + (star ? '#B8860B' : '#1D5FBF')}></i></span>
      <span style="width:50px;flex:none;text-align:right;font-size:12.5px;font-weight:700">${pct(a.prob, 1)}</span>
      <span style="flex:none;color:#857E68;font-size:13px">›</span>
    </button>`;
  })}
  ${apps.length > 0 && html`<div style="font-size:10.5px;color:#A9A38C;margin:6px 2px 0">${T.openInPath} →</div>`}
</section>`;
};

/* ====================================================================== *
 * VIEW 3 — Team Path Explorer
 * ====================================================================== */
App.prototype.renderPath = function (T, lang) {
  var st = this.state, self = this, res = st.results;
  var code = st.pTeam;

  var stage = (res && res.teamStage[code]) ? res.teamStage[code] : null;
  var path = (res && res.teamPath[code]) ? res.teamPath[code] : null;

  var funnelRows = [
    ['r32', T.st.r32], ['r16', T.st.r16], ['qf', T.st.qf],
    ['sf', T.st.sf], ['final', T.st.final], ['champion', T.st.champion]
  ];
  var ROUNDS = [['r32', T.st.r32], ['r16', T.st.r16], ['qf', T.st.qf], ['sf', T.st.sf], ['final', T.st.final]];

  return html`
<section style="max-width:820px;margin:0 auto;padding:16px 14px 10px;animation:fadeup .25s ease">
  ${sectionTitle('🧭 ' + T.pathTitle)}
  ${introBox(T.pathIntro)}

  <div style="font-size:11px;letter-spacing:1px;color:#8B8770;font-weight:600;margin-bottom:5px">${T.pickTeam}</div>
  ${sheetTrigger(self, 'team', 'pTeam', flag(code) + ' ' + teamName(code, lang))}

  ${!stage ? html`<div class="shim" style="height:80px;border-radius:12px;margin-top:14px"></div>` : html`
  <div style="background:linear-gradient(135deg,#14261E,#0E1B15);color:#F4F0E4;border-radius:14px;padding:16px;margin:14px 0 12px;text-align:center">
    <div style="font-size:30px">${flag(code)}</div>
    <div style="font-family:'Barlow Condensed','Noto Sans SC',sans-serif;font-size:24px;font-weight:700">${shortName(code)}</div>
    <div style="font-size:11px;color:#9FB8A8;margin-top:2px">ELO ${WC.ELO[code] || '—'} · ${TEAM_GROUP[code]}${lang === 'en' ? ' group' : ' 组'} · ${'⭐'.repeat(WC.STARS[code] || 1)}</div>
  </div>

  <div style="font-family:'Barlow Condensed','Noto Sans SC',sans-serif;font-size:17px;font-weight:700;margin:4px 2px 8px">${T.funnel}</div>
  <div style="background:#FFF;border:1px solid #DCD6C2;border-radius:14px;padding:13px 14px;margin-bottom:14px">
    ${funnelRows.map(function (r) {
      var p = stage[r[0]] || 0;
      var champ = r[0] === 'champion';
      return html`
      <div style="display:flex;align-items:center;gap:9px;padding:4px 0">
        <span style="width:42px;flex:none;font-size:12.5px;font-weight:600;color:#3D443C">${r[1]}</span>
        <span style="flex:1;height:13px;border-radius:7px;background:#EFEADB;overflow:hidden"><i style=${'display:block;height:100%;width:' + Math.max(1.5, p * 100) + '%;background:' + (champ ? 'linear-gradient(90deg,#E8C25A,#B8860B)' : '#0E8C4F')}></i></span>
        <span style="width:52px;flex:none;text-align:right;font-family:'Anton',sans-serif;font-size:15px;color:${champ ? '#B8860B' : '#191D17'}">${pct(p, p < 0.1 ? 1 : 0)}</span>
      </div>`;
    })}
  </div>

  <div style="font-family:'Barlow Condensed','Noto Sans SC',sans-serif;font-size:17px;font-weight:700;margin:4px 2px 8px">${T.roundByRound}</div>
  ${ROUNDS.map(function (rd) {
    var pr = path ? path[rd[0]] : null;
    if (!pr || pr.reach < 0.0005) {
      return html`
      <div style="display:flex;align-items:center;gap:9px;padding:9px 12px;background:#FAF8F0;border:1px solid #EAE5D5;border-radius:11px;margin-bottom:8px;opacity:.7">
        <span style="font-family:'Anton',sans-serif;font-size:14px;width:42px;flex:none">${rd[1]}</span>
        <span style="font-size:12.5px;color:#8B8770">${lang === 'en' ? 'unlikely to reach' : '基本无缘'}</span>
      </div>`;
    }
    var opp = pr.opponents && pr.opponents[0];
    var ven = pr.venues && pr.venues[0];
    var V = ven ? WC.VEN[ven.venue] : null;
    return html`
    <div style="background:#FFF;border:1px solid #DCD6C2;border-radius:11px;margin-bottom:8px;overflow:hidden">
      <div style="display:flex;align-items:center;gap:9px;padding:9px 12px;background:#F7F4E9">
        <span style="font-family:'Anton',sans-serif;font-size:15px">${rd[1]}</span>
        <span style="font-size:11px;color:#6B7263">${T.reachProb} <b style="color:#0E8C4F">${pct(pr.reach, 1)}</b></span>
        <span style="flex:1"></span>
        ${ven && html`<span style="font-size:11.5px;color:#857E68;font-weight:600">🗓️ ${fmtDate(ven.date)} ${weekday(ven.date, lang)}</span>`}
      </div>
      <div style="padding:9px 12px;display:flex;flex-direction:column;gap:6px">
        ${opp && html`<div style="font-size:13px"><span style="color:#857E68">${T.likelyOpp}:</span> <b>${flag(opp.code)} ${shortName(opp.code)}</b> <span style="color:#857E68;font-size:11.5px">${pct(opp.prob / (pr.reach || 1), 0)}${lang === 'en' ? ' of the time' : ' 的可能'}</span></div>`}
        ${V && html`<div style="font-size:13px"><span style="color:#857E68">${T.likelyVenue}:</span> <b>${V[0]}</b> · ${cityName(ven.venue)} <span style="color:#857E68;font-size:11.5px">${ven ? pct(ven.prob / (pr.reach || 1), 0) : ''}</span></div>`}
      </div>
    </div>`;
  })}
  `}
</section>`;
};

/* ====================================================================== *
 * VIEW 4 — Stage Probability Table (sortable + model/market toggle)
 * ====================================================================== */
App.prototype.renderTable = function (T, lang) {
  var st = this.state, self = this, res = st.results, snap = st.snapshot;
  if (!res) return html`<section style="max-width:980px;margin:0 auto;padding:16px 14px"><div class="shim" style="height:200px;border-radius:12px"></div></section>`;

  // market marginals per stage (where available), basket-normalized already.
  var mkt = {
    r32: snap && snap.advance ? snap.advance : null,
    r16: snap && snap.reachR16 ? snap.reachR16 : null,
    qf: snap && snap.reachQF ? snap.reachQF : null,
    sf: snap && snap.reachSF ? snap.reachSF : null,
    final: snap && snap.reachFinal ? snap.reachFinal : null,
    champion: snap && snap.champion ? snap.champion.normalized : null
  };

  var cols = [
    ['r32', T.st.r32], ['r16', T.st.r16], ['qf', T.st.qf],
    ['sf', T.st.sf], ['final', T.st.final], ['champion', T.st.champion]
  ];

  var rows = Object.keys(WC.TEAMS).map(function (c) {
    var stg = res.teamStage[c] || {};
    return { code: c, stage: stg };
  });
  var sortKey = st.tblSort, dir = st.tblDir;
  rows.sort(function (a, b) {
    // dir = -1 => descending (highest/Z first, the ▾ arrow); +1 => ascending.
    if (sortKey === 'team') {
      var na = shortName(a.code), nb = shortName(b.code);
      return -dir * (na < nb ? -1 : na > nb ? 1 : 0);
    }
    return -dir * ((b.stage[sortKey] || 0) - (a.stage[sortKey] || 0));
  });

  function sortBy(k) {
    var nd = (st.tblSort === k) ? -st.tblDir : -1;
    self.setState({ tblSort: k, tblDir: nd });
  }
  function arrow(k) { return st.tblSort === k ? (st.tblDir < 0 ? ' ▾' : ' ▴') : ''; }

  var view = st.tblView; // 'model' | 'market' | 'both'
  var hasMarket = !!snap;

  return html`
<section style="max-width:980px;margin:0 auto;padding:16px 14px 10px;animation:fadeup .25s ease">
  ${sectionTitle('📊 ' + T.tableTitle)}
  ${introBox(T.tableIntro)}

  <div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap;align-items:center">
    ${[['model', T.showModel], ['market', T.showMarket], ['both', T.showBoth]].map(function (m) {
      var on = view === m[0];
      var dis = (m[0] !== 'model' && !hasMarket);
      return html`<button class="pressable" disabled=${dis} onClick=${function () { if (!dis) self.setState({ tblView: m[0] }); }} style=${'padding:7px 14px;border-radius:8px;border:1px solid ' + (on ? '#191D17' : '#D8D2BE') + ';background:' + (on ? '#191D17' : '#FFF') + ';color:' + (on ? '#F2EEE2' : (dis ? '#C0BAA6' : '#191D17')) + ';font-weight:600;font-size:12.5px;cursor:' + (dis ? 'default' : 'pointer')}>${m[1]}</button>`;
    })}
    ${!hasMarket && html`<span style="font-size:11px;color:#8B8770">${lang === 'en' ? 'market loading…' : '行情加载中…'}</span>`}
  </div>

  <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid #DCD6C2;border-radius:12px;background:#FFF">
    <table style="border-collapse:collapse;width:100%;min-width:${view === 'both' ? '760px' : '520px'};font-size:12.5px">
      <thead>
        <tr style="background:#F2EEE2">
          <th onClick=${function () { sortBy('team'); }} style="position:sticky;left:0;background:#F2EEE2;text-align:left;padding:9px 10px;cursor:pointer;white-space:nowrap;border-bottom:2px solid #DCD6C2;font-weight:700">${T.teamCol}${arrow('team')}</th>
          ${cols.map(function (c) {
            return html`<th onClick=${function () { sortBy(c[0]); }} style="text-align:right;padding:9px 8px;cursor:pointer;white-space:nowrap;border-bottom:2px solid #DCD6C2;font-weight:700">${c[1]}${arrow(c[0])}</th>`;
          })}
        </tr>
      </thead>
      <tbody>
        ${rows.map(function (r, ri) {
          return html`
          <tr style=${'background:' + (ri % 2 ? '#FBFAF4' : '#FFF')}>
            <td style=${'position:sticky;left:0;background:' + (ri % 2 ? '#FBFAF4' : '#FFF') + ';padding:7px 10px;white-space:nowrap;font-weight:600;border-bottom:1px solid #F0EBDC'}>${flag(r.code)} ${shortName(r.code)}</td>
            ${cols.map(function (c) {
              var mp = res.teamStage[r.code][c[0]] || 0;
              var km = mkt[c[0]];
              var kv = km ? km[r.code] : null;
              var cell;
              if (view === 'market') {
                cell = (kv != null) ? html`<span style="color:#1D5FBF;font-weight:600">${pct(kv, 0)}</span>` : html`<span style="color:#C0BAA6">—</span>`;
              } else if (view === 'both') {
                cell = html`<span style="font-weight:600">${pct(mp, 0)}</span>${(kv != null) ? html`<span style="color:#1D5FBF;font-size:10.5px;display:block">${pct(kv, 0)}</span>` : html`<span style="color:#C9C2AA;font-size:10.5px;display:block">—</span>`}`;
              } else {
                cell = html`<span style="font-weight:600">${pct(mp, mp < 0.1 ? 1 : 0)}</span>`;
              }
              // subtle heat on the model number
              var heat = view === 'market' ? 0 : Math.min(0.5, mp);
              return html`<td style=${'text-align:right;padding:7px 8px;border-bottom:1px solid #F0EBDC;background:rgba(14,140,79,' + (heat * 0.28) + ')'}>${cell}</td>`;
            })}
          </tr>`;
        })}
      </tbody>
    </table>
  </div>
  ${view === 'both' && html`<div style="font-size:11px;color:#8B8770;margin-top:8px">${lang === 'en' ? 'Top = model · bottom (blue) = Polymarket marginal' : '上行=模型 · 下行(蓝)=Polymarket 行情'}</div>`}
</section>`;
};

/* ====================================================================== *
 * WHAT-IF PANEL (collapsible, recompute + deltas)
 * ====================================================================== */
App.prototype.renderWhatif = function (T, lang) {
  var st = this.state, self = this;
  var open = st._whatifOpen;
  var activeCount = Object.keys(st.lockGroup).length + Object.keys(st.lockMatch).length;

  // group winner picker options
  var groupOpts = [{ v: '', label: T.noGroup }];
  // match picker: knockout matches (real bracket) for locking winners is complex
  // because sides resolve dynamically; we expose the simplest, highest-value
  // lever — lock a GROUP WINNER — plus a clear-all. (Knockout result locks are
  // available via the engine but need resolved sides; group locks cover the
  // "a result came in" use-case the brief calls out.)

  // delta panel: compare current champion% vs baseline champion% for top movers.
  var deltas = [];
  if (st.results && st.baseline && activeCount) {
    var codes = Object.keys(WC.TEAMS);
    codes.forEach(function (c) {
      var now = st.results.teamStage[c] ? st.results.teamStage[c].champion : 0;
      var base = st.baseline.teamStage[c] ? st.baseline.teamStage[c].champion : 0;
      var d = now - base;
      if (Math.abs(d) > 0.002) deltas.push({ code: c, d: d, now: now });
    });
    deltas.sort(function (a, b) { return Math.abs(b.d) - Math.abs(a.d); });
    deltas = deltas.slice(0, 8);
  }

  return html`
<div style="max-width:820px;margin:18px auto 0;padding:0 14px">
  <button class="presslight" onClick=${function () { self.setState({ _whatifOpen: !open }); }} style=${'width:100%;display:flex;align-items:center;gap:10px;padding:13px 15px;border:1px solid #C9D9EE;background:#E7EEF8;border-radius:' + (open ? '12px 12px 0 0' : '12px') + ';cursor:pointer;text-align:left'}>
    <span style="font-size:18px">🧪</span>
    <div style="flex:1">
      <div style="font-family:'Barlow Condensed','Noto Sans SC',sans-serif;font-size:17px;font-weight:700;color:#1D4E8C">${T.whatifTitle}</div>
      <div style="font-size:11.5px;color:#3E6196">${activeCount ? (T.activeWhatif + ': ' + activeCount) : (lang === 'en' ? 'tap to open' : '点击展开')}</div>
    </div>
    <span style="font-size:18px;color:#1D5FBF;transform:rotate(${open ? 180 : 0}deg);transition:transform .2s">⌄</span>
  </button>

  ${open && html`
  <div style="border:1px solid #C9D9EE;border-top:none;background:#F4F8FD;border-radius:0 0 12px 12px;padding:15px;animation:fadeup .2s ease">
    <div style="font-size:12.5px;color:#3E6196;margin-bottom:14px;line-height:1.6">${T.whatifIntro}</div>

    <div style="font-size:11px;letter-spacing:1px;color:#3E6196;font-weight:700;margin-bottom:8px">${T.lockGroupWinner}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-bottom:8px">
      ${Object.keys(WC.GROUPS).map(function (g) {
        var sel = st.lockGroup[g] || '';
        var opts = [{ v: '', label: g + (lang === 'en' ? ' · none' : ' · 不锁') }].concat(
          WC.GROUPS[g].map(function (c) { return { v: c, label: shortName(c) }; }));
        return html`
        <div style=${'background:#FFF;border:1px solid ' + (sel ? '#0E8C4F' : '#D8D2BE') + ';border-radius:9px;padding:6px 8px'}>
          <select value=${sel} onChange=${function (e) { self.setGroupLock(g, e.target.value); }} style="width:100%;border:none;background:none;font-size:13px;font-weight:600;color:#191D17;padding:2px">
            ${opts.map(function (o) { return html`<option value=${o.v}>${(o.v ? (flag(o.v) + ' ') : '') + o.label}</option>`; })}
          </select>
        </div>`;
      })}
    </div>

    <div style="display:flex;gap:8px;align-items:center;margin-top:10px">
      <button class="pressable" onClick=${function () { self.clearWhatif(); }} style="padding:7px 14px;border-radius:8px;border:1px solid #E3C7C2;background:#FFF;color:#A23227;font-size:12.5px;font-weight:600;cursor:pointer">${T.clearAll}</button>
      ${st.recomputing && html`<span style="font-size:12px;color:#1D5FBF;display:flex;align-items:center;gap:6px"><span style="width:11px;height:11px;border:2px solid rgba(29,95,191,.3);border-top-color:#1D5FBF;border-radius:50%;display:inline-block;animation:spin .7s linear infinite"></span>${T.recomputing}</span>`}
    </div>

    ${deltas.length > 0 && html`
    <div style="margin-top:16px;padding-top:14px;border-top:1px solid #D6E2F0">
      <div style="font-size:11px;letter-spacing:1px;color:#3E6196;font-weight:700;margin-bottom:9px">${T.delta} · ${T.champion}</div>
      ${deltas.map(function (x) {
        var up = x.d > 0;
        return html`
        <div style="display:flex;align-items:center;gap:9px;padding:4px 0">
          <span style="min-width:74px;flex:none;font-size:13px;font-weight:600">${flag(x.code)} ${shortName(x.code)}</span>
          <span style="flex:1;display:flex;justify-content:center">
            <span style=${'display:flex;align-items:center;gap:5px;font-size:12.5px;font-weight:700;color:' + (up ? '#0E8C4F' : '#C8332B')}>
              ${up ? '▲' : '▼'} ${(Math.abs(x.d) * 100).toFixed(1)}pp
            </span>
          </span>
          <span style="width:48px;flex:none;text-align:right;font-size:12px;color:#6B7263">${pct(x.now, 1)}</span>
        </div>`;
      })}
    </div>`}
  </div>`}
</div>`;
};

/* ---------------- mount -------------------------------------------------- */
if (!WC || !ENG) {
  document.getElementById('app').innerHTML =
    '<div style="padding:40px;font-family:sans-serif;color:#A23227">data.js / engine.js failed to load.</div>';
} else {
  try {
    render(h(App), document.getElementById('app'));
  } catch (e) {
    console.error('WCO mount error:', e && e.stack || e);
    var appEl = document.getElementById('app');
    appEl.replaceChildren();
    var pre = document.createElement('pre');
    pre.style.cssText = 'padding:20px;color:#A23227;white-space:pre-wrap;font:12px monospace';
    pre.textContent = 'mount error: ' + String(e && e.stack || e);
    appEl.appendChild(pre);
  }
}

})();
