/* dict.js 联网查词逻辑测试（Nashorn / jjs 运行，无网络、无设备）
 *
 * 用法（在 lexue\WordPalace 目录下）：
 *   "C:\Program Files\Zulu\zulu-8\bin\jjs.exe" -scripting tools\test-dict-online.js
 *
 * 覆盖：候选写法展开（所有格 / 连字符 / 缩写 / 屈折 / 叠辅音）、
 *       1.2.4 的源顺序（有道 suggest 小接口优先 → jsonapi 富接口 → MyMemory →
 *       dictionaryapi 走 WebView）、原生通道整体不通时改走 WebView 网络栈、
 *       失败 5 分钟缓存 / 成功永久缓存、
 *       「网络不通」「接口解析不了」「词典没收录」三种结论分开。
 * Nashorn 没有 Promise，这里带一个同步调度的最小实现（stub 都是同步 resolve 的）。 */
var ARGS = (typeof $ARG !== 'undefined' && $ARG) ? $ARG : [];
var SELF = (typeof __FILE__ !== 'undefined') ? String(__FILE__).replace(/\\/g, '/') : '';
var TOOLS = SELF ? SELF.replace(/\/[^/]*$/, '') : 'tools';
var HOME = TOOLS.replace(/\/tools$/, '');
var dictPath = ARGS.length ? ARGS[0] : HOME + '/app/assets/www/js/dict.js';

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
P.all = function (arr) {
  return new P(function (res, rej) {
    var n = arr.length, out = new Array(n), left = n;
    if (!n) { res(out); return; }
    arr.forEach(function (p, i) {
      P.resolve(p).then(function (v) { out[i] = v; if (--left === 0) res(out); }, rej);
    });
  });
};
var Promise = P;

/* ------------------------- 浏览器环境打桩 ------------------------- */
var window = {};
window.I18N = { L: function (k) { return k; } };
function T(s) { return s; }
var CALLS = [];      // 原生通道（Bridge.http）
var WCALLS = [];     // WebView 通道（Bridge.webFetch）
var RULES = function () { return { ok: false, status: 0, body: '', error: 'io' }; };
var WRULES = function () { return { ok: false, status: 0, body: '', error: 'io' }; };
var Bridge = {
  http: function (url, opt) { CALLS.push(url); return Promise.resolve(RULES(url, opt)); },
  webFetch: function (url, opt) { WCALLS.push(url); return Promise.resolve(WRULES(url, opt)); }
};
var NOW = 1700000000000;
Date.now = function () { return NOW; };

/* 把私有的 queryForms 暴露出来（测试专用，不改动源文件的导出表） */
var src = readFully(dictPath);
var tail = '})(window);';
var cut = src.lastIndexOf(tail);
if (cut < 0) { print('无法定位 dict.js 结尾'); exit(1); }
load({
  script: src.slice(0, cut) + '  global.__T = { queryForms: queryForms };\n' + src.slice(cut),
  name: 'dict-patched.js'
});
var TD = window.__T;

/* ------------------------- 断言小工具 ------------------------- */
var results = [];
function ok(name, cond, extra) {
  results.push((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra === undefined ? '' : ' | ' + extra));
}
function q(url) {
  var m = /[?&]q=([^&]*)/.exec(url);
  return m ? decodeURIComponent(m[1]) : '';
}
function isSuggest(u) { return u.indexOf('/suggest?') >= 0; }
function isJsonapi(u) { return u.indexOf('/jsonapi?') >= 0; }
function isYoudao(u) { return u.indexOf('dict.youdao.com') >= 0; }
function isMM(u) { return u.indexOf('mymemory') >= 0; }
function isDictApi(u) { return u.indexOf('dictionaryapi') >= 0; }
function qsOf(list, fn) { return list.filter(fn).map(q); }
function suggestQ() { return qsOf(CALLS, isSuggest); }
function jsonapiQ() { return qsOf(CALLS, isJsonapi); }
function mmQ() { return qsOf(CALLS, isMM); }
function reset() { CALLS = []; WCALLS = []; RULES = function () { return IO; }; WRULES = function () { return IO; }; }
function both(f) { RULES = f; WRULES = f; }
var OK_EMPTY = { ok: true, status: 200, error: null, body: '{}' };
var IO = { ok: false, status: 0, body: '', error: 'UnknownHostException' };
function suggestHit(explain, entry) {
  return {
    ok: true, status: 200, error: null,
    body: JSON.stringify({ result: { code: 200 }, data: { entries: [{ entry: entry, explain: explain }] } })
  };
}
function jsonapiHit(trans, phone) {
  return {
    ok: true, status: 200, error: null,
    body: JSON.stringify({ ec: { word: [{ usphone: phone || '[test]', trs: [{ pos: 'adj.', tr: [{ l: { i: trans } }] }] }] } })
  };
}

/* ------------------------- 纯函数：候选写法 ------------------------- */
function expectForms(word, want) {
  var got = TD.queryForms(word);
  ok('queryForms(' + word + ')', JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));
}

/* ------------------------- 用例 ------------------------- */

/* 两个通道都不通：结论必须是「网络不通」，并且换过 WebView 通道 */
function case1() {
  reset();
  return window.Dict.online("teacher's").then(function (r) {
    ok('传输全失败 → ok:false', r.ok === false, JSON.stringify(r));
    ok('报「网络不通」而不是「没收录」', r.error === 'onlineNet', r.error);
    ok("第一个请求是轻量的 suggest，且是原样 teacher's", isSuggest(CALLS[0] || '') && q(CALLS[0] || '') === "teacher's", (CALLS[0] || '') );
    ok('原生通道失败后改用 WebView 通道重试', WCALLS.length >= 1 && isSuggest(WCALLS[0]) && q(WCALLS[0]) === "teacher's", WCALLS.join(','));
    ok('WebView 也失败时不再浪费原生请求', CALLS.length === 1, String(CALLS.length));
    ok('展开出所有格原形 teacher 作为候选', r.tried.indexOf('teacher') > 0, (r.tried || []).join(','));
  });
}

/* 连字符词：命中「去连字符」的候选写法，轻量接口给释义、富接口补音标 */
function case2() {
  reset();
  both(function (u) {
    if (isSuggest(u) && q(u) === 'wellknown') return suggestHit('adj. 著名的；众所周知的', 'wellknown');
    if (isJsonapi(u) && q(u) === 'wellknown') return jsonapiHit('adj. 著名的；众所周知的', 'wel-nohn');
    return OK_EMPTY;
  });
  return window.Dict.online('well-known').then(function (r) {
    ok('连字符词命中合并写法', r.ok === true && r.via === 'wellknown', JSON.stringify(r));
    ok('取到释义与音标', r.trans.indexOf('著名') >= 0 && r.phonetic === 'wel-nohn', r.trans + ' / ' + r.phonetic);
    var f = suggestQ();
    ok('候选顺序：原样 → 去连字符', f[0] === 'well-known' && f[1] === 'wellknown', f.join(','));
    ok('命中后停止查找（不再问 MyMemory）', mmQ().length === 0, mmQ().join(','));
  });
}

/* 全都是 200 但没内容：结论是「没收录」，不是「网络不通」 */
function case3() {
  reset();
  both(function () { return OK_EMPTY; });
  return window.Dict.online('zzqqxx').then(function (r) {
    ok('都没收录 → ok:false + tried', r.ok === false && r.error === 'onlineNone' && r.tried && r.tried.length > 0, JSON.stringify(r));
    var n1 = CALLS.length;
    ok('确实查了多个源', n1 >= 3, String(n1));
    return window.Dict.online('zzqqxx').then(function () {
      ok('失败结果 5 分钟内缓存（不再发请求）', CALLS.length === n1, CALLS.length + ' vs ' + n1);
      NOW += 6 * 60 * 1000;
      return window.Dict.online('zzqqxx').then(function () {
        ok('超过 5 分钟后重新查询', CALLS.length > n1, CALLS.length + ' vs ' + n1);
      });
    });
  });
}

/* 200 但返回的不是 JSON：结论是「解析不了」，和网络失败分开 */
function case4() {
  reset();
  both(function () { return { ok: true, status: 200, error: null, body: '<html>not json</html>' }; });
  return window.Dict.online('qqzzxx2').then(function (r) {
    ok('接口改版/非 JSON → onlineParse', r.ok === false && r.error === 'onlineParse', JSON.stringify(r));
  });
}

/* 只有第三个源（MyMemory）有结果 */
function case5() {
  reset();
  both(function (u) {
    if (isMM(u)) return { ok: true, status: 200, error: null, body: JSON.stringify({ responseData: { translatedText: '老师' } }) };
    return OK_EMPTY;
  });
  return window.Dict.online("teacher's").then(function (r) {
    ok('翻译源兜底成功', r.ok === true && r.trans === '老师', JSON.stringify(r));
    ok('标注实际查询写法', r.via === "teacher's", r.via);
    var n1 = CALLS.length;
    NOW += 60 * 60 * 1000;
    return window.Dict.online("teacher's").then(function (r2) {
      ok('成功结果永久缓存', CALLS.length === n1 && r2.trans === '老师', CALLS.length + ' vs ' + n1);
    });
  });
}

/* 缩写命中原形 */
function case6() {
  reset();
  both(function (u) {
    if (isSuggest(u) && q(u) === 'do') return suggestHit('v. 做，干', 'do');
    return OK_EMPTY;
  });
  return window.Dict.online("don't").then(function (r) {
    ok('缩写命中原形 do', r.ok === true && r.via === 'do', JSON.stringify(r));
    ok('候选里含 do', suggestQ().indexOf('do') > 0, suggestQ().join(','));
  });
}

/* 原生通道被 ROM 拦掉、WebView 通道正常：这是「内置联网查词一直不行」的主场景 */
function case7() {
  reset();
  RULES = function () { return IO; };                       // HttpURLConnection 全挂
  WRULES = function (u) {
    if (isSuggest(u) && q(u) === 'teacher') return suggestHit('n. 教师', 'teacher');
    return IO;
  };
  return window.Dict.online('teacher').then(function (r) {
    ok('原生不通时用 WebView 通道查到了', r.ok === true && r.trans === 'n. 教师', JSON.stringify(r));
    ok('结果标记为走 WebView 通道', r.channel === 'web', String(r.channel));
    ok('只发了一次原生请求', CALLS.length === 1, String(CALLS.length));
  });
}

/* 空查询 */
function case8() {
  reset();
  return window.Dict.online('').then(function (r) {
    ok('空查询直接返回失败', r.ok === false, JSON.stringify(r));
  });
}

/* ------------------------- 驱动 ------------------------- */
expectForms("teacher's", ["teacher's", 'teacher']);
expectForms('well-known', ['well-known', 'wellknown', 'well', 'known']);
expectForms("don't", ["don't", 'do', 'don']);
expectForms('studies', ['studies', 'study', 'studi']);
expectForms('boxes', ['boxes', 'box']);
expectForms('stopped', ['stopped', 'stopp', 'stop', 'stoppe']);
expectForms('running', ['running', 'runn', 'run', 'runne']);
expectForms('knives', ['knives', 'knif', 'knife', 'kniv']);
expectForms('Teachers', ['teachers', 'teacher']);

var chain = Promise.resolve();
[case1, case2, case3, case4, case5, case6, case7, case8].forEach(function (f) { chain = chain.then(f); });
chain.then(function () { ok('全部用例执行完毕', true); },
  function (e) { ok('用例异常终止', false, (e && (e.stack || e.message)) || String(e)); });
drainMicro();

var bad = results.filter(function (s) { return s.indexOf('FAIL') === 0; }).length;
var summary = 'RESULT: ' + (bad ? 'HAS FAILURE (' + bad + ')' : 'ALL PASS (' + results.length + ' 项)');
// 结果写文件（显式 UTF-8），控制台只打 ASCII —— 避开 Windows 控制台编码
var outPath = ARGS.length > 1 ? ARGS[1] : TOOLS + '/_dict-test-result.txt';
var text = results.join('\n') + '\n' + summary + '\n';
java.nio.file.Files.write(
  java.nio.file.Paths.get(outPath),
  text.getBytes(java.nio.charset.StandardCharsets.UTF_8)
);
print('TEST-DONE: ' + bad + ' failure(s) of ' + results.length + ' checks');
print('detail -> ' + outPath);
exit(bad ? 1 : 0);
