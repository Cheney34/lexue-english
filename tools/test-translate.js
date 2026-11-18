/* translate.js 中英对照逻辑测试（Nashorn / jjs 运行，无网络、无 DOM）
 *
 * 用法（在 lexue\WordPalace 目录下）：
 *   "C:\Program Files\Zulu\zulu-8\bin\jjs.exe" -scripting tools\test-translate.js
 *
 * 覆盖：切块（句子边界 / 超长单句硬切 / 不丢字）、两个接口的解析、
 *       MyMemory 额度与回显判定、失败后回退 gtx、原生通道失败后改走 WebView、
 *       块级缓存（同一段只翻一次）。
 */
var ARGS = (typeof $ARG !== 'undefined' && $ARG) ? $ARG : [];
var CWD = String(java.lang.System.getProperty('user.dir')).replace(/\\/g, '/');
var SELF = (typeof __FILE__ !== 'undefined') ? String(__FILE__).replace(/\\/g, '/') : '';
if (SELF.charAt(0) !== '/' && !/^[A-Za-z]:/.test(SELF)) SELF = CWD + '/' + SELF;
var TOOLS = SELF.replace(/\/[^/]*$/, '');
var HOME = /\/tools$/.test(TOOLS) ? TOOLS.replace(/\/tools$/, '') : TOOLS;
var trPath = ARGS.length ? ARGS[0] : HOME + '/app/assets/www/js/translate.js';

/* ------------------------- Promise 最小实现 ------------------------- */
var MICRO = [];
function drainMicro() {
  var guard = 0;
  while (MICRO.length) {
    if (++guard > 200000) throw new Error('microtask loop');
    MICRO.shift()();
  }
}
function P(exec) {
  var self = this;
  self.st = 0; self.v = undefined; self.h = [];
  function settle(st, v) {
    if (self.st) return;
    if (st === 1 && v && typeof v.then === 'function') {
      v.then(function (x) { settle(1, x); }, function (e) { settle(2, e); });
      return;
    }
    self.st = st; self.v = v;
    var hs = self.h; self.h = [];
    hs.forEach(function (h) { MICRO.push(h); });
  }
  if (exec) { try { exec(function (v) { settle(1, v); }, function (e) { settle(2, e); }); } catch (e) { settle(2, e); } }
}
P.prototype.then = function (onF, onR) {
  var self = this;
  return new P(function (res, rej) {
    var run = function () {
      try {
        if (self.st === 1) res(onF ? onF(self.v) : self.v);
        else { if (onR) res(onR(self.v)); else rej(self.v); }
      } catch (e) { rej(e); }
    };
    if (self.st) MICRO.push(run); else self.h.push(run);
  });
};
P.prototype['catch'] = function (onR) { return this.then(null, onR); };
P.resolve = function (v) { return new P(function (res) { res(v); }); };
P.reject = function (e) { return new P(function (res, rej) { rej(e); }); };
var Promise = P;

/* ------------------------- 宿主环境打桩 ------------------------- */
var window = {};
window.I18N = { L: function (k) { return k; } };
var setTimeout = function () { return 0; };   // translate.js 只用来做防抖/兜底
var clearTimeout = function () {};
var META = {};
var Store = {
  getMeta: function (k) { return Promise.resolve(META[k] || null); },
  putMeta: function (k, v) { META[k] = v; return Promise.resolve(true); }
};
var CALLS = [];    // 原生通道
var WCALLS = [];   // WebView 通道
var RULES = function () { return { ok: false, status: 0, body: '', error: 'io' }; };
var WRULES = function () { return { ok: false, status: 0, body: '', error: 'io' }; };
var Bridge = {
  http: function (url, opt) { CALLS.push(url); return Promise.resolve(RULES(url, opt)); },
  webFetch: function (url, opt) { WCALLS.push(url); return Promise.resolve(WRULES(url, opt)); }
};

load({ script: readFully(trPath), name: 'translate.js' });
var Tr = window.Tr;
var D = Tr._debug;

/* ------------------------- 断言小工具 ------------------------- */
var results = [];
function ok(name, cond, extra) {
  results.push((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra === undefined ? '' : ' | ' + extra));
}
function isMM(u) { return u.indexOf('mymemory') >= 0; }
function isGtx(u) { return u.indexOf('translate.googleapis.com') >= 0; }
function qof(u) {
  var m = /[?&]q=([^&]*)/.exec(u);
  return m ? decodeURIComponent(m[1]) : '';
}
function reset(rule) {
  CALLS = []; WCALLS = [];
  RULES = rule || function () { return { ok: false, status: 0, body: '', error: 'io' }; };
  WRULES = RULES;
}
function noSpace(s) { return String(s).replace(/\s+/g, ''); }
function mmOk(zh) { return JSON.stringify({ responseData: { translatedText: zh, match: 0.9 } }); }
function gtxOk(zh, en) { return JSON.stringify([[[zh, en || '', null, null]]]); }

/* ---------------------------- 1. 切块 ---------------------------- */
var SHORT = 'The government said on Monday that it would cut spending.';
var SENT = 'Researchers at the university have found that reading matters. ';
var LONG = '';
for (var i = 0; i < 20; i++) LONG += SENT;
var LONG_NP = new Array(120).join('alpha beta ');   // 无标点的超长串

var c1 = D.chunk('');
ok('空串不切', c1.length === 0, JSON.stringify(c1));
var c2 = D.chunk(SHORT);
ok('短句原样返回', c2.length === 1 && c2[0] === SHORT, JSON.stringify(c2));

var c3 = D.chunk(LONG);
var allShort = c3.every(function (x) { return x.length <= D.CHUNK_MAX; });
ok('长文每块都不超过上限', allShort, c3.map(function (x) { return x.length; }).join(','));
ok('长文切成多块', c3.length >= 3, String(c3.length));
ok('切块不丢字（忽略空白）', noSpace(c3.join('')) === noSpace(LONG), String(noSpace(c3.join('')).length) + ' vs ' + String(noSpace(LONG).length));

var c4 = D.chunk(LONG_NP);
ok('超长单句硬切也不超上限', c4.every(function (x) { return x.length <= D.CHUNK_MAX; }), c4.map(function (x) { return x.length; }).join(','));
ok('硬切不丢字', noSpace(c4.join('')) === noSpace(LONG_NP), String(noSpace(c4.join('')).length));

/* ------------------------ 2. 两个接口的解析 ------------------------ */
var m1 = D.parseMM(mmOk('政府周一表示将削减支出。'), SHORT);
ok('MyMemory 正常解析', m1.zh === '政府周一表示将削减支出。', JSON.stringify(m1));
ok('额度用完 → quota', D.parseMM(JSON.stringify({ quotaFinished: true, responseData: { translatedText: 'x' } }), 'q').fail === 'quota');
ok('429 → quota', D.parseMM(JSON.stringify({ responseStatus: 429 }), 'q').fail === 'quota');
ok('WARNING 文本 → quota', D.parseMM(JSON.stringify({ responseData: { translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS' } }), 'q').fail === 'quota');
ok('回显原文 → echo', D.parseMM(JSON.stringify({ responseData: { translatedText: 'hello' } }), 'hello').fail === 'echo');

var g1 = D.parseGtx(gtxOk('政府周一表示将削减支出。', SHORT), SHORT);
ok('gtx 正常解析', g1.zh === '政府周一表示将削减支出。', JSON.stringify(g1));
ok('gtx 空数组 → empty', D.parseGtx('[]', 'q').fail === 'empty');
var multi = JSON.stringify([[['第一句。', 'A'], ['第二句。', 'B']]]);
ok('gtx 多段拼接', D.parseGtx(multi, 'A B').zh === '第一句。第二句。', JSON.stringify(D.parseGtx(multi, 'A B')));

/* -------------------------- 3. 正常翻译 + 缓存 -------------------------- */
var chain = Promise.resolve();

chain = chain.then(function () {
  var T1 = 'The quick brown fox jumps over the lazy dog.';
  reset(function (u) {
    if (isMM(u)) return { ok: true, status: 200, body: mmOk('敏捷的棕色狐狸跳过了懒狗。') };
    return { ok: false, status: 0, body: '', error: 'io' };
  });
  return Tr.toZh(T1).then(function (r) {
    ok('英译中成功', r.ok === true && r.zh === '敏捷的棕色狐狸跳过了懒狗。', JSON.stringify(r));
    var n = CALLS.length + WCALLS.length;
    return Tr.toZh(T1).then(function (r2) {
      ok('同一段第二次走缓存（不再发请求）', (CALLS.length + WCALLS.length) === n && r2.zh === r.zh, String(CALLS.length + WCALLS.length) + ' vs ' + n);
    });
  });
});

/* ------------------ 4. MyMemory 不通 → 回退 gtx（并换通道） ------------------ */
chain = chain.then(function () {
  var T2 = 'Prices rose faster than wages last year.';
  reset(function (u) {
    if (isMM(u)) return { ok: false, status: 0, body: '', error: 'SocketTimeoutException' };
    if (isGtx(u)) return { ok: true, status: 200, body: gtxOk('去年物价上涨快于工资。', T2) };
    return { ok: false, status: 0, body: '', error: 'io' };
  });
  return Tr.toZh(T2).then(function (r) {
    ok('首选源超时后回退 gtx', r.ok === true && r.zh === '去年物价上涨快于工资。', JSON.stringify(r));
    ok('gtx 确实被调用', (CALLS.concat(WCALLS)).some(isGtx), (CALLS.concat(WCALLS)).join(' | '));
  });
});

/* ------------------- 5. 两个源都失败：失败要如实返回 ------------------- */
chain = chain.then(function () {
  var T3 = 'Nobody expected the meeting to end so early.';
  reset(function () { return { ok: false, status: 0, body: '', error: 'io' }; });
  return Tr.toZh(T3).then(function (r) {
    ok('两个源都失败 → ok:false', r.ok === false, JSON.stringify(r));
    ok('失败时 quotaHit 仍为 false', Tr.quotaHit === false, String(Tr.quotaHit));
  });
});

/* ---------------------- 6. 额度用完：给出 quota 标记 ---------------------- */
chain = chain.then(function () {
  var T4 = 'The train was delayed because of the storm.';
  reset(function (u) {
    if (isMM(u)) return { ok: true, status: 200, body: JSON.stringify({ quotaFinished: true, responseData: { translatedText: 'MYMEMORY WARNING: LIMIT' } }) };
    return { ok: false, status: 0, body: '', error: 'io' };
  });
  return Tr.toZh(T4).then(function (r) {
    ok('额度用完 → ok:false 且带 quota', r.ok === false && r.quota === true, JSON.stringify(r));
    ok('quotaHit 置位', Tr.quotaHit === true, String(Tr.quotaHit));
  });
});

chain.then(function () { ok('全部用例执行完毕', true); },
  function (e) { ok('用例异常终止', false, (e && (e.stack || e.message)) || String(e)); });
drainMicro();

/* ---------------------------- 汇总 ---------------------------- */
var bad = results.filter(function (s) { return s.indexOf('FAIL') === 0; }).length;
var summary = 'RESULT: ' + (bad ? 'HAS FAILURE (' + bad + ')' : 'ALL PASS (' + results.length + ' 项)');
var outPath = ARGS.length > 1 ? ARGS[1] : TOOLS + '/_translate-test-result.txt';
java.nio.file.Files.write(
  java.nio.file.Paths.get(outPath),
  (results.join('\n') + '\n' + summary + '\n').getBytes(java.nio.charset.StandardCharsets.UTF_8)
);
print('TEST-DONE: ' + bad + ' failure(s) of ' + results.length + ' checks');
print('detail -> ' + outPath);
exit(bad ? 1 : 0);
