/* 词典：离线词库（26k 词，含音标/中文释义/词频/考纲标签）+ 联网补充查询 */
(function (global) {
  'use strict';

  var BOOK_TAG = {
    zk: 'z', gk: 'g', cet4: '4', cet6: '6', ky: 'k',
    ielts: 'i', toefl: 't', gre: 'r', oxford: 'o'
  };
  // 词书标签保持原文，展示时再翻译——模块级求值会赶在语言确定之前
  var TAG_NAME = {
    z: '中考', g: '高考', '4': '四级', '6': '六级', k: '考研',
    i: '雅思', t: '托福', r: 'GRE', o: '牛津核心', c: '柯林斯'
  };

  var data = null;
  var index = {};        // word -> 词库下标
  var books = [];
  var bookCache = {};
  var loading = null;

  /* ---------------------- 用户导入的词书（1.3.1） ----------------------
   * 存在 IndexedDB 的 meta 键 'cbooks'，形如：
   *   [{ id, name, desc, color, words: [ [单词, 音标, 释义], ... ] }]
   * 内置 26k 词库不能改（随 APK 分发），所以导入词的释义单独放 extra 表，
   * lookup()/lemma() 查不到内置词时落到这里，于是查词面板、复习、阅读点词
   * 都能正常显示这些词。
   */
  var customBooks = [];   // 展示用的词书元信息
  var extra = {};         // 小写单词 -> 自定义词条
  var extraByBook = {};   // bookId -> 词条数组

  function setCustomBooks(list) {
    customBooks = [];
    extra = {};
    extraByBook = {};
    bookWordsCache = {};
    var arr = list || [];
    for (var i = 0; i < arr.length; i++) {
      var b = arr[i];
      if (!b || !b.id) continue;
      var meta = {
        id: b.id, name: b.name || b.id, desc: b.desc || '',
        order: 900 + i, color: b.color || '#6b7280', count: 0, custom: true
      };
      var ents = [];
      var ws = b.words || [];
      for (var k = 0; k < ws.length; k++) {
        var w = ws[k];
        var word = String((w && w[0]) || '').trim();
        if (!word) continue;
        var key = word.toLowerCase();
        var e = extra[key];
        if (!e) {
          e = {
            i: -1, word: word, phonetic: String((w && w[1]) || '').trim(),
            trans: String((w && w[2]) || '').trim(), tag: '', rank: 0,
            custom: true, books: []
          };
          extra[key] = e;
        }
        if (e.books.indexOf(meta.id) < 0) e.books.push(meta.id);
        if (ents.indexOf(e) < 0) ents.push(e);
      }
      meta.count = ents.length;
      customBooks.push(meta);
      extraByBook[meta.id] = ents;
    }
  }

  function getCustomBooks() { return customBooks; }

  /** 从本地存储装载自定义词书；没有 Store 时安静返回 */
  function loadCustom() {
    if (!global.Store || typeof Store.getMeta !== 'function') return Promise.resolve(false);
    return Store.getMeta('cbooks').then(function (v) {
      setCustomBooks(v && v.length ? v : []);
      return true;
    }, function () { return false; });
  }

  function load() {
    if (loading) return loading;
    loading = Promise.all([
      fetch('data/words.json').then(function (r) { return r.json(); }),
      fetch('data/books.json').then(function (r) { return r.json(); }).catch(function () { return { books: [] }; })
    ]).then(function (res) {
      data = res[0];
      books = (res[1] && res[1].books) || [];
      for (var i = 0; i < data.w.length; i++) index[data.w[i]] = i;
      return true;
    });
    return loading;
  }

  function ready() { return !!data; }
  function wordCount() { return data ? data.count : 0; }
  function getBooks() { return books.concat(customBooks); }

  function entryAt(i) {
    if (!data || i < 0 || i >= data.w.length) return null;
    return {
      i: i,
      word: data.w[i],
      phonetic: data.p[i] || '',
      trans: data.t[i] || '',
      tag: data.g[i] || '',
      rank: data.r[i] || 0
    };
  }

  function lookup(word) {
    if (!word) return null;
    var w = String(word).toLowerCase().replace(/[^a-z'\-]/g, '');
    if (!w) return null;
    if (data) {
      var i = index[w];
      if (i !== undefined) return entryAt(i);
    }
    if (extra[w]) return extra[w];
    return null;
  }

  /** 简易词形还原：OCR / 文章里遇到的屈折形式尽量回到原形 */
  var lemmaCache = {};
  function lemma(word) {
    if (!word) return null;
    var w = String(word).toLowerCase();
    if (lemmaCache[w] !== undefined) return lemmaCache[w];
    var hit = lookup(w);
    if (hit) { lemmaCache[w] = hit; return hit; }
    var cands = [];
    if (/ies$/.test(w)) cands.push(w.slice(0, -3) + 'y');
    if (/es$/.test(w)) cands.push(w.slice(0, -2));
    if (/s$/.test(w)) cands.push(w.slice(0, -1));
    if (/ing$/.test(w)) {
      cands.push(w.slice(0, -3));
      cands.push(w.slice(0, -3) + 'e');
      if (/([bdgklmnprt])\1ing$/.test(w)) cands.push(w.slice(0, -4));
    }
    if (/ed$/.test(w)) {
      cands.push(w.slice(0, -2));
      cands.push(w.slice(0, -1));
      if (/([bdgklmnprt])\1ed$/.test(w)) cands.push(w.slice(0, -3));
    }
    if (/er$/.test(w)) { cands.push(w.slice(0, -2)); cands.push(w.slice(0, -1)); }
    if (/est$/.test(w)) { cands.push(w.slice(0, -3)); cands.push(w.slice(0, -2)); }
    for (var i = 0; i < cands.length; i++) {
      var e = lookup(cands[i]);
      if (e) { lemmaCache[w] = e; return e; }
    }
    lemmaCache[w] = null;
    return null;
  }

  /* --------------------------- 词书过滤 --------------------------- */

  function inBook(entry, bookId) {
    if (!entry) return false;
    if (!bookId || bookId === 'all') return true;
    if (entry.custom) return (entry.books || []).indexOf(bookId) >= 0;
    if (extraByBook[bookId]) return false;   // 自定义词书只装导入文件里的词
    if (bookId === 'core') return entry.rank > 0 && entry.rank <= 3000;
    var ch = BOOK_TAG[bookId];
    if (!ch) return true;
    return entry.tag.indexOf(ch) >= 0;
  }

  var bookWordsCache = {};
  function bookEntries(bookId) {
    if (bookWordsCache[bookId]) return bookWordsCache[bookId];
    if (extraByBook[bookId]) return (bookWordsCache[bookId] = extraByBook[bookId]);
    var out = [];
    if (!data) return out;
    for (var i = 0; i < data.w.length; i++) {
      var e = entryAt(i);
      if (inBook(e, bookId)) out.push(e);
    }
    bookWordsCache[bookId] = out;
    return out;
  }

  function bookCount(bookId) {
    if (extraByBook[bookId]) return extraByBook[bookId].length;
    if (bookId === 'core') {
      var b = bookById('core');
      return b ? b.count : 0;
    }
    return bookEntries(bookId).length;
  }

  function bookById(id) {
    for (var i = 0; i < books.length; i++) if (books[i].id === id) return books[i];
    for (var j = 0; j < customBooks.length; j++) if (customBooks[j].id === id) return customBooks[j];
    return { id: id, name: id, desc: '', count: 0, color: '#3d5a80' };
  }

  /* ----------------------------- 搜索 ----------------------------- */

  function search(q, opt) {
    opt = opt || {};
    var limit = opt.limit || 40;
    var bookId = opt.bookId || 'all';
    q = String(q || '').trim();
    if (!q) return [];
    var out = [];
    var lower = q.toLowerCase();
    var seen = {};

    // 0) 自定义词书里的前缀命中（用户导入的词往往不在内置词库里）
    if (bookId === 'all' || extraByBook[bookId]) {
      for (var ck in extra) {
        if (!extra.hasOwnProperty(ck)) continue;
        if (out.length >= limit) break;
        if (ck.indexOf(lower) !== 0) continue;
        var ce = extra[ck];
        if (!inBook(ce, bookId)) continue;
        if (seen[ck]) continue;
        seen[ck] = 1;
        ce.score = ck === lower ? 0 : 1;
        out.push(ce);
      }
    }
    if (!data) return out;

    // 1) 前缀命中（优先级最高）
    for (var i = 0; i < data.w.length && out.length < limit; i++) {
      var w = data.w[i];
      if (w.indexOf(lower) !== 0) continue;
      var e = entryAt(i);
      if (!inBook(e, bookId)) continue;
      if (seen[w]) continue;
      seen[w] = 1;
      e.score = w === lower ? 0 : 1;
      out.push(e);
    }
    // 2) 中文释义包含（输入中文时）
    if (/[\u4e00-\u9fa5]/.test(q)) {
      for (var j = 0; j < data.w.length && out.length < limit; j++) {
        var t = data.t[j];
        if (!t || t.indexOf(q) < 0) continue;
        var e2 = entryAt(j);
        if (!inBook(e2, bookId)) continue;
        if (seen[e2.word]) continue;
        seen[e2.word] = 1;
        e2.score = 2;
        out.push(e2);
      }
    }
    // 3) 包含匹配兜底
    if (out.length < limit) {
      for (var k = 0; k < data.w.length && out.length < limit; k++) {
        var wk = data.w[k];
        if (wk.indexOf(lower) < 0) continue;
        var e3 = entryAt(k);
        if (!inBook(e3, bookId)) continue;
        if (seen[wk]) continue;
        seen[wk] = 1;
        e3.score = 3;
        out.push(e3);
      }
    }
    return out;
  }

  function tagNames(tag) {
    var out = [];
    for (var i = 0; i < (tag || '').length; i++) {
      var n = T(TAG_NAME[tag.charAt(i)]);
      if (n) out.push(n);
    }
    return out;
  }

  /* --------------------------- 联网补充 --------------------------- *
   * 1.2.3 起：一个词会按「可能是别的写法」展开成几个候选形依次查
   *   （所有格 teacher's→teacher、连字符 well-known→wellknown/well/known、
   *   缩写 don't→do…），失败的查询只记 5 分钟。
   *
   * 1.2.4 起：换掉「一上来就并行两个源」的做法——实测（2026-10 从国内网络）
   *   有道 suggest   ~0.5 KB / 30 ms   ✓
   *   有道 jsonapi   ~40 KB / 470 ms   客户端读取超时只有 2 秒，手机上经常来不及
   *   MyMemory       ~1 KB  / 880 ms   ✓
   *   dictionaryapi  —— 直接 SocketTimeout（国内不可用）
   *   旧版把 jsonapi 和 dictionaryapi 放在第一梯队，每次查词都会留下一条
   *   「网络失败」，界面于是永远显示「网络不通或被拦截」。
   *   现在：小接口优先、大接口靠后、原生通道不通就换 WebView 网络栈。 */

  var onlineCache = {};                  // word -> { at, val }
  var ONLINE_FAIL_TTL = 5 * 60 * 1000;
  var ONLINE_BUDGET = 15000;             // 一个词最多花这么久（硬上限）
  var SOURCE_TIMEOUT = 4500;             // 单次接口等待上限（原生最坏 4.5s）
  var WEBVIEW_TIMEOUT = 7000;            // 走 WebView 时给到原生看门狗 6s 之外

  /** 常见缩写 → 原形：整串直接丢给词典接口基本查不到 */
  var CONTRACT = {
    "don't": 'do', "doesn't": 'do', "didn't": 'do', "won't": 'will', "can't": 'can',
    "isn't": 'be', "aren't": 'be', "wasn't": 'be', "weren't": 'be', "hasn't": 'have',
    "haven't": 'have', "hadn't": 'have', "it's": 'it', "that's": 'that', "i'm": 'i',
    "i've": 'i', "i'll": 'i', "i'd": 'i', "you're": 'you', "we're": 'we', "they're": 'they',
    "let's": 'let', "there's": 'there', "he's": 'he', "she's": 'she', "what's": 'what',
    "who's": 'who', "here's": 'here', "o'clock": 'clock'
  };

  function L(k) { return (global.I18N && global.I18N.L) ? global.I18N.L(k) : k; }

  /** 展开成若干值得去查的写法（最多 4 个，顺序即优先级） */
  function queryForms(word) {
    var out = [];
    function push(x) {
      x = String(x || '').toLowerCase().replace(/[’]/g, "'").replace(/^[^a-z]+|[^a-z]+$/g, '');
      if (x.length > 1 && out.indexOf(x) < 0) out.push(x);
    }
    /** 屈折前缀：去掉词尾后若末尾是叠辅音（stopp→stop、runn→run）再补一刀 */
    function stem(x) {
      push(x);
      if (/([b-df-hj-np-tv-z])\1$/.test(x)) push(x.slice(0, -1));
    }
    var w = String(word || '').toLowerCase().replace(/[’]/g, "'").trim();
    push(w);
    var bare = w.replace(/[^a-z']/g, '');
    if (CONTRACT[bare]) push(CONTRACT[bare]);
    var ap = w.indexOf("'");
    if (ap > 0) push(w.slice(0, ap));
    if (w.indexOf('-') > 0) {
      push(w.replace(/-/g, ''));
      w.split('-').forEach(push);
    }
    if (/ies$/.test(w)) push(w.slice(0, -3) + 'y');
    else if (/ves$/.test(w)) { push(w.slice(0, -3) + 'f'); push(w.slice(0, -3) + 'fe'); }
    if (/ing$/.test(w)) { stem(w.slice(0, -3)); push(w.slice(0, -3) + 'e'); }
    else if (/ed$/.test(w)) { stem(w.slice(0, -2)); push(w.slice(0, -2) + 'e'); }
    else if (/es$/.test(w)) push(w.slice(0, -2));
    else if (/s$/.test(w) && !/ss$/.test(w)) push(w.slice(0, -1));
    if (/er$/.test(w)) stem(w.slice(0, -2));
    if (/est$/.test(w)) stem(w.slice(0, -3));
    return out.slice(0, 4);
  }

  /** 连不上 / 超时 / 空响应——用来区分「查不到这个词」和「网根本不通」 */
  function isTransportFail(r) {
    return !r || !!r.error || r.status === 0 || !r.body;
  }

  /** 网络级失败才计数：接口改版 / 空结果要分开算，否则错误提示会误导 */
  function miss(r, stat) {
    if (!r || r.status === 0 || r.error) stat.fail++;
    return null;
  }

  /* ------------------------ 各个接口的解析 ------------------------ */

  /** 有道 suggest：{"data":{"entries":[{"entry":"teacher","explain":"n. 教师"}]}} */
  function parseSuggest(body, form) {
    var o = JSON.parse(body);
    var entries = (o && o.data && o.data.entries) || [];
    if (!entries.length) return null;
    var pick = null;
    for (var i = 0; i < entries.length; i++) {
      if (String(entries[i].entry || '').toLowerCase() === form) { pick = entries[i]; break; }
    }
    if (!pick) pick = entries[0];
    var ex = String(pick.explain || '').replace(/\r/g, '').trim();
    if (!ex) return null;
    // explain 里可能有多行（不同词性），统一成一行
    return { trans: ex.replace(/\n+/g, '；'), via: String(pick.entry || form) };
  }

  /** 有道 jsonapi：音标 + 词性释义；短语/句子靠 fanyi / web_trans 兜底 */
  function parseJsonapi(body) {
    var o = JSON.parse(body);
    var res = { trans: '', phonetic: '', audio: '', meanings: [], via: '' };
    var ec = o.ec;
    if (ec && ec.word && ec.word.length) {
      var wd = ec.word[0];
      res.phonetic = String(wd.usphone || wd.ukphone || wd.phone || '').replace(/^\[|\]$/g, '');
      var parts = [];
      var means = [];
      (wd.trs || []).forEach(function (t) {
        var i = t && t.tr && t.tr[0] && t.tr[0].l && t.tr[0].l.i;
        if (!i) return;
        i = String(i).replace(/\|/g, '').replace(/\\r|\\n/g, ' ');
        parts.push(i);
        if (t.pos) means.push({ pos: String(t.pos), defs: [i] });
      });
      res.trans = parts.slice(0, 4).join('；');
      res.meanings = means.slice(0, 3);
      res.via = String(wd['return-phrase'] || '');
    }
    if (!res.trans && o.simple && o.simple.word && o.simple.word.length) {
      var sw = o.simple.word[0];
      res.phonetic = res.phonetic || String(sw.usphone || sw.ukphone || '');
      var lines = [];
      (sw.trs || []).forEach(function (t) {
        var i = t && t.tr && t.tr[0] && t.tr[0].l && t.tr[0].l.i;
        if (i) lines.push(String(i).replace(/\|/g, ''));
      });
      res.trans = lines.slice(0, 3).join('；');
    }
    if (!res.trans && o.fanyi && o.fanyi.tran) res.trans = String(o.fanyi.tran);
    if (!res.trans && o.web_trans && o.web_trans['web-translation']) {
      var wt = o.web_trans['web-translation'];
      if (wt.length && wt[0].trans && wt[0].trans.length) {
        var ln = wt[0].trans[0].summary && wt[0].trans[0].summary.line;
        if (ln && ln.length) res.trans = String(ln[0]).replace(/<[^>]+>/g, '');
      }
    }
    return (res.trans || res.phonetic) ? res : null;
  }

  /** MyMemory 翻译：{"responseData":{"translatedText":"教师"}} */
  function parseMm(body, form) {
    var o = JSON.parse(body);
    var zh = String((o && o.responseData && o.responseData.translatedText) || '').trim();
    if (/^(NO QUERY SPECIFIED|MYMEMORY WARNING|QUERY LENGTH LIMIT)/i.test(zh)) return null;
    if (!zh || zh.toLowerCase() === form) return null;
    return { trans: zh, via: form };
  }

  /** dictionaryapi.dev：英文释义 / 音频（国内多半不通，所以排最后且走 WebView） */
  function parseDictApi(body) {
    var arr = JSON.parse(body);
    if (!arr || !arr.length) return null;
    var first = arr[0];
    var audio = '';
    (first.phonetics || []).forEach(function (p) { if (!audio && p.audio) audio = p.audio; });
    var phon = first.phonetic || '';
    if (!phon) (first.phonetics || []).forEach(function (p) { if (!phon && p.text) phon = p.text; });
    var meanings = [];
    (first.meanings || []).forEach(function (m) {
      meanings.push({
        pos: m.partOfSpeech || '',
        defs: (m.definitions || []).slice(0, 2).map(function (d) { return d.definition; })
      });
    });
    var res = {
      trans: '', phonetic: String(phon).replace(/^\/|\/$/g, ''), audio: audio,
      meanings: meanings.slice(0, 3), via: ''
    };
    return (res.phonetic || res.meanings.length) ? res : null;
  }

  /* --------------------------- 取一次接口 --------------------------- */

  var SOURCES = {
    suggest: function (q) {
      return 'https://dict.youdao.com/suggest?num=5&ver=3.0&doctype=json&cache=false&le=en&q='
        + encodeURIComponent(q);
    },
    jsonapi: function (q) { return 'https://dict.youdao.com/jsonapi?q=' + encodeURIComponent(q); },
    mm: function (q) {
      return 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(q) + '&langpair=en|zh-CN';
    },
    dictapi: function (q) {
      return 'https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(q);
    }
  };

  function parseBy(src, body, form) {
    if (src === 'suggest') return parseSuggest(body, form);
    if (src === 'jsonapi') return parseJsonapi(body);
    if (src === 'mm') return parseMm(body, form);
    return parseDictApi(body);
  }

  function call(src, form, web, stat) {
    var ms = web ? WEBVIEW_TIMEOUT : SOURCE_TIMEOUT;
    var p;
    if (web) {
      if (!Bridge.webFetch) return Promise.resolve(null);
      p = Bridge.webFetch(SOURCES[src](form), { timeoutMs: ms });
    } else {
      p = Bridge.http(SOURCES[src](form), { timeoutMs: ms });
    }
    return p.then(function (r) {
      if (isTransportFail(r)) return miss(r, stat);
      var res;
      try { res = parseBy(src, r.body, form); }
      catch (e) { stat.parse++; return null; }
      if (!res) { stat.empty++; return null; }
      res.ok = true;
      res.word = form;
      res.via = res.via || form;
      res.phonetic = res.phonetic || '';
      res.audio = res.audio || '';
      res.meanings = res.meanings || [];
      res.source = src;
      res.channel = web ? 'web' : 'native';
      return res;
    }, function () { stat.fail++; return null; });
  }

  /* 尝试顺序：便宜且可靠的在前；原生通道确认不通时（webOnly）会跳过所有原生项，
     直接落到后面那几个 WebView 通道项上 */
  function planOf(forms) {
    var out = [];
    out.push({ src: 'suggest', form: forms[0] });            // ~0.5 KB，30 ms
    out.push({ src: 'suggest', form: forms[0], web: true }); // 换 WebView 网络栈再试一次
    for (var i = 1; i < forms.length; i++) out.push({ src: 'suggest', form: forms[i] });
    out.push({ src: 'jsonapi', form: forms[0] });            // ~40 KB，补音标/词性
    out.push({ src: 'mm', form: forms[0] });                 // 翻译源兜底
    for (var j = 1; j < forms.length; j++) out.push({ src: 'mm', form: forms[j] });
    out.push({ src: 'jsonapi', form: forms[0], web: true });
    out.push({ src: 'dictapi', form: forms[0], web: true }); // 英文释义/音频，国内多半不通
    return out;
  }

  function online(word) {
    var raw = String(word || '').toLowerCase().trim();
    if (!raw) return Promise.resolve({ ok: false, error: T('空查询') });
    var hit = onlineCache[raw];
    if (hit && (hit.val.ok || Date.now() - hit.at < ONLINE_FAIL_TTL)) return Promise.resolve(hit.val);

    var forms = queryForms(raw);
    var stat = { fail: 0, empty: 0, parse: 0 };
    var deadline = Date.now() + ONLINE_BUDGET;
    var attempts = planOf(forms);
    var webOnly = false;      // 原生通道已被证明不通（超时/被拦）
    var best = null;

    function next(i) {
      if (i >= attempts.length) return Promise.resolve(best);
      if (Date.now() > deadline) return Promise.resolve(best);
      var a = attempts[i];
      if (webOnly && a.web !== true) return next(i + 1);
      return call(a.src, a.form, a.web === true, stat).then(function (r) {
        if (!r) {
          // 第一个轻量接口在原生的 HttpURLConnection 上都失败 → 换 WebView 网络栈
          if (a.src === 'suggest' && a.form === forms[0] && a.web !== true && stat.fail > 0) {
            webOnly = true;
          }
          return next(i + 1);
        }
        if (best) return best;
        best = r;
        // 轻量接口只给释义：再补一次富接口拿音标/词性，失败不影响结论
        if (!r.phonetic && !r.meanings.length && r.source !== 'jsonapi') {
          return call('jsonapi', a.form, webOnly, { fail: 0, empty: 0, parse: 0 }).then(function (rich) {
            if (rich) {
              best.phonetic = rich.phonetic || best.phonetic;
              best.audio = rich.audio || best.audio;
              best.meanings = rich.meanings || best.meanings;
            }
            return best;
          });
        }
        return best;
      });
    }

    return next(0).then(function (r) {
      if (!r) {
        r = {
          ok: false, tried: forms,
          error: stat.fail > 0 ? L('onlineNet') : (stat.parse > 0 ? L('onlineParse') : L('onlineNone'))
        };
      }
      onlineCache[raw] = { at: Date.now(), val: r };
      return r;
    });
  }

  global.Dict = {
    load: load, ready: ready, wordCount: wordCount,
    getBooks: getBooks, bookById: bookById, bookEntries: bookEntries, bookCount: bookCount,
    inBook: inBook, lookup: lookup, lemma: lemma, entryAt: entryAt,
    search: search, tagNames: tagNames, online: online,
    loadCustom: loadCustom, setCustomBooks: setCustomBooks, getCustomBooks: getCustomBooks,
    BOOK_TAG: BOOK_TAG, TAG_NAME: TAG_NAME
  };
})(window);