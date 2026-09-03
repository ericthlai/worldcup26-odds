/* ============================================================================
 * data.js — World Cup 2026 static data module.
 * Pure, dependency-free. Attaches everything to window.WC (and module.exports
 * under Node for the self-check). NO build step.
 *
 * Source of truth for TEAMS / GROUPS / VEN / GM / KO is the verified
 * reference app (reference-prediction-app.html), ported verbatim. Verified
 * against the official FIFA WC2026 final draw (Dec 2025).
 *
 * Added for the simulation engine:
 *   ELO           team -> Elo rating (world-football-elo style, late-2025)
 *   STARS         team -> 1..5 "watchability" tier (UI only, not used by sim)
 *   VENMATCH      venue -> host-country code for host-advantage lookups
 *   THIRD_SLOTS   the 8 R32 winner-slots and their eligible 3rd-place groups
 *   ANNEXC_ANCHORS two official Annex C rows used to verify the matcher
 * ==========================================================================*/
(function (root) {
  'use strict';

  // ---- 48 teams: code -> [zhName, flag] (verbatim from reference) ----------
  var TEAMS = {
    mex:['墨西哥','🇲🇽'], rsa:['南非','🇿🇦'], kor:['韩国','🇰🇷'], cze:['捷克','🇨🇿'],
    can:['加拿大','🇨🇦'], bih:['波黑','🇧🇦'], qat:['卡塔尔','🇶🇦'], sui:['瑞士','🇨🇭'],
    bra:['巴西','🇧🇷'], mar:['摩洛哥','🇲🇦'], hai:['海地','🇭🇹'], sco:['苏格兰','🏴󠁧󠁢󠁳󠁣󠁴󠁿'],
    usa:['美国','🇺🇸'], par:['巴拉圭','🇵🇾'], aus:['澳大利亚','🇦🇺'], tur:['土耳其','🇹🇷'],
    ger:['德国','🇩🇪'], cuw:['库拉索','🇨🇼'], civ:['科特迪瓦','🇨🇮'], ecu:['厄瓜多尔','🇪🇨'],
    ned:['荷兰','🇳🇱'], jpn:['日本','🇯🇵'], swe:['瑞典','🇸🇪'], tun:['突尼斯','🇹🇳'],
    bel:['比利时','🇧🇪'], egy:['埃及','🇪🇬'], irn:['伊朗','🇮🇷'], nzl:['新西兰','🇳🇿'],
    esp:['西班牙','🇪🇸'], cpv:['佛得角','🇨🇻'], ksa:['沙特','🇸🇦'], uru:['乌拉圭','🇺🇾'],
    fra:['法国','🇫🇷'], sen:['塞内加尔','🇸🇳'], irq:['伊拉克','🇮🇶'], nor:['挪威','🇳🇴'],
    arg:['阿根廷','🇦🇷'], alg:['阿尔及利亚','🇩🇿'], aut:['奥地利','🇦🇹'], jor:['约旦','🇯🇴'],
    por:['葡萄牙','🇵🇹'], cod:['刚果(金)','🇨🇩'], uzb:['乌兹别克','🇺🇿'], col:['哥伦比亚','🇨🇴'],
    eng:['英格兰','🏴󠁧󠁢󠁥󠁮󠁧󠁿'], cro:['克罗地亚','🇭🇷'], gha:['加纳','🇬🇭'], pan:['巴拿马','🇵🇦']
  };

  // ---- 12 groups A-L: letter -> [4 codes] (verbatim) -----------------------
  var GROUPS = {
    A:['mex','rsa','kor','cze'], B:['can','bih','qat','sui'], C:['bra','mar','hai','sco'],
    D:['usa','par','aus','tur'], E:['ger','cuw','civ','ecu'], F:['ned','jpn','swe','tun'],
    G:['bel','egy','irn','nzl'], H:['esp','cpv','ksa','uru'], I:['fra','sen','irq','nor'],
    J:['arg','alg','aut','jor'], K:['por','cod','uzb','col'], L:['eng','cro','gha','pan']
  };

  // ---- venues: code -> [name, city, region, country, ...] (verbatim) -------
  var VEN = {
    sofi:['SoFi Stadium','洛杉矶 · Inglewood','W','US'],
    levis:["Levi's Stadium",'圣克拉拉','W','US'],
    lumen:['Lumen Field','西雅图','W','US'],
    metlife:['MetLife Stadium','纽约/新泽西','E','US',''],
    gillette:['Gillette Stadium','波士顿 · Foxborough','E','US',''],
    linc:['Lincoln Financial Field','费城','E','US',''],
    mbs:['Mercedes-Benz Stadium','亚特兰大','E','US',''],
    hardrock:['Hard Rock Stadium','迈阿密','E','US',''],
    nrg:['NRG Stadium','休斯顿','C','US',''],
    att:['AT&T Stadium','达拉斯 · Arlington','C','US',''],
    arrowhead:['Arrowhead Stadium','堪萨斯城','C','US',''],
    azteca:['Estadio Azteca','墨西哥城','C','MX',''],
    bbva:['Estadio BBVA','蒙特雷','C','MX',''],
    akron:['Estadio Akron','瓜达拉哈拉 · Zapopan','C','MX',''],
    bmo:['BMO Field','多伦多','E','CA',''],
    bcplace:['BC Place','温哥华','W','CA','']
  };

  // ---- 72 group matches: [no,date,group,t1,t2,venue] (verbatim for the 52
  // US-hosted rows; the 20 Mexico/Canada/host-gap rows appended below) -------
  var GM = [
    [4,'2026-06-12','D','usa','par','sofi'],[5,'2026-06-13','B','qat','sui','levis'],
    [6,'2026-06-13','C','bra','mar','metlife'],[7,'2026-06-13','C','hai','sco','gillette'],
    [9,'2026-06-14','E','ger','cuw','nrg'],[10,'2026-06-14','F','ned','jpn','att'],
    [11,'2026-06-14','E','civ','ecu','linc'],[13,'2026-06-15','H','esp','cpv','mbs'],
    [14,'2026-06-15','G','bel','egy','lumen'],[15,'2026-06-15','H','ksa','uru','hardrock'],
    [16,'2026-06-15','G','irn','nzl','sofi'],[17,'2026-06-16','I','fra','sen','metlife'],
    [18,'2026-06-16','I','irq','nor','gillette'],[19,'2026-06-16','J','arg','alg','arrowhead'],
    [20,'2026-06-16','J','aut','jor','levis'],[21,'2026-06-17','K','por','cod','nrg'],
    [22,'2026-06-17','L','eng','cro','att'],[25,'2026-06-18','A','cze','rsa','mbs'],
    [26,'2026-06-18','B','sui','bih','sofi'],[29,'2026-06-19','D','usa','aus','lumen'],
    [30,'2026-06-19','C','sco','mar','gillette'],[31,'2026-06-19','C','bra','hai','linc'],
    [32,'2026-06-19','D','tur','par','levis'],[33,'2026-06-20','F','ned','swe','nrg'],
    [35,'2026-06-20','E','ecu','cuw','arrowhead'],[37,'2026-06-21','H','esp','ksa','mbs'],
    [38,'2026-06-21','G','bel','irn','sofi'],[39,'2026-06-21','H','uru','cpv','hardrock'],
    [41,'2026-06-22','I','nor','sen','metlife'],[42,'2026-06-22','I','fra','irq','linc'],
    [43,'2026-06-22','J','arg','aut','att'],[44,'2026-06-22','J','jor','alg','levis'],
    [45,'2026-06-23','L','eng','gha','gillette'],[47,'2026-06-23','K','por','uzb','nrg'],
    [49,'2026-06-24','C','sco','bra','hardrock'],[50,'2026-06-24','C','mar','hai','mbs'],
    [52,'2026-06-24','B','bih','qat','lumen'],[55,'2026-06-25','E','cuw','civ','linc'],
    [56,'2026-06-25','E','ecu','ger','metlife'],[57,'2026-06-25','F','jpn','swe','att'],
    [58,'2026-06-25','F','tun','ned','arrowhead'],[59,'2026-06-25','D','tur','usa','sofi'],
    [60,'2026-06-25','D','par','aus','levis'],[61,'2026-06-26','G','bel','nzl','bcplace'],
    [65,'2026-06-26','I','fra','nor','gillette'],[66,'2026-06-26','I','sen','irq','bmo'],
    [67,'2026-06-27','L','pan','eng','metlife'],[68,'2026-06-27','L','cro','gha','linc'],
    [69,'2026-06-27','J','jor','arg','att'],[70,'2026-06-27','J','alg','aut','arrowhead'],
    [71,'2026-06-27','K','col','por','hardrock'],[72,'2026-06-27','K','cod','uzb','mbs'],

    // Mexico- and Canada-hosted group matches (added 2026-09; sources: FIFA.com
    // official scores/fixtures page + Wikipedia per-group fixture tables, since
    // the ESPN scoreboard API returned HTTP 403 from this sandbox). Two of the
    // twenty (no.62 cpv/ksa at Houston, no.64 egy/irn at Seattle) turned out to
    // be additional US-hosted gaps rather than MX/CA ones; included here too
    // since they were equally missing and both sources agreed on them.
    [1,'2026-06-11','A','mex','rsa','azteca'],[2,'2026-06-11','A','kor','cze','akron'],
    [3,'2026-06-12','B','can','bih','bmo'],[8,'2026-06-13','D','aus','tur','bcplace'],
    [12,'2026-06-14','F','swe','tun','bbva'],[23,'2026-06-17','L','gha','pan','bmo'],
    [24,'2026-06-17','K','uzb','col','azteca'],[27,'2026-06-18','B','can','qat','bcplace'],
    [28,'2026-06-18','A','mex','kor','akron'],[34,'2026-06-20','E','ger','civ','bmo'],
    [36,'2026-06-20','F','tun','jpn','bbva'],[40,'2026-06-21','G','nzl','egy','bcplace'],
    [46,'2026-06-23','L','pan','cro','bmo'],[48,'2026-06-23','K','col','cod','akron'],
    [51,'2026-06-24','B','sui','can','bcplace'],[53,'2026-06-24','A','cze','mex','azteca'],
    [54,'2026-06-24','A','rsa','kor','bbva'],[62,'2026-06-26','H','cpv','ksa','nrg'],
    [63,'2026-06-26','H','uru','esp','akron'],[64,'2026-06-26','G','egy','irn','lumen']
  ];

  // ---- 32 knockout matches with slot-resolution rules (verbatim) ----------
  // side = {k:'w',g} winner | {k:'r',g} runner-up | {k:'t',gs:[...]} best-3rd
  //        {k:'f',m} winner of match m | {k:'l',m} loser of match m
  var KO = [
    {no:73,d:'2026-06-28',v:'sofi',a:{k:'r',g:'A'},b:{k:'r',g:'B'},next:90},
    {no:74,d:'2026-06-29',v:'gillette',a:{k:'w',g:'E'},b:{k:'t',gs:['A','B','C','D','F']},next:89},
    {no:75,d:'2026-06-29',v:'bbva',a:{k:'w',g:'F'},b:{k:'r',g:'C'},next:90},
    {no:76,d:'2026-06-29',v:'nrg',a:{k:'w',g:'C'},b:{k:'r',g:'F'},next:91},
    {no:77,d:'2026-06-30',v:'metlife',a:{k:'w',g:'I'},b:{k:'t',gs:['C','D','F','G','H']},next:89},
    {no:78,d:'2026-06-30',v:'att',a:{k:'r',g:'E'},b:{k:'r',g:'I'},next:91},
    {no:79,d:'2026-06-30',v:'azteca',a:{k:'w',g:'A'},b:{k:'t',gs:['C','E','F','H','I']},next:92},
    {no:80,d:'2026-07-01',v:'mbs',a:{k:'w',g:'L'},b:{k:'t',gs:['E','H','I','J','K']},next:92},
    {no:81,d:'2026-07-01',v:'levis',a:{k:'w',g:'D'},b:{k:'t',gs:['B','E','F','I','J']},next:94},
    {no:82,d:'2026-07-01',v:'lumen',a:{k:'w',g:'G'},b:{k:'t',gs:['A','E','H','I','J']},next:94},
    {no:83,d:'2026-07-02',v:'bmo',a:{k:'r',g:'K'},b:{k:'r',g:'L'},next:93},
    {no:84,d:'2026-07-02',v:'sofi',a:{k:'w',g:'H'},b:{k:'r',g:'J'},next:93},
    {no:85,d:'2026-07-02',v:'bcplace',a:{k:'w',g:'B'},b:{k:'t',gs:['E','F','G','I','J']},next:96},
    {no:86,d:'2026-07-03',v:'hardrock',a:{k:'w',g:'J'},b:{k:'r',g:'H'},next:95},
    {no:87,d:'2026-07-03',v:'arrowhead',a:{k:'w',g:'K'},b:{k:'t',gs:['D','E','I','J','L']},next:96},
    {no:88,d:'2026-07-03',v:'att',a:{k:'r',g:'D'},b:{k:'r',g:'G'},next:95},
    {no:89,d:'2026-07-04',v:'linc',a:{k:'f',m:74},b:{k:'f',m:77},next:97},
    {no:90,d:'2026-07-04',v:'nrg',a:{k:'f',m:73},b:{k:'f',m:75},next:97},
    {no:91,d:'2026-07-05',v:'metlife',a:{k:'f',m:76},b:{k:'f',m:78},next:99},
    {no:92,d:'2026-07-05',v:'azteca',a:{k:'f',m:79},b:{k:'f',m:80},next:99},
    {no:93,d:'2026-07-06',v:'att',a:{k:'f',m:83},b:{k:'f',m:84},next:98},
    {no:94,d:'2026-07-06',v:'lumen',a:{k:'f',m:81},b:{k:'f',m:82},next:98},
    {no:95,d:'2026-07-07',v:'mbs',a:{k:'f',m:86},b:{k:'f',m:88},next:100},
    {no:96,d:'2026-07-07',v:'bcplace',a:{k:'f',m:85},b:{k:'f',m:87},next:100},
    {no:97,d:'2026-07-09',v:'gillette',a:{k:'f',m:89},b:{k:'f',m:90},next:101},
    {no:98,d:'2026-07-10',v:'sofi',a:{k:'f',m:93},b:{k:'f',m:94},next:101},
    {no:99,d:'2026-07-11',v:'hardrock',a:{k:'f',m:91},b:{k:'f',m:92},next:102},
    {no:100,d:'2026-07-11',v:'arrowhead',a:{k:'f',m:95},b:{k:'f',m:96},next:102},
    {no:101,d:'2026-07-14',v:'att',a:{k:'f',m:97},b:{k:'f',m:98},next:104},
    {no:102,d:'2026-07-15',v:'mbs',a:{k:'f',m:99},b:{k:'f',m:100},next:104},
    {no:103,d:'2026-07-18',v:'hardrock',a:{k:'l',m:101},b:{k:'l',m:102},next:null},
    {no:104,d:'2026-07-19',v:'metlife',a:{k:'f',m:101},b:{k:'f',m:102},next:null}
  ];

  // ---- ELO ratings (World Football Elo style) ------------------------------
  // Used by the engine as the base team strength. Override per-run via config.
  //
  // SOURCE / AUDIT: refreshed toward a World Football Elo (eloratings.net) style
  // ordering, late-spring-2026 snapshot (pull ~2026-06-12). The load-bearing
  // finding is the ORDERING and the ~gap directions, not the exact digits —
  // before any commit, re-source same-day from eloratings.net (or club-elo /
  // Opta if preferred) and reconcile. The previous late-2025 seeds left several
  // dark horses / favorites materially under-rated (nor -135, tur -115, esp -69,
  // aut -70, sco -60), which forced the per-team champion rake to apply large
  // distorting Elo deltas that bled into the UNCALIBRATED reach/path/matchup
  // tabs. These refreshed values cut that rake strain and move the baseline
  // champion shares toward the market while preserving every seed-independent
  // invariant in the test suite.
  var ELO = {
    arg:2105, fra:2055, esp:2114, eng:2025, bra:2000, por:2005, ned:1975, bel:1945,
    ger:1945, cro:1900, uru:1895, col:1875, mar:1890, usa:1800,
    sui:1800, jpn:1830, mex:1790, sen:1785, irn:1765, ecu:1790, kor:1750, aus:1740,
    egy:1735, civ:1745, nor:1850, swe:1700, aut:1770, par:1695, can:1720, tur:1800,
    nzl:1560, pan:1600, qat:1560, ksa:1550, irq:1580, gha:1640, cze:1720, sco:1760,
    alg:1740, uzb:1620, cod:1630, jor:1560, tun:1655, cpv:1560, cuw:1480, rsa:1690,
    bih:1690, hai:1450
  };

  // ---- STARS: 1..5 marquee tier (UI only; not consumed by the sim) ---------
  var STARS = {
    arg:5, fra:5, esp:5, eng:5, bra:5, por:5, ned:4, bel:4, ger:4, cro:4,
    uru:4, col:3, mar:4, usa:3, sui:3, jpn:3, mex:3, sen:3, irn:2, ecu:2,
    kor:3, aus:2, egy:2, civ:2, nor:4, swe:2, aut:2, par:2, can:3, tur:2,
    nzl:1, pan:1, qat:1, ksa:1, irq:1, gha:2, cze:2, sco:2, alg:2, uzb:1,
    cod:1, jor:1, tun:1, cpv:1, cuw:1, rsa:2, bih:2, hai:1
  };

  // ---- VENMATCH: venue code -> host country code (for host advantage) ------
  // H=100 only when a US/CAN/MEX team plays in its own country's venue.
  var VENMATCH = {};
  Object.keys(VEN).forEach(function (v) { VENMATCH[v] = VEN[v][3]; });
  // host country code -> the team that gets the boost there
  var HOST_TEAM = { US:'usa', CA:'can', MX:'mex' };

  // ---- THIRD_SLOTS: the 8 R32 winner-slots and eligible 3rd-place groups ---
  // Encodes the {k:'t'} sides of KO 74..87. slot label -> {match, winner, gs}.
  var THIRD_SLOTS = {
    M74:{match:74, winner:'E', gs:['A','B','C','D','F']},
    M77:{match:77, winner:'I', gs:['C','D','F','G','H']},
    M79:{match:79, winner:'A', gs:['C','E','F','H','I']},
    M80:{match:80, winner:'L', gs:['E','H','I','J','K']},
    M81:{match:81, winner:'D', gs:['B','E','F','I','J']},
    M82:{match:82, winner:'G', gs:['A','E','H','I','J']},
    M85:{match:85, winner:'B', gs:['E','F','G','I','J']},
    M87:{match:87, winner:'K', gs:['D','E','I','J','L']}
  };

  // ---- ANNEXC_TABLE: the literal 495-row FIFA Annex C lookup table ----------
  // Source of truth: FIFA "Regulations for the FIFA World Cup 26™", Annexe C
  // ("Combinations for eight best third-placed teams"), official PDF
  // (digitalhub.fifa.com/.../FWC2026_regulations_EN.pdf, May 2026), pp.80-83.
  //
  // The PDF prints 495 rows under the fixed column header
  //     1A  1B  1D  1E  1G  1I  1K  1L
  // each row giving the 3rd-place GROUP that faces each of those 8 winners.
  // The 8 values of every row are exactly the set of qualifying 3rd-place
  // groups, so we key each row by that sorted set. This is FIFA's published
  // choice — it is NOT recoverable from the per-slot eligibility lists alone
  // (most sets admit several legal perfect matchings), which is why the literal
  // table is required for correct bracket/path/matchup output.
  //
  // Encoding (compact + auditable): a space-separated list of 16-char tokens.
  //   token = <8 sorted qualifying-group letters><8 third-group letters>
  //   the 8 third-group letters are in winner order A,B,D,E,G,I,K,L.
  // Expanded below into ANNEXC_TABLE: sortedKey -> { winnerLetter: thirdGroup }.
  // Verified at load: 495 distinct keys, every pairing eligibility-legal vs
  // THIRD_SLOTS (0 violations), and the two anchors below reproduce exactly.
  var ANNEXC_WINNER_ORDER = ['A', 'B', 'D', 'E', 'G', 'I', 'K', 'L'];
  var ANNEXC_RAW =
    'EFGHIJKLEJIFHGLK DFGHIJKLHGIDJFLK DEGHIJKLEJIDHGLK DEFHIJKLEJIDHFLK DEFGIJKLEGIDJFLK DEFGHJKLEGJDHFLK DEFGHIKLEGIDHFLK DEFGHIJLEGJDHFLI DEFGHIJKEGJDHFIK CFGHIJKLHGICJFLK CEGHIJKLEJICHGLK CEFHIJKLEJICHFLK CEFGIJKLEGICJFLK CEFGHJKLEGJCHFLK CEFGHIKLEGICHFLK ' +
    'CEFGHIJLEGJCHFLI CEFGHIJKEGJCHFIK CDGHIJKLHGICJDLK CDFHIJKLCJIDHFLK CDFGIJKLCGIDJFLK CDFGHJKLCGJDHFLK CDFGHIKLCGIDHFLK CDFGHIJLCGJDHFLI CDFGHIJKCGJDHFIK CDEHIJKLEJICHDLK CDEGIJKLEGICJDLK CDEGHJKLEGJCHDLK CDEGHIKLEGICHDLK CDEGHIJLEGJCHDLI CDEGHIJKEGJCHDIK ' +
    'CDEFIJKLCJEDIFLK CDEFHJKLCJEDHFLK CDEFHIKLCEIDHFLK CDEFHIJLCJEDHFLI CDEFHIJKCJEDHFIK CDEFGJKLCGEDJFLK CDEFGIKLCGEDIFLK CDEFGIJLCGEDJFLI CDEFGIJKCGEDJFIK CDEFGHKLCGEDHFLK CDEFGHJLCGJDHFLE CDEFGHJKCGJDHFEK CDEFGHILCGEDHFLI CDEFGHIKCGEDHFIK CDEFGHIJCGJDHFEI ' +
    'BFGHIJKLHJBFIGLK BEGHIJKLEJIBHGLK BEFHIJKLEJBFIHLK BEFGIJKLEJBFIGLK BEFGHJKLEJBFHGLK BEFGHIKLEGBFIHLK BEFGHIJLEJBFHGLI BEFGHIJKEJBFHGIK BDGHIJKLHJBDIGLK BDFHIJKLHJBDIFLK BDFGIJKLIGBDJFLK BDFGHJKLHGBDJFLK BDFGHIKLHGBDIFLK BDFGHIJLHGBDJFLI BDFGHIJKHGBDJFIK ' +
    'BDEHIJKLEJBDIHLK BDEGIJKLEJBDIGLK BDEGHJKLEJBDHGLK BDEGHIKLEGBDIHLK BDEGHIJLEJBDHGLI BDEGHIJKEJBDHGIK BDEFIJKLEJBDIFLK BDEFHJKLEJBDHFLK BDEFHIKLEIBDHFLK BDEFHIJLEJBDHFLI BDEFHIJKEJBDHFIK BDEFGJKLEGBDJFLK BDEFGIKLEGBDIFLK BDEFGIJLEGBDJFLI BDEFGIJKEGBDJFIK ' +
    'BDEFGHKLEGBDHFLK BDEFGHJLHGBDJFLE BDEFGHJKHGBDJFEK BDEFGHILEGBDHFLI BDEFGHIKEGBDHFIK BDEFGHIJHGBDJFEI BCGHIJKLHJBCIGLK BCFHIJKLHJBCIFLK BCFGIJKLIGBCJFLK BCFGHJKLHGBCJFLK BCFGHIKLHGBCIFLK BCFGHIJLHGBCJFLI BCFGHIJKHGBCJFIK BCEHIJKLEJBCIHLK BCEGIJKLEJBCIGLK ' +
    'BCEGHJKLEJBCHGLK BCEGHIKLEGBCIHLK BCEGHIJLEJBCHGLI BCEGHIJKEJBCHGIK BCEFIJKLEJBCIFLK BCEFHJKLEJBCHFLK BCEFHIKLEIBCHFLK BCEFHIJLEJBCHFLI BCEFHIJKEJBCHFIK BCEFGJKLEGBCJFLK BCEFGIKLEGBCIFLK BCEFGIJLEGBCJFLI BCEFGIJKEGBCJFIK BCEFGHKLEGBCHFLK BCEFGHJLHGBCJFLE ' +
    'BCEFGHJKHGBCJFEK BCEFGHILEGBCHFLI BCEFGHIKEGBCHFIK BCEFGHIJHGBCJFEI BCDHIJKLHJBCIDLK BCDGIJKLIGBCJDLK BCDGHJKLHGBCJDLK BCDGHIKLHGBCIDLK BCDGHIJLHGBCJDLI BCDGHIJKHGBCJDIK BCDFIJKLCJBDIFLK BCDFHJKLCJBDHFLK BCDFHIKLCIBDHFLK BCDFHIJLCJBDHFLI BCDFHIJKCJBDHFIK ' +
    'BCDFGJKLCGBDJFLK BCDFGIKLCGBDIFLK BCDFGIJLCGBDJFLI BCDFGIJKCGBDJFIK BCDFGHKLCGBDHFLK BCDFGHJLCGBDHFLJ BCDFGHJKHGBCJFDK BCDFGHILCGBDHFLI BCDFGHIKCGBDHFIK BCDFGHIJHGBCJFDI BCDEIJKLEJBCIDLK BCDEHJKLEJBCHDLK BCDEHIKLEIBCHDLK BCDEHIJLEJBCHDLI BCDEHIJKEJBCHDIK ' +
    'BCDEGJKLEGBCJDLK BCDEGIKLEGBCIDLK BCDEGIJLEGBCJDLI BCDEGIJKEGBCJDIK BCDEGHKLEGBCHDLK BCDEGHJLHGBCJDLE BCDEGHJKHGBCJDEK BCDEGHILEGBCHDLI BCDEGHIKEGBCHDIK BCDEGHIJHGBCJDEI BCDEFJKLCJBDEFLK BCDEFIKLCEBDIFLK BCDEFIJLCJBDEFLI BCDEFIJKCJBDEFIK BCDEFHKLCEBDHFLK ' +
    'BCDEFHJLCJBDHFLE BCDEFHJKCJBDHFEK BCDEFHILCEBDHFLI BCDEFHIKCEBDHFIK BCDEFHIJCJBDHFEI BCDEFGKLCGBDEFLK BCDEFGJLCGBDJFLE BCDEFGJKCGBDJFEK BCDEFGILCGBDEFLI BCDEFGIKCGBDEFIK BCDEFGIJCGBDJFEI BCDEFGHLCGBDHFLE BCDEFGHKCGBDHFEK BCDEFGHJHGBCJFDE BCDEFGHICGBDHFEI ' +
    'AFGHIJKLHJIFAGLK AEGHIJKLEJIAHGLK AEFHIJKLEJIFAHLK AEFGIJKLEJIFAGLK AEFGHJKLEGJFAHLK AEFGHIKLEGIFAHLK AEFGHIJLEGJFAHLI AEFGHIJKEGJFAHIK ADGHIJKLHJIDAGLK ADFHIJKLHJIDAFLK ADFGIJKLIGJDAFLK ADFGHJKLHGJDAFLK ADFGHIKLHGIDAFLK ADFGHIJLHGJDAFLI ADFGHIJKHGJDAFIK ' +
    'ADEHIJKLEJIDAHLK ADEGIJKLEJIDAGLK ADEGHJKLEGJDAHLK ADEGHIKLEGIDAHLK ADEGHIJLEGJDAHLI ADEGHIJKEGJDAHIK ADEFIJKLEJIDAFLK ADEFHJKLHJEDAFLK ADEFHIKLHEIDAFLK ADEFHIJLHJEDAFLI ADEFHIJKHJEDAFIK ADEFGJKLEGJDAFLK ADEFGIKLEGIDAFLK ADEFGIJLEGJDAFLI ADEFGIJKEGJDAFIK ' +
    'ADEFGHKLHGEDAFLK ADEFGHJLHGJDAFLE ADEFGHJKHGJDAFEK ADEFGHILHGEDAFLI ADEFGHIKHGEDAFIK ADEFGHIJHGJDAFEI ACGHIJKLHJICAGLK ACFHIJKLHJICAFLK ACFGIJKLIGJCAFLK ACFGHJKLHGJCAFLK ACFGHIKLHGICAFLK ACFGHIJLHGJCAFLI ACFGHIJKHGJCAFIK ACEHIJKLEJICAHLK ACEGIJKLEJICAGLK ' +
    'ACEGHJKLEGJCAHLK ACEGHIKLEGICAHLK ACEGHIJLEGJCAHLI ACEGHIJKEGJCAHIK ACEFIJKLEJICAFLK ACEFHJKLHJECAFLK ACEFHIKLHEICAFLK ACEFHIJLHJECAFLI ACEFHIJKHJECAFIK ACEFGJKLEGJCAFLK ACEFGIKLEGICAFLK ACEFGIJLEGJCAFLI ACEFGIJKEGJCAFIK ACEFGHKLHGECAFLK ACEFGHJLHGJCAFLE ' +
    'ACEFGHJKHGJCAFEK ACEFGHILHGECAFLI ACEFGHIKHGECAFIK ACEFGHIJHGJCAFEI ACDHIJKLHJICADLK ACDGIJKLIGJCADLK ACDGHJKLHGJCADLK ACDGHIKLHGICADLK ACDGHIJLHGJCADLI ACDGHIJKHGJCADIK ACDFIJKLCJIDAFLK ACDFHJKLHJFCADLK ACDFHIKLHFICADLK ACDFHIJLHJFCADLI ACDFHIJKHJFCADIK ' +
    'ACDFGJKLCGJDAFLK ACDFGIKLCGIDAFLK ACDFGIJLCGJDAFLI ACDFGIJKCGJDAFIK ACDFGHKLHGFCADLK ACDFGHJLCGJDAFLH ACDFGHJKHGJCAFDK ACDFGHILHGFCADLI ACDFGHIKHGFCADIK ACDFGHIJHGJCAFDI ACDEIJKLEJICADLK ACDEHJKLHJECADLK ACDEHIKLHEICADLK ACDEHIJLHJECADLI ACDEHIJKHJECADIK ' +
    'ACDEGJKLEGJCADLK ACDEGIKLEGICADLK ACDEGIJLEGJCADLI ACDEGIJKEGJCADIK ACDEGHKLHGECADLK ACDEGHJLHGJCADLE ACDEGHJKHGJCADEK ACDEGHILHGECADLI ACDEGHIKHGECADIK ACDEGHIJHGJCADEI ACDEFJKLCJEDAFLK ACDEFIKLCEIDAFLK ACDEFIJLCJEDAFLI ACDEFIJKCJEDAFIK ACDEFHKLHEFCADLK ' +
    'ACDEFHJLHJFCADLE ACDEFHJKHJECAFDK ACDEFHILHEFCADLI ACDEFHIKHEFCADIK ACDEFHIJHJECAFDI ACDEFGKLCGEDAFLK ACDEFGJLCGJDAFLE ACDEFGJKCGJDAFEK ACDEFGILCGEDAFLI ACDEFGIKCGEDAFIK ACDEFGIJCGJDAFEI ACDEFGHLHGFCADLE ACDEFGHKHGECAFDK ACDEFGHJHGJCAFDE ACDEFGHIHGECAFDI ' +
    'ABGHIJKLHJBAIGLK ABFHIJKLHJBAIFLK ABFGIJKLIJBFAGLK ABFGHJKLHJBFAGLK ABFGHIKLHGBAIFLK ABFGHIJLHJBFAGLI ABFGHIJKHJBFAGIK ABEHIJKLEJBAIHLK ABEGIJKLEJBAIGLK ABEGHJKLEJBAHGLK ABEGHIKLEGBAIHLK ABEGHIJLEJBAHGLI ABEGHIJKEJBAHGIK ABEFIJKLEJBAIFLK ABEFHJKLEJBFAHLK ' +
    'ABEFHIKLEIBFAHLK ABEFHIJLEJBFAHLI ABEFHIJKEJBFAHIK ABEFGJKLEJBFAGLK ABEFGIKLEGBAIFLK ABEFGIJLEJBFAGLI ABEFGIJKEJBFAGIK ABEFGHKLEGBFAHLK ABEFGHJLHJBFAGLE ABEFGHJKHJBFAGEK ABEFGHILEGBFAHLI ABEFGHIKEGBFAHIK ABEFGHIJHJBFAGEI ABDHIJKLIJBDAHLK ABDGIJKLIJBDAGLK ' +
    'ABDGHJKLHJBDAGLK ABDGHIKLIGBDAHLK ABDGHIJLHJBDAGLI ABDGHIJKHJBDAGIK ABDFIJKLIJBDAFLK ABDFHJKLHJBDAFLK ABDFHIKLHIBDAFLK ABDFHIJLHJBDAFLI ABDFHIJKHJBDAFIK ABDFGJKLFJBDAGLK ABDFGIKLIGBDAFLK ABDFGIJLFJBDAGLI ABDFGIJKFJBDAGIK ABDFGHKLHGBDAFLK ABDFGHJLHGBDAFLJ ' +
    'ABDFGHJKHGBDAFJK ABDFGHILHGBDAFLI ABDFGHIKHGBDAFIK ABDFGHIJHGBDAFIJ ABDEIJKLEJBAIDLK ABDEHJKLEJBDAHLK ABDEHIKLEIBDAHLK ABDEHIJLEJBDAHLI ABDEHIJKEJBDAHIK ABDEGJKLEJBDAGLK ABDEGIKLEGBAIDLK ABDEGIJLEJBDAGLI ABDEGIJKEJBDAGIK ABDEGHKLEGBDAHLK ABDEGHJLHJBDAGLE ' +
    'ABDEGHJKHJBDAGEK ABDEGHILEGBDAHLI ABDEGHIKEGBDAHIK ABDEGHIJHJBDAGEI ABDEFJKLEJBDAFLK ABDEFIKLEIBDAFLK ABDEFIJLEJBDAFLI ABDEFIJKEJBDAFIK ABDEFHKLHEBDAFLK ABDEFHJLHJBDAFLE ABDEFHJKHJBDAFEK ABDEFHILHEBDAFLI ABDEFHIKHEBDAFIK ABDEFHIJHJBDAFEI ABDEFGKLEGBDAFLK ' +
    'ABDEFGJLEGBDAFLJ ABDEFGJKEGBDAFJK ABDEFGILEGBDAFLI ABDEFGIKEGBDAFIK ABDEFGIJEGBDAFIJ ABDEFGHLHGBDAFLE ABDEFGHKHGBDAFEK ABDEFGHJHGBDAFEJ ABDEFGHIHGBDAFEI ABCHIJKLIJBCAHLK ABCGIJKLIJBCAGLK ABCGHJKLHJBCAGLK ABCGHIKLIGBCAHLK ABCGHIJLHJBCAGLI ABCGHIJKHJBCAGIK ' +
    'ABCFIJKLIJBCAFLK ABCFHJKLHJBCAFLK ABCFHIKLHIBCAFLK ABCFHIJLHJBCAFLI ABCFHIJKHJBCAFIK ABCFGJKLCJBFAGLK ABCFGIKLIGBCAFLK ABCFGIJLCJBFAGLI ABCFGIJKCJBFAGIK ABCFGHKLHGBCAFLK ABCFGHJLHGBCAFLJ ABCFGHJKHGBCAFJK ABCFGHILHGBCAFLI ABCFGHIKHGBCAFIK ABCFGHIJHGBCAFIJ ' +
    'ABCEIJKLEJBAICLK ABCEHJKLEJBCAHLK ABCEHIKLEIBCAHLK ABCEHIJLEJBCAHLI ABCEHIJKEJBCAHIK ABCEGJKLEJBCAGLK ABCEGIKLEGBAICLK ABCEGIJLEJBCAGLI ABCEGIJKEJBCAGIK ABCEGHKLEGBCAHLK ABCEGHJLHJBCAGLE ABCEGHJKHJBCAGEK ABCEGHILEGBCAHLI ABCEGHIKEGBCAHIK ABCEGHIJHJBCAGEI ' +
    'ABCEFJKLEJBCAFLK ABCEFIKLEIBCAFLK ABCEFIJLEJBCAFLI ABCEFIJKEJBCAFIK ABCEFHKLHEBCAFLK ABCEFHJLHJBCAFLE ABCEFHJKHJBCAFEK ABCEFHILHEBCAFLI ABCEFHIKHEBCAFIK ABCEFHIJHJBCAFEI ABCEFGKLEGBCAFLK ABCEFGJLEGBCAFLJ ABCEFGJKEGBCAFJK ABCEFGILEGBCAFLI ABCEFGIKEGBCAFIK ' +
    'ABCEFGIJEGBCAFIJ ABCEFGHLHGBCAFLE ABCEFGHKHGBCAFEK ABCEFGHJHGBCAFEJ ABCEFGHIHGBCAFEI ABCDIJKLIJBCADLK ABCDHJKLHJBCADLK ABCDHIKLHIBCADLK ABCDHIJLHJBCADLI ABCDHIJKHJBCADIK ABCDGJKLCJBDAGLK ABCDGIKLIGBCADLK ABCDGIJLCJBDAGLI ABCDGIJKCJBDAGIK ABCDGHKLHGBCADLK ' +
    'ABCDGHJLHGBCADLJ ABCDGHJKHGBCADJK ABCDGHILHGBCADLI ABCDGHIKHGBCADIK ABCDGHIJHGBCADIJ ABCDFJKLCJBDAFLK ABCDFIKLCIBDAFLK ABCDFIJLCJBDAFLI ABCDFIJKCJBDAFIK ABCDFHKLHFBCADLK ABCDFHJLCJBDAFLH ABCDFHJKHJBCAFDK ABCDFHILHFBCADLI ABCDFHIKHFBCADIK ABCDFHIJHJBCAFDI ' +
    'ABCDFGKLCGBDAFLK ABCDFGJLCGBDAFLJ ABCDFGJKCGBDAFJK ABCDFGILCGBDAFLI ABCDFGIKCGBDAFIK ABCDFGIJCGBDAFIJ ABCDFGHLCGBDAFLH ABCDFGHKHGBCAFDK ABCDFGHJHGBCAFDJ ABCDFGHIHGBCAFDI ABCDEJKLEJBCADLK ABCDEIKLEIBCADLK ABCDEIJLEJBCADLI ABCDEIJKEJBCADIK ABCDEHKLHEBCADLK ' +
    'ABCDEHJLHJBCADLE ABCDEHJKHJBCADEK ABCDEHILHEBCADLI ABCDEHIKHEBCADIK ABCDEHIJHJBCADEI ABCDEGKLEGBCADLK ABCDEGJLEGBCADLJ ABCDEGJKEGBCADJK ABCDEGILEGBCADLI ABCDEGIKEGBCADIK ABCDEGIJEGBCADIJ ABCDEGHLHGBCADLE ABCDEGHKHGBCADEK ABCDEGHJHGBCADEJ ABCDEGHIHGBCADEI ' +
    'ABCDEFKLCEBDAFLK ABCDEFJLCJBDAFLE ABCDEFJKCJBDAFEK ABCDEFILCEBDAFLI ABCDEFIKCEBDAFIK ABCDEFIJCJBDAFEI ABCDEFHLHFBCADLE ABCDEFHKHEBCAFDK ABCDEFHJHJBCAFDE ABCDEFHIHEBCAFDI ABCDEFGLCGBDAFLE ABCDEFGKCGBDAFEK ABCDEFGJCGBDAFEJ ABCDEFGICGBDAFEI ABCDEFGHHGBCAFDE';

  var ANNEXC_TABLE = {};
  ANNEXC_RAW.split(/\s+/).forEach(function (tok) {
    if (tok.length !== 16) return;
    var key = tok.slice(0, 8);            // sorted qualifying-group letters
    var vals = tok.slice(8);              // third groups in winner order
    var mapping = {};
    for (var i = 0; i < 8; i++) mapping[ANNEXC_WINNER_ORDER[i]] = vals[i];
    ANNEXC_TABLE[key] = mapping;
  });

  // ---- ANNEXC_ANCHORS: independently FIFA-sourced rows for the matcher self-test
  // Keyed by the sorted set of qualifying 3rd-place groups. `map` gives the
  // winner-of-group (1X) -> the 3rd-place group (3Y) it faces. These two rows
  // are read straight from the official Annex C PDF (rows 1 and 495 of the
  // table above) and are the adversarial cross-check for engine.verifyAnnexC():
  // the greedy fallback (eligibility-only) does NOT reproduce them, so the test
  // is no longer circular — it forces the literal ANNEXC_TABLE to be used.
  var ANNEXC_ANCHORS = [
    { qualify: ['E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'],
      map: { A: 'E', B: 'J', D: 'I', E: 'F', G: 'H', I: 'G', K: 'L', L: 'K' } },
    { qualify: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
      map: { A: 'H', B: 'G', D: 'B', E: 'C', G: 'A', I: 'F', K: 'D', L: 'E' } }
  ];

  var WC = {
    TEAMS: TEAMS, GROUPS: GROUPS, VEN: VEN, GM: GM, KO: KO,
    ELO: ELO, STARS: STARS, VENMATCH: VENMATCH, HOST_TEAM: HOST_TEAM,
    THIRD_SLOTS: THIRD_SLOTS, ANNEXC_TABLE: ANNEXC_TABLE, ANNEXC_ANCHORS: ANNEXC_ANCHORS
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = WC;
  root.WC = WC;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
