/* translate.js —— 中英对照：整句/整段英译中（1.3.0）
 *
 * 取数顺序：MyMemory（国内可用、免密钥）→ Google gtx 备用；
 * 原生 HttpURLConnection 失败时自动改用 WebView 网络栈（和查词那套思路一致）。
 * 译文按句子边界切到 400 字符以内，块级缓存（内存 + Store meta 持久化），
 * 所以同一段文字只会翻一次，重开文章是秒出的。
 *
 * 对外：global.Tr = { toZh, bilingual, retry, clear, has, quotaHit }
 */
(function (global) {
  'use strict';

  function L(k) { return (global.I18N && global.I18N.L) ? global.I18N.L(k) : k; }

  var CHUNK_MAX = 400;        // MyMemory 单次 ~500 字节上限，400 字符留余量
  var TIMEOUT = 6000;         // 原生最坏 4.5s，JS 多等一点
  var WEB_TIMEOUT = 8000;     // 原生 webFetch 看门狗 6s
  var CONCURRENCY = 2;        // 同时两段，太快容易撞限流
  var CACHE_CAP = 600;        // 持久化缓存条数上限
  var CACHE_KEY = 'tr';

  var mem = {};               // 'en|原文' -> 译文
  var loaded = false;
  var loadPromise = null;
  var saveTimer = null;
  var useWeb = false;         // 原生通道失败过 → 之后都走 WebView
  var quotaHit = false;       // MyMemory 当次额度用完（用来给出更准确的提示）

  /* ----------------------------- 切块 ----------------------------- */

  /** 按句子边界切到 CHUNK_MAX 以内；顺序不变，拼回去就是原文 */
  function chunk(text) {
    var s = String(text || '').replace(/\s+/g, ' ').trim();
    if (!s) return [];
    if (s.length <= CHUNK_MAX) return [s];
    var parts = [];
    var buf = '';
    var sentences = s.match(/[^.!?;]+[.!?;]*\s*/g) || [s];
    for (var i = 0; i < sentences.length; i++) {
      var sen = sentences[i];
      if (sen.length > CHUNK_MAX) {
        if (buf) { parts.push(buf.trim()); buf = ''; }
        var rest = sen;
        while (rest.length > CHUNK_MAX) {
          // 硬切时尽量落在空格上，避免把单词劈开
          var cutAt = rest.lastIndexOf(' ', CHUNK_MAX);
          if (cutAt < CHUNK_MAX * 0.6) cutAt = CHUNK_MAX;
          parts.push(rest.slice(0, cutAt).trim());
          rest = rest.slice(cutAt);
        }
        buf = rest;
        continue;
      }
      if (buf && buf.length + sen.length > CHUNK_MAX) { parts.push(buf.trim()); buf = ''; }
      buf += sen;
    }
    if (buf.trim()) parts.push(buf.trim());
    return parts.filter(function (p) { return !!p; });
  }

  /* --------------------------- 两个接口 --------------------------- */

  function urlMM(q) {
    return 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(q) + '&langpair=en|zh-CN';
  }

  function urlGtx(q) {
    return 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q='
      + encodeURIComponent(q);
  }

  /** 返回 { zh } 或 { fail: 'quota' | 'echo' | 'empty' | 'http' } */
  function parseMM(body, q) {
    var o = JSON.parse(body);
    if (o && o.quotaFinished) return { fail: 'quota' };
    var st = Number((o && o.responseStatus) || 0);
    if (st >= 400) return { fail: st === 429 ? 'quota' : 'http' };
    var zh = String((o && o.responseData && o.responseData.translatedText) || '').trim();
    if (!zh) return { fail: 'empty' };
    if (/^(NO QUERY SPECIFIED|MYMEMORY WARNING|QUERY LENGTH LIMIT|PLEASE SELECT TWO DISTINCT LANGUAGES)/i.test(zh)) {
      return { fail: 'quota' };
    }
    if (zh.toLowerCase() === String(q || '').toLowerCase()) return { fail: 'echo' };
    return { zh: zh };
  }

  /** gtx 返回 [[["译文","原文",...],...],...] */
  function parseGtx(body, q) {
    var arr = JSON.parse(body);
    if (!arr || !arr[0] || !arr[0].length) return { fail: 'empty' };
    var out = '';
    for (var i = 0; i < arr[0].length; i++) {
      var seg = arr[0][i];
      if (seg && seg[0]) out += seg[0];
    }
    out = out.trim();
    if (!out) return { fail: 'empty' };
    if (out.toLowerCase() === String(q || '').toLowerCase()) return { fail: 'echo' };
    return { zh: out };
  }

  /* --------------------------- 通道与重试 --------------------------- */

  function ask(url, parse, q) {
    var web = useWeb && !!Bridge.webFetch;
    var p = web ? Bridge.webFetch(url, { timeoutMs: WEB_TIMEOUT }) : Bridge.http(url, { timeoutMs: TIMEOUT });
    return p.then(function (r) {
      if (!r || r.status === 0 || !r.body) {
        if (!useWeb && Bridge.webFetch) useWeb = true;   // 下次换 WebView 网络栈
        return { fail: 'io' };
      }
      try { return parse(r.body, q); } catch (e) { return { fail: 'parse' }; }
    }, function () {
      if (!useWeb && Bridge.webFetch) useWeb = true;
      return { fail: 'io' };
    });
  }

  /* ----------------------------- 缓存 ----------------------------- */

  function loadCache() {
    if (loaded) return Promise.resolve();
    if (loadPromise) return loadPromise;
    loadPromise = new Promise(function (res) {
      var done = false;
      function fin() { if (!done) { done = true; loaded = true; res(); } }
      try {
        if (!global.Store || !Store.getMeta) { fin(); return; }
        Store.getMeta(CACHE_KEY).then(function (o) {
          if (o && typeof o === 'object') {
            for (var k in o) { if (Object.prototype.hasOwnProperty.call(o, k)) mem[k] = o[k]; }
          }
          fin();
        })['catch'](fin);
      } catch (e) { fin(); }
      // 存储层卡住也不能拖住翻译
      setTimeout(fin, 3000);
    });
    return loadPromise;
  }

  function saveSoon() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      try {
        var keys = Object.keys(mem);
        if (keys.length > CACHE_CAP) {
          var drop = keys.slice(0, keys.length - CACHE_CAP);
          for (var i = 0; i < drop.length; i++) delete mem[drop[i]];
        }
        if (global.Store && Store.putMeta) Store.putMeta(CACHE_KEY, mem);
      } catch (e) { /* 缓存写失败不影响使用 */ }
    }, 1500);
  }

  function remember(k, zh) {
    mem[k] = zh;
    saveSoon();
    return zh;
  }

  /* ------------------------- 单块 / 整段翻译 ------------------------- */

  function translateChunk(txt) {
    var key = 'en|' + txt;
    if (mem[key]) return Promise.resolve({ ok: true, zh: mem[key] });
    return loadCache().then(function () {
      if (mem[key]) return { ok: true, zh: mem[key] };
      return ask(urlMM(txt), parseMM, txt).then(function (r) {
        if (r && r.zh) { remember(key, r.zh); return { ok: true, zh: r.zh }; }
        if (r && r.fail === 'quota') quotaHit = true;
        return ask(urlGtx(txt), parseGtx, txt).then(function (r2) {
          if (r2 && r2.zh) { remember(key, r2.zh); return { ok: true, zh: r2.zh }; }
          return { ok: false, quota: quotaHit };
        });
      });
    });
  }

  /** 整段翻译：切块后按顺序串行，结果拼回一句话；任一块失败即视为失败 */
  function toZh(text) {
    var parts = chunk(text);
    if (!parts.length) return Promise.resolve({ ok: false, error: 'empty' });
    var out = [];
    var i = 0;
    function step() {
      if (i >= parts.length) return Promise.resolve({ ok: true, zh: out.join('') });
      var idx = i++;
      return translateChunk(parts[idx]).then(function (r) {
        if (!r || !r.ok) return { ok: false, quota: quotaHit };
        out.push(r.zh);
        return step();
      });
    }
    return step();
  }

  /* ---------------------------- 页面接线 ---------------------------- */

  var SKIP_SELECTOR = 'p, li, blockquote, h2, h3, figcaption';

  function isTranslatable(t) {
    if (!t || t.length < 8) return false;
    return /[A-Za-z]{2}/.test(t);
  }

  function apply(el, r) {
    if (r && r.ok) {
      el.className = 'rd-zh';
      el.textContent = r.zh;
      el.removeAttribute('title');
      return true;
    }
    el.className = 'rd-zh err';
    el.textContent = L((r && r.quota) ? 'biQuota' : 'biFail');
    el.setAttribute('title', L('biRetryHint'));
    return false;
  }

  /** 在某一段后面插一条中文；返回 null 表示这段不翻 */
  function insertZh(node, text) {
    var parent = node.parentNode;
    if (!parent) return null;
    var d = node.ownerDocument.createElement('div');
    d.className = 'rd-zh pending';
    d.textContent = L('biPending');
    d.setAttribute('data-zh', '1');
    d._trText = text;
    parent.insertBefore(d, node.nextSibling);
    return d;
  }

  /**
   * 给 bodyEl 里的每个段落补中文（逐段异步填，先出上面的）。
   * opts.onProgress({finished,total,failed,quota}) 会随进度回调。
   */
  function bilingual(bodyEl, opts) {
    opts = opts || {};
    if (!bodyEl) return null;
    var nodes = [];
    var all = bodyEl.querySelectorAll(SKIP_SELECTOR);
    for (var i = 0; i < all.length; i++) {
      var n = all[i];
      if (n.className && String(n.className).indexOf('rd-zh') >= 0) continue;
      if (n.querySelector && n.querySelector('.rd-zh')) continue;
      var t = String(n.textContent || '').replace(/\s+/g, ' ').trim();
      if (!isTranslatable(t)) continue;
      var prev = n.previousSibling;
      if (prev && prev.nodeType === 1 && prev.className && String(prev.className).indexOf('rd-zh') >= 0) continue;
      nodes.push({ el: n, text: t, zh: insertZh(n, t) });
    }
    var total = nodes.length;
    var finished = 0;
    var failed = 0;
    if (!total) {
      if (opts.onProgress) opts.onProgress({ finished: 0, total: 0, failed: 0, quota: false });
      return { total: 0, done: Promise.resolve({ finished: 0, total: 0, failed: 0 }) };
    }
    var queue = nodes.slice();
    var active = 0;
    var resolveDone = null;
    var done = new Promise(function (res) { resolveDone = res; });

    function report() {
      if (opts.onProgress) {
        opts.onProgress({ finished: finished, total: total, failed: failed, quota: quotaHit });
      }
    }

    function pump() {
      while (active < CONCURRENCY && queue.length) {
        (function (item) {
          active++;
          toZh(item.text).then(function (r) {
            active--;
            finished++;
            if (item.zh && !apply(item.zh, r)) failed++;
            report();
            pump();
          })['catch'](function () {
            active--;
            finished++;
            failed++;
            if (item.zh) apply(item.zh, { ok: false });
            report();
            pump();
          });
        })(queue.shift());
      }
      if (active === 0 && queue.length === 0) {
        if (resolveDone) { resolveDone({ finished: finished, total: total, failed: failed }); resolveDone = null; }
      }
    }
    pump();
    return { total: total, done: done };
  }

  /** 点一下失败的那段重试 */
  function retry(el) {
    if (!el || !el._trText) return;
    el.className = 'rd-zh pending';
    el.textContent = L('biPending');
    toZh(el._trText).then(function (r) { apply(el, r); });
  }

  function clear(bodyEl) {
    if (!bodyEl) return;
    var list = bodyEl.querySelectorAll('.rd-zh');
    for (var i = 0; i < list.length; i++) {
      if (list[i].parentNode) list[i].parentNode.removeChild(list[i]);
    }
  }

  function has(bodyEl) {
    return !!(bodyEl && bodyEl.querySelector && bodyEl.querySelector('.rd-zh'));
  }

  global.Tr = {
    toZh: toZh,
    bilingual: bilingual,
    retry: retry,
    clear: clear,
    has: has,
    get quotaHit() { return quotaHit; },
    // 测试用（tools/test-translate.js）
    _debug: { chunk: chunk, parseMM: parseMM, parseGtx: parseGtx, CACHE_KEY: CACHE_KEY, CHUNK_MAX: CHUNK_MAX, mem: mem }
  };
})(window);
