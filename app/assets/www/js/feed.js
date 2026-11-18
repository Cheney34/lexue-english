/* ============================================================================
 * 订阅源领域层
 *
 * 职责：订阅源目录与用户订阅的增删改、RSS/Atom/RDF 解析、双通道抓取、
 *       订阅源自动发现、OPML 导入导出、已读与收藏标记、屏蔽词、缓存管线。
 *
 * 不涉及任何界面代码——界面层在 view-read.js / reader.js。
 *
 * 架构参考 prof18/feed-flow（Apache-2.0）：
 *   - FeedUrlRetriever   → 本文件的 discover()：粘贴任意网址，自动找出真正的 feed 地址
 *   - Suggestions        → assets/data/feeds.json 精选目录（按主题分类）
 *   - RSSParser 行为说明 → 严格解析失败后追加一次「不规范 XML 清理」再解析
 * ========================================================================== */
(function (global) {
  'use strict';

  var MAX_PER_FEED = 40;          // 每个源最多保留多少条
  var CACHE_HOURS = 12;           // 距上次更新超过这么久即视为过期
  /**
   * 单个源的抓取预算。
   *
   * 10 秒上限是使用者的明确要求：**一个源 10 秒还没结果，就按「这个源无效」处理**，
   * 不能让整轮更新一直转圈。
   *
   * 但「预算」必须和原生层的真实超时配对，否则 JS 会在原生还在等的时候就
   * 判自己超时——那样直连通道永远返回 status:0，看起来就像「所有源都无效」。
   * 现在的配对关系（改任何一边都要同步改另一边）：
   *
   *   直连：JS 抢跑 5500ms  ≥  原生 Net.java 连接 2500 + 读取 2000 = 4500ms
   *   兜底：JS 抢跑 7000ms  ≥  原生 Bridge.webFetch 看门狗 6000ms
   *   单源：HARD_TIMEOUT 14000ms 是最后一道闸，正常情况到不了
   *
   * 直连现在只给 5 秒而不是 7.5 秒：多出来的时间留给「直连被 WAF 拦、
   * 必须换浏览器引擎重试」的那条路——以前兜底只剩 2 秒，等于白给。
   */
  var SOURCE_BUDGET = 10000;
  var DIRECT_BUDGET = 5500;       // 直连抢跑（原生最坏 4500ms 已完成）
  var WEBVIEW_BUDGET = 7000;      // 兜底通道抢跑（原生看门狗 6000ms 已完成）
  var MIN_WEBVIEW_BUDGET = 2500;  // 剩不到这么久就不值得再起一次浏览器引擎
  var FETCH_TIMEOUT = 12000;      // 单次请求的兜底上限（正常情况下由 SOURCE_BUDGET 先触发）
  var STORE_TIMEOUT = 8000;       // 读写 IndexedDB 的上限：存储卡死不能拖垮整页
  var HARD_TIMEOUT = SOURCE_BUDGET + 4000;

  /* 首次安装时默认启用的源（都在境内实测可直连） */
  // 默认只预置这 4 个：全部为境内实测可直连、且不依赖站点 WAF 放行。
  // CGTN 曾经是默认之一，但它的站点会对部分请求返回 403，所以改成新华社英文。
  var DEFAULT_ON = ['bne', 'xinhua-en', 'ecns', 'hn-best'];

  var catalogCache = null;
  var catalogError = '';          // 目录读取失败的原因（界面据此解释「一个源都没有」）
  var feeds = { fetchedAt: 0, sources: {} };
  var readMark = { ids: {} };
  var starMark = { ids: {} };
  var readSet = {};
  var starSet = {};
  var refreshing = false;
  var loaded = false;
  var progress = { done: 0, total: 0 };

  /* ============================== 小工具 ============================== */

  function hash(s) {
    var h = 5381, i = s.length;
    while (i) h = (h * 33) ^ s.charCodeAt(--i);
    return (h >>> 0).toString(36);
  }

  function feedKeys() {
    var s = Store.settings;
    if (!s.feeds || !s.feeds.length) s.feeds = [];
    return s.feeds;
  }

  function saveSettings() { Store.saveSettings(); }

  function stripTags(s) {
    return String(s || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(+d); })
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * 清洗摘要。
   *
   * 有些源（典型是 Hacker News）的 description 不是正文，而是一串元信息：
   *   Article URL: https://… Comments URL: https://… Points: 410 # Comments: 88
   * 直接当摘要展示既难看，又会让「生词比例」这类统计失真，所以先剥掉。
   */
  function cleanDesc(s) {
    var t = String(s || '');
    t = t.replace(/\b(?:Article|Comments?|Discussion|Story|Video|Read\s+more|原文|评论)\s*URL\s*[:：]\s*\S+/gi, ' ');
    t = t.replace(/\b(?:Points?|#\s*Comments?|Comments?)\s*[:：]\s*\d+/gi, ' ');
    t = t.replace(/https?:\/\/\S+/gi, ' ');          // 残留的裸链接
    t = t.replace(/\s+/g, ' ').replace(/^[\s·•\-|#>*]+/, '').trim();
    // 剥完之后只剩符号或没剩几个字母，说明这条 description 本来就是元信息而非正文，
    // 宁可当空处理，也不要让一个「#」冒充摘要去参与难度统计。
    if (!/[A-Za-z]{3}/.test(t)) return '';
    return t;
  }

  /* ========================= 精选订阅源目录 ========================= */

  function catalog() {
    if (catalogCache) return Promise.resolve(catalogCache);
    // 目录是本地 asset，正常几毫秒就回来。加超时是因为 asset 通道一旦异常，
    // 这个 fetch 既不成功也不失败，会把「精选源」和默认源预置一起卡住——
    // 界面上的表现就是「订阅源加载失败 / 一个源都没有」。失败不缓存，下次还能重试。
    var p = fetch('data/feeds.json').then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
    return withTimeout(p, 6000, null).then(function (d) {
      if (d && d.categories) {
        catalogError = '';
        catalogCache = d;
        return d;
      }
      catalogError = T('订阅目录读取失败（data/feeds.json 没能加载）');
      return { categories: [], updatedAt: '', error: catalogError };
    });
  }

  function catalogFeeds() {
    return catalog().then(function (d) {
      var out = [];
      (d.categories || []).forEach(function (c) {
        (c.feeds || []).forEach(function (f) {
          var o = {};
          for (var k in f) o[k] = f[k];
          o.cat = c.id;
          o.catName = c.name;
          out.push(o);
        });
      });
      return out;
    });
  }

  /* ======================== 我的订阅：增删改查 ======================== */

  /** 应用升级时补齐新内置源；同时剔除目录中已删除的源（保留用户自定义源） */
  function syncWithCatalog() {
    return catalogFeeds().then(function (known) {
      var map = {};
      known.forEach(function (f) { map[f.id] = f; });

      var list = feedKeys();
      var have = {};
      var changed = false;

      list.forEach(function (f) { have[f.id] = 1; });

      // 1) 只预置少量默认源。
      //    精选目录里其余几十个不自动加入——全新安装时列表里躺着二十多个关着的源
      //    既看不出哪些在用，也把「订阅源」页撑得很长。它们放在「精选源」里按需订阅。
      known.forEach(function (f) {
        if (have[f.id]) return;
        if (DEFAULT_ON.indexOf(f.id) < 0) return;
        list.push({
          id: f.id, name: f.name, url: f.url, cat: f.cat,
          level: f.level || 3, cn: !!f.cn, on: true
        });
        changed = true;
      });

      // 2) 刷新内置源的展示信息（名称 / 分类 / 可直连标记），但不覆盖用户改过的地址
      list.forEach(function (f) {
        var k = map[f.id];
        if (!k || f.custom) return;
        if (f.name !== k.name) { f.name = k.name; changed = true; }
        if (f.url !== k.url && !f.urlEdited) { f.url = k.url; changed = true; }
        if (f.cn !== !!k.cn) { f.cn = !!k.cn; changed = true; }
        if (f.cat !== k.cat) { f.cat = k.cat; changed = true; }
      });

      if (changed) saveSettings();
      return list;
    });
  }

  function list() { return feedKeys(); }

  function enabled() {
    return feedKeys().filter(function (f) { return f.on !== false; });
  }

  function byId(id) {
    var l = feedKeys();
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  }

  function add(feed) {
    var l = feedKeys();
    var id = feed.id || ('c-' + Date.now().toString(36));
    var item = {
      id: id,
      name: feed.name || T('未命名源'),
      url: feed.url,
      cat: feed.cat || 'custom',
      catName: feed.catName || T('自定义'),
      level: feed.level || 3,
      cn: !!feed.cn,
      on: feed.on !== false,
      custom: !feed.fromCatalog
    };
    l.push(item);
    saveSettings();
    return item;
  }

  function remove(id) {
    Store.settings.feeds = feedKeys().filter(function (f) { return f.id !== id; });
    saveSettings();
    if (feeds.sources) delete feeds.sources[id];
  }

  function setOn(id, on) {
    var f = byId(id);
    if (!f) return;
    f.on = !!on;
    saveSettings();
  }

  /* ====================== RSS / Atom / RDF 解析 ======================
   *
   * 「浏览器能打开、应用却解析不出条目」几乎都是同一类原因：
   * DOMParser 的 'text/xml' 是**严格模式**，遇到未转义的 & 、错配标签、
   * 非法字符就直接返回 parsererror；而浏览器在标签页里渲染用的是
   * **宽松解析**，照样把内容显示出来。
   *
   * 所以这里做三层容错：
   *   1) 严格 XML 解析（正常情况）
   *   2) 退化为 'text/html' 宽松解析（浏览器式）
   *   3) 再退化为正则抽取 item / entry 区块
   * 并把「实际用了哪一层、失败原因是什么」原样报给用户。
   * ==================================================================== */

  var DESC_TAGS = ['description', 'summary', 'content:encoded', 'content',
                   'media:description', 'dc:description'];
  var DATE_TAGS = ['pubDate', 'published', 'updated', 'dc:date', 'date'];

  function firstTag(node, tags) {
    for (var i = 0; i < tags.length; i++) {
      var n = node.getElementsByTagName(tags[i])[0];
      if (n && (n.textContent || '').trim()) return n.textContent;
    }
    return '';
  }

  /**
   * 取条目链接。
   * Atom 的 <link> 可能有多个，按 feed-flow / RSSParser 的做法优先 rel="alternate"，
   * 避开 rel="related" / rel="enclosure" 这类非正文链接。
   */
  function linkOf(node) {
    var ls = node.getElementsByTagName('link');
    var best = '';
    for (var i = 0; i < ls.length; i++) {
      var rel = (ls[i].getAttribute('rel') || '').toLowerCase();
      var href = ls[i].getAttribute('href') || '';
      var text = (ls[i].textContent || '').trim();
      if (href && (rel === 'alternate' || rel === '')) return href;
      if (href && !best && rel !== 'enclosure' && rel !== 'related' && rel !== 'self') best = href;
      if (text && !best) best = text;
    }
    if (best) return best;
    var g = node.getElementsByTagName('guid')[0];
    return g ? (g.textContent || '').trim() : '';
  }

  function sniffFormat(raw) {
    var head = String(raw).slice(0, 1500);
    if (/<!doctype\s+html|<html[\s>]/i.test(head)) return 'html';
    if (/<rss[\s>]/i.test(head)) return 'rss';
    if (/<feed[\s>]/i.test(head)) return 'atom';
    if (/<rdf:RDF[\s>]/i.test(head)) return 'rdf';
    if (/<\?xml|<(rss|feed|rdf)/i.test(head)) return 'xml';
    return 'unknown';
  }

  function countEntries(doc) {
    if (!doc || !doc.getElementsByTagName) return 0;
    return doc.getElementsByTagName('item').length + doc.getElementsByTagName('entry').length;
  }

  function tryParse(raw, mime) {
    try { return new DOMParser().parseFromString(raw, mime); }
    catch (e) { return null; }
  }

  function rTag(block, tag) {
    var t = tag.replace(/:/g, '\\:');
    var re = new RegExp('<' + t + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + t + '>', 'i');
    var m = re.exec(block);
    return m ? String(m[1]).replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
  }

  function rAttr(block, tag, attr) {
    var re = new RegExp('<' + tag + '\\b[^>]*\\b' + attr + '\\s*=\\s*["\']([^"\']+)["\']', 'i');
    var m = re.exec(block);
    return m ? m[1] : '';
  }

  function regexEntries(raw) {
    var out = [];
    var re = /<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi;
    var m;
    while ((m = re.exec(raw)) !== null && out.length < 80) {
      var block = m[2];
      out.push({
        title: rTag(block, 'title'),
        link: rAttr(block, 'link', 'href') || rTag(block, 'link') || rTag(block, 'guid'),
        desc: rTag(block, 'description') || rTag(block, 'summary') ||
              rTag(block, 'content:encoded') || rTag(block, 'content'),
        date: rTag(block, 'pubDate') || rTag(block, 'published') ||
              rTag(block, 'updated') || rTag(block, 'dc:date')
      });
    }
    return out;
  }

  /**
   * 解析订阅内容。
   * 返回 { items, format, strict, error }
   *   strict=false 表示降级过（宽松解析或正则），error 里说明原因
   */
  function parseFeed(raw) {
    var res = { items: [], format: sniffFormat(raw), strict: true, error: '' };
    if (!raw || !String(raw).trim()) { res.error = T('响应内容为空'); return res; }

    if (res.format === 'html') {
      res.strict = false;
      res.error = T('返回的是网页（HTML），不是 RSS / Atom 地址');
      return res;
    }

    var doc = tryParse(raw, 'text/xml');
    var pe = (doc && doc.getElementsByTagName) ? doc.getElementsByTagName('parsererror') : null;
    var bad = !doc || (pe && pe.length) ||
      (doc.documentElement && doc.documentElement.nodeName === 'parsererror');
    if (bad) {
      res.strict = false;
      var msg = (pe && pe.length) ? (pe[0].textContent || '') : '';
      res.error = T('XML 不规范（') + String(msg).replace(/\s+/g, ' ').trim().slice(0, 110) + T('），已降级解析');
      doc = tryParse(raw, 'text/html');
    }

    var items = [];
    if (doc && countEntries(doc)) {
      var nodes = doc.getElementsByTagName('item');
      if (!nodes.length) nodes = doc.getElementsByTagName('entry');
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        items.push({
          title: stripTags(firstTag(n, ['title'])),
          link: linkOf(n),
          desc: cleanDesc(stripTags(firstTag(n, DESC_TAGS))).slice(0, 1400),
          date: firstTag(n, DATE_TAGS).slice(0, 25)
        });
      }
    }

    if (!items.length) {
      var rs = regexEntries(raw);
      if (rs.length) {
        items = rs.map(function (x) {
          return {
            title: stripTags(x.title),
            link: x.link,
            desc: stripTags(x.desc).slice(0, 1400),
            date: String(x.date || '').slice(0, 25)
          };
        });
        res.strict = false;
        if (!res.error) res.error = T('标准解析未取到条目，已用正则方式提取');
      }
    }

    res.items = items.filter(function (x) { return x.title || x.desc; });
    if (!res.items.length && !res.error) res.error = T('内容里没有 item / entry 节点');
    return res;
  }

  /* ========================= 错误翻译成大白话 ========================= */

  function humanError(e, status) {
    if (status && status >= 400) return T('服务端返回 HTTP ') + status;
    var t = String(e || '');
    if (!t || t === 'timeout') return T('请求超时（网络不通或被拦截）');
    // 明文被拦要排在 TLS 之前判断：这类报错里也常带 "http"，先匹配 SSL 会误判成握手失败。
    if (/Cleartext|cleartext traffic/i.test(t)) {
      return T('系统拦截了明文 HTTP 请求（该源只有 http 地址）');
    }
    if (/UnknownHost|No address|Unable to resolve|nodename/i.test(t)) return T('域名无法解析，可能被网络拦截');
    if (/ConnectException|Connection refused|ECONNREFUSED|Failed to connect/i.test(t)) return T('连接被拒绝，可能被网络拦截');
    if (/SocketTimeout|timed out|timeout/i.test(t)) return T('连接超时');
    if (/SSL|Cert|handshake/i.test(t)) return T('TLS 握手失败');
    if (/NetworkOnMainThread/i.test(t)) return T('网络请求被放到了主线程（应报告为缺陷）');
    return t;
  }

  /* ============================ 抓取通道 ============================
   *
   * 实测过一种情况：同一台手机、同一个地址，浏览器能拿到完整 XML，
   * 应用却被拦。典型表现是直连返回 403，或返回一个 HTML 拦截页
   * （站点 WAF 按 TLS / 请求指纹识别非浏览器客户端）。
   *
   * 所以分两条通道：
   *   1) 直连优先（快）：原生层 HttpURLConnection，请求头按真实 Chrome 补齐
   *   2) 被拦自动切换：改用隐藏 WebView 加载同一地址，取 outerHTML
   *      —— 这条路走的是和浏览器完全相同的网络栈与 TLS 指纹
   * ================================================================= */

  function fetchFeed(url) {
    var started = Date.now();
    // 关键：把 JS 抢跑时间显式传给原生（opt.timeoutMs），并让它大于原生的
    // 真实超时（连接 2500 + 读取 2000 = 4500ms）。以前这里是 7500ms 对
    // 8000ms 原生最坏值——JS 永远先判自己超时，直连通道看起来「全是无效」。
    var direct = withBudget(
      Bridge.http(url, { timeoutMs: DIRECT_BUDGET - 500 }), DIRECT_BUDGET,
      { ok: false, status: 0, body: '', error: 'timeout' });

    return direct.then(function (r1) {
      var pf1 = parseFeed(r1.body || '');
      var blocked = (r1.status >= 400) || !pf1.items.length;
      if (!blocked || !Bridge.hasWebFetch()) {
        return {
          res: r1, pf: pf1, via: 'direct', tried: ['direct'],
          timedOut: r1.error === 'timeout'
        };
      }
      // 兜底通道有自己完整的预算（不是「直连剩多少算多少」）：以前这里只剩
      // 2 秒左右，而原生隐藏 WebView 要跑到 25 秒才给结论，注定两边都白等。
      var elapsed = Date.now() - started;
      var budget = elapsed > SOURCE_BUDGET ? MIN_WEBVIEW_BUDGET : WEBVIEW_BUDGET;
      return withBudget(
        Bridge.webFetch(url, { timeoutMs: budget - 1000 }), budget,
        { ok: false, status: 0, body: '', error: 'timeout' }).then(function (r2) {
        var pf2 = parseFeed(r2.body || '');
        if (r2.ok && pf2.items.length) {
          return { res: r2, pf: pf2, via: 'webview', tried: ['direct', 'webview'] };
        }
        var useWeb = pf2.items.length > pf1.items.length;
        return {
          res: useWeb ? r2 : r1,
          pf: useWeb ? pf2 : pf1,
          via: 'direct',
          tried: ['direct', 'webview']
        };
      }).catch(function () {
        return { res: r1, pf: pf1, via: 'direct', tried: ['direct'] };
      });
    });
  }

  /**
   * 给单个源的抓取加一道「硬超时」。
   *
   * 两条通道各自都有超时，但通道之间是串联的（直连最坏 5.5s + 兜底最坏 7s），
   * 遇上连接挂死的站点照样要等十几秒；只要有一个源这样，整轮更新就一直转圈，
   * 用户看到的就是「一直卡在这里」。这里从外面再兜一层，超了就先记失败返回，
   * 让整轮更新一定在有限时间内结束。
   */
  function raceTimeout(promise, id) {
    return withBudget(promise, HARD_TIMEOUT, {
      id: id,
      timedOut: true,
      err: T('抓取超时（超过 ') + Math.round(HARD_TIMEOUT / 1000) + T(' 秒没有返回）'),
      raw: T('超时即视为该源无效。可稍后单独「测试连接」重试')
    });
  }

  /**
   * 给任意 Promise 加时间上限：超时或失败都返回 fallback，**永不挂起**。
   * 与 withBudget 的区别是这里的 fallback 会被原样返回（withBudget 会包成
   * 网络错误对象），所以适合包 IndexedDB 这类「不关心失败原因、只关心别卡住」的调用。
   */
  function withTimeout(promise, ms, fallback) {
    return new Promise(function (resolve) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        resolve(fallback);
      }, ms);
      promise.then(function (v) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(v);
      }, function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fallback);
      });
    });
  }

  /** 给一个 Promise 加上时间上限；超了就用 fallback 先返回，不等它 */
  function withBudget(promise, ms, fallback) {
    return new Promise(function (resolve) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        resolve(fallback);
      }, ms);
      promise.then(function (v) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(v);
      }, function (e) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          ok: false, status: 0, body: '',
          error: String((e && e.message) || e || 'request failed')
        });
      });
    });
  }

  /** 抓一个页面（不要求它是 feed），返回原始文本 */
  function fetchText(url) {
    return Bridge.http(url, { timeoutMs: FETCH_TIMEOUT - 1000 }).then(function (r) {
      if (r.status >= 400 && Bridge.hasWebFetch()) {
        return Bridge.webFetch(url, { timeoutMs: FETCH_TIMEOUT - 1000 }).then(function (r2) {
          return r2.ok ? r2 : r;
        }).catch(function () { return r; });
      }
      return r;
    });
  }

  /* ========================== 缓存与刷新管线 ========================== */

  function isStale() {
    if (!feeds.fetchedAt) return true;
    if (U.dayKey(new Date(feeds.fetchedAt)) !== U.dayKey(new Date())) return true;
    return (Date.now() - feeds.fetchedAt) > CACHE_HOURS * 3600000;
  }

  function itemCount() {
    var n = 0;
    Object.keys(feeds.sources || {}).forEach(function (k) {
      n += ((feeds.sources[k] || {}).items || []).length;
    });
    return n;
  }

  function stats() {
    var unread = 0;
    eachItem(function (it) { if (!readSet[it.id]) unread++; });
    return {
      fetchedAt: feeds.fetchedAt,
      count: itemCount(),
      unread: unread,
      stale: isStale(),
      busy: refreshing,
      progress: { done: progress.done, total: progress.total },
      lastResult: feeds.lastResult || null,
      // 订阅目录（data/feeds.json）读不出来时，界面上「精选源 / 预置默认源」
      // 会一个都不出现。把这个原因带出去，才好解释「为什么一个源都没有」。
      catalogError: catalogError
    };
  }

  function loadCache() {
    // 读缓存必须能在存储卡死时返回：IndexedDB 一旦既不成功也不报错，
    // 这里的 Promise.all 会永久悬空，阅读页（view-read.js 也 await 它）
    // 就整页不渲染——这正是用户反馈的「订阅源加载失败 / 一片空白」。
    return withTimeout(
      Promise.all([Store.getMeta('feeds'), Store.getMeta('read'), Store.getMeta('star')]),
      STORE_TIMEOUT, [null, null, null]
    )
      .then(function (r) {
        if (r[0] && typeof r[0] === 'object') feeds = r[0];
        if (r[1] && r[1].ids) readMark = r[1];
        if (r[2] && r[2].ids) starMark = r[2];
        readSet = readMark.ids || {};
        starSet = starMark.ids || {};
        loaded = true;
      });
  }

  function reloadFromStore() {
    feeds = { fetchedAt: 0, sources: {} };
    readMark = { ids: {} };
    starMark = { ids: {} };
    readSet = {};
    starSet = {};
    loaded = false;
    refreshing = false;
    progress = { done: 0, total: 0 };
    return loadCache();
  }

  function refreshAll() {
    if (refreshing) return Promise.resolve(false);
    var on = enabled();
    if (!on.length) {
      U.toast(T('还没有启用任何订阅源'));
      return Promise.resolve(false);
    }
    refreshing = true;
    progress = { done: 0, total: on.length };

    var jobs = on.map(function (f) {
      var p = fetchFeed(f.url).then(function (out) {
        var r = out.res, pf = out.pf;
        if (!pf.items.length) {
          var why = [];
          if (r.error) why.push(humanError(r.error, r.status));
          if (r.status >= 400) why.push('HTTP ' + r.status);
          if (pf.error) why.push(pf.error);
          return {
            id: f.id, name: f.name, timedOut: !!out.timedOut,
            err: (out.timedOut ? T('超时未返回：') : T('没取到条目：')) +
              (why.join('；') || T('未知原因')),
            raw: T('识别格式=') + pf.format + T('，通道=') + out.tried.join('→')
          };
        }
        var items = pf.items.slice(0, MAX_PER_FEED);
        items.forEach(function (it) {
          it.id = hash(it.link || it.title);
          it.feed = f.id;
        });
        var note = '';
        if (out.via === 'webview') note = T('直连被站点拦截，已自动切换浏览器引擎');
        else if (!pf.strict) note = pf.error || T('已容错解析');
        return { id: f.id, name: f.name, items: items, note: note, via: out.via };
      }).catch(function (e) {
        return { id: f.id, name: f.name, err: humanError(e), raw: String((e && e.message) || e) };
      }).then(function (r) {
        progress.done++;
        return r;
      });
      return raceTimeout(p, f.id);
    });

    return Promise.all(jobs).then(function (res) {
      var sources = feeds.sources || {};
      var totalItems = 0;
      res.forEach(function (r) {
        if (r.items) {
          // 成功就清掉「无效」标记，之前失败过也不再顶着红标
          sources[r.id] = { ok: true, at: Date.now(), items: r.items,
                            note: r.note || '', raw: r.raw, invalid: false };
          totalItems += r.items.length;
          return;
        }
        var old = sources[r.id];
        // 抓不到就是抓不到——不管超时还是被拦，这个源在当前网络下都算无效，
        // 界面上要看得出来，用户才知道该换掉它
        sources[r.id] = (old && old.items && old.items.length)
          ? { ok: false, at: old.at, items: old.items, raw: r.raw, invalid: true,
              timedOut: !!r.timedOut,
              error: (r.err || T('更新失败')) + T('（下面是上次缓存）') }
          : { ok: false, at: 0, items: [], raw: r.raw, invalid: true,
              timedOut: !!r.timedOut, error: r.err || T('更新失败') };
        totalItems += ((old && old.items) || []).length;
      });
      feeds.sources = sources;
      feeds.fetchedAt = Date.now();
      // 记下这一轮的结果，界面可以据此解释「为什么是 0 条」
      feeds.lastResult = {
        at: Date.now(),
        total: res.length,
        ok: res.filter(function (r) { return !!r.items; }).length,
        items: totalItems,
        reasons: res.filter(function (r) { return !!r.err; })
          .map(function (r) { return { id: r.id, name: r.name, err: r.err, raw: r.raw }; })
      };
      refreshing = false;
      progress = { done: progress.total, total: progress.total };
      // 写缓存同样不能挂死：界面等的是这个 Promise（「更新」按钮转圈），
      // 存储卡住时它永远不会 resolve。写不进去顶多下次重抓，不影响本次结果。
      return withTimeout(Store.putMeta('feeds', feeds), STORE_TIMEOUT, null)
        .then(function () { return true; });
    }).catch(function (e) {
      refreshing = false;
      progress = { done: 0, total: 0 };
      throw e;
    });
  }

  /** force=true 强制联网；否则过期才联网 */
  function ensureFeeds(force) {
    return loadCache().then(function () {
      if (!force && !isStale()) return false;
      return refreshAll();
    });
  }

  /* ============================ 条目访问 ============================ */

  function eachItem(fn) {
    var l = list();
    l.forEach(function (f) {
      var s = (feeds.sources || {})[f.id];
      if (!s || !s.items) return;
      s.items.forEach(function (it) { fn(it, f, s); });
    });
  }

  function itemById(id) {
    var found = null;
    eachItem(function (it, f, s) {
      if (it.id === id) found = { item: it, feed: f, source: s };
    });
    return found;
  }

  /** 某个源的缓存状态（供界面展示错误与更新时间） */
  function sourceState(id) {
    return (feeds.sources || {})[id] || null;
  }

  /** 已发布的时间戳（解析失败则 0） */
  function tsOf(it) {
    if (it._ts !== undefined) return it._ts;
    var t = 0;
    if (it.date) {
      t = Date.parse(it.date);
      if (isNaN(t)) t = 0;
    }
    it._ts = t;
    return t;
  }

  /** 全部条目：已读/收藏状态已挂上，按时间倒序。同一条稿件被多个源转载时只保留一份 */
  function allItems() {
    var out = [];
    var seenIds = {};
    var blocked = blockedWords();
    eachItem(function (it, f) {
      if (seenIds[it.id]) return;          // 通讯社稿件常被多家媒体转载，按链接去重
      if (!passesBlock(it, blocked)) return;
      seenIds[it.id] = 1;
      out.push({
        id: it.id,
        title: it.title,
        link: it.link,
        desc: it.desc,
        date: it.date,
        ts: tsOf(it),
        feedId: f.id,
        feedName: f.name,
        level: f.level || 3,
        read: !!readSet[it.id],
        star: !!starSet[it.id]
      });
    });
    out.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
    return out;
  }

  /* ============================ 已读 / 收藏 ============================ */

  function markRead(id, on) {
    if (on === false) delete readMark.ids[id];
    else readMark.ids[id] = Date.now();
    readSet = readMark.ids;
    return Store.putMeta('read', readMark);
  }

  function toggleStar(id) {
    if (starMark.ids[id]) delete starMark.ids[id];
    else starMark.ids[id] = Date.now();
    starSet = starMark.ids;
    return Store.putMeta('star', starMark).then(function () {
      return !!starSet[id];
    });
  }

  function markAllRead(items) {
    items.forEach(function (it) { readMark.ids[it.id] = Date.now(); });
    readSet = readMark.ids;
    return Store.putMeta('read', readMark);
  }

  /* ============================== 屏蔽词 ============================== */

  function blockedWords() {
    var b = Store.settings.blocked;
    return (b && b.length) ? b : [];
  }

  function passesBlock(it, words) {
    words = words || blockedWords();
    if (!words.length) return true;
    var hay = ((it.title || '') + ' ' + (it.desc || '')).toLowerCase();
    for (var i = 0; i < words.length; i++) {
      var w = String(words[i] || '').trim().toLowerCase();
      if (w && hay.indexOf(w) >= 0) return false;
    }
    return true;
  }

  /* ========================== 订阅源自动发现 ==========================
   *
   * 对应 feed-flow 的 FeedUrlRetriever：用户粘贴的是网站首页（甚至文章页），
   * 需要从 HTML 里找出 <link rel="alternate" type="application/rss+xml">，
   * 找不到再试常见的 feed 路径。
   * =================================================================== */

  var COMMON_PATHS = ['/feed', '/feed/', '/rss', '/rss.xml', '/atom.xml',
                      '/index.xml', '/feed.xml', '/feeds/all.atom.xml', '/?feed=rss2'];

  function absUrl(href, base) {
    try { return new URL(href, base).href; }
    catch (e) { return null; }
  }

  function htmlFeedLinks(html, base) {
    var out = [];
    var re = /<link\b[^>]*>/gi;
    var m;
    while ((m = re.exec(html)) !== null) {
      var tag = m[0];
      var type = /type\s*=\s*["']([^"']+)["']/i.exec(tag);
      if (!type) continue;
      var t = type[1].toLowerCase();
      if (t.indexOf('application/rss+xml') !== 0 && t.indexOf('application/atom+xml') !== 0 &&
          t.indexOf('application/feed+json') !== 0) continue;
      var href = /href\s*=\s*["']([^"']+)["']/i.exec(tag);
      if (!href) continue;
      var u = absUrl(href[1], base);
      if (u && out.indexOf(u) < 0) out.push(u);
    }
    // 兜底：HTML 里散落的 a 标签
    var re2 = /<a\b[^>]*href\s*=\s*["']([^"']*(?:rss|feed|atom)[^"']*)["']/gi;
    while ((m = re2.exec(html)) !== null) {
      var u2 = absUrl(m[1], base);
      if (u2 && out.indexOf(u2) < 0 && out.length < 8) out.push(u2);
    }
    return out;
  }

  /**
   * 找出真正可用的 feed 地址。
   * 返回 { url, pf, candidates, via }
   */
  function discover(url) {
    var u = String(url || '').trim();
    if (!/^https?:\/\//i.test(u)) return Promise.resolve({ error: T('地址需要以 http:// 或 https:// 开头') });

    // 1) 先当作 feed 直接试
    return fetchFeed(u).then(function (out) {
      if (out.pf.items.length) {
        return { url: u, pf: out.pf, via: out.via };
      }
      // 2) 当作网页，去 HTML 里找
      var html = (out.res && out.res.body) || '';
      var cands = htmlFeedLinks(html, u);
      COMMON_PATHS.forEach(function (p) {
        var x = absUrl(p, u);
        if (x && cands.indexOf(x) < 0) cands.push(x);
      });

      // 逐个试，命中即止（最多试 6 个，避免打太久）
      var list = cands.slice(0, 6);
      var i = 0;
      function next() {
        if (i >= list.length) return Promise.resolve(null);
        var c = list[i++];
        return fetchFeed(c).then(function (r) {
          if (r.pf.items.length) return { url: c, pf: r.pf, via: r.via };
          return next();
        });
      }
      return next().then(function (hit) {
        if (hit) return hit;
        return {
          error: T('这个地址看起来不是订阅源，也没能在页面里找到 RSS 链接'),
          detail: parseFeed(html).error || T('页面里没有 <link rel="alternate" type="application/rss+xml">'),
          candidates: cands.slice(0, 8)
        };
      });
    });
  }

  /* ============================== OPML ============================== */

  function parseOpml(text) {
    var out = { feeds: [], error: '' };
    if (!text || !String(text).trim()) { out.error = T('文件内容为空'); return out; }

    // OPML 里常有未转义的 &，严格解析会直接失败，所以先宽松解析
    var doc = tryParse(text, 'text/xml');
    var pe = doc && doc.getElementsByTagName ? doc.getElementsByTagName('parsererror') : null;
    if (!doc || (pe && pe.length)) doc = tryParse(text, 'text/html');

    var nodes = doc ? doc.getElementsByTagName('outline') : null;
    if (nodes && nodes.length) {
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        var url = n.getAttribute('xmlUrl') || n.getAttribute('xmlurl') || '';
        if (!url) continue;
        var parentCat = '';
        var p = n.parentNode;
        if (p && p.getAttribute) parentCat = p.getAttribute('text') || p.getAttribute('title') || '';
        out.feeds.push({
          name: n.getAttribute('title') || n.getAttribute('text') || url,
          url: url,
          catName: parentCat,
          htmlUrl: n.getAttribute('htmlUrl') || ''
        });
      }
    }

    // 正则兜底
    if (!out.feeds.length) {
      var re = /<outline\b[^>]*\bxmlUrl\s*=\s*["']([^"']+)["'][^>]*>/gi;
      var m;
      while ((m = re.exec(text)) !== null) {
        var tag = m[0];
        var title = /(?:title|text)\s*=\s*["']([^"']*)["']/i.exec(tag);
        out.feeds.push({ name: title ? title[1] : m[1], url: m[1], catName: '' });
      }
    }

    if (!out.feeds.length) out.error = T('没有解析出任何订阅源（文件里没有 xmlUrl 属性）');
    return out;
  }

  function buildOpml() {
    var l = list();
    var byCat = {};
    l.forEach(function (f) {
      var k = f.catName || f.cat || T('未分类');
      (byCat[k] = byCat[k] || []).push(f);
    });
    var esc = function (s) {
      return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    };
    var body = Object.keys(byCat).map(function (cat) {
      return '    <outline text="' + esc(cat) + '" title="' + esc(cat) + '">\n' +
        byCat[cat].map(function (f) {
          return '      <outline type="rss" text="' + esc(f.name) + '" title="' + esc(f.name) +
            '" xmlUrl="' + esc(f.url) + '"' + (f.htmlUrl ? ' htmlUrl="' + esc(f.htmlUrl) + '"' : '') + '/>';
        }).join('\n') + '\n    </outline>';
    }).join('\n');

    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<opml version="2.0">\n  <head>\n' +
      T('    <title>乐学英语 · 订阅源</title>\n') +
      '    <dateCreated>' + new Date().toUTCString() + '</dateCreated>\n' +
      '  </head>\n  <body>\n' + body + '\n  </body>\n</opml>\n';
  }

  /** 导入 OPML：同 id（按 url 去重）则跳过 */
  function importOpml(text, defaultOn) {
    var p = parseOpml(text);
    if (!p.feeds.length) return Promise.resolve({ ok: false, error: p.error });

    var l = feedKeys();
    var have = {};
    l.forEach(function (f) { have[f.url] = 1; });

    var added = 0;
    p.feeds.forEach(function (f) {
      if (!/^https?:\/\//i.test(f.url) || have[f.url]) return;
      have[f.url] = 1;
      l.push({
        id: 'c-' + hash(f.url),
        name: f.name || f.url,
        url: f.url,
        cat: 'custom',
        catName: f.catName || T('导入'),
        level: 3,
        on: defaultOn !== false,
        custom: true
      });
      added++;
    });
    if (added) saveSettings();
    return Promise.resolve({ ok: true, added: added, total: p.feeds.length });
  }

  /* ============================== 导出 ============================== */

  /** 该源当前是否已被判定为无效（上一轮抓取失败） */
  function isInvalid(id) {
    var s = (feeds.sources || {})[id];
    return !!(s && s.invalid);
  }

  global.Feed = {
    MAX_PER_FEED: MAX_PER_FEED,

    // 目录
    catalog: catalog,
    catalogFeeds: catalogFeeds,

    // 我的订阅
    list: list, enabled: enabled, byId: byId, add: add, remove: remove, setOn: setOn,
    syncWithCatalog: syncWithCatalog, DEFAULT_ON: DEFAULT_ON,

    // 解析与抓取
    parseFeed: parseFeed, sniffFormat: sniffFormat, humanError: humanError,
    isInvalid: isInvalid, withBudget: withBudget,
    // 暴露预算，便于测试与排查「为什么这个源被判超时」
    budget: {
      get source() { return SOURCE_BUDGET; },
      get direct() { return DIRECT_BUDGET; }
    },
    cleanDesc: cleanDesc,
    fetchFeed: fetchFeed, fetchText: fetchText, stripTags: stripTags, hash: hash,

    // 缓存管线
    loadCache: loadCache, reloadFromStore: reloadFromStore,
    refreshAll: refreshAll, ensureFeeds: ensureFeeds,
    isStale: isStale, stats: stats, itemCount: itemCount,

    // 条目
    allItems: allItems, itemById: itemById, tsOf: tsOf, sourceState: sourceState,

    // 标记
    markRead: markRead, markAllRead: markAllRead, toggleStar: toggleStar,
    isRead: function (id) { return !!readSet[id]; },
    isStar: function (id) { return !!starSet[id]; },

    // 屏蔽词
    blockedWords: blockedWords, passesBlock: passesBlock,

    // 发现 / OPML
    discover: discover, parseOpml: parseOpml, buildOpml: buildOpml, importOpml: importOpml
  };
})(window);
