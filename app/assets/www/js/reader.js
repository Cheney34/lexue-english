/* ============================================================================
 * 阅读模式
 *
 * 把一篇网页正文抓回来、去掉导航/广告/推荐位，只留可读的段落，
 * 再按本应用的能力渲染：点词查义、生词高亮、朗读、字号、一键入生词本。
 *
 * 这一层只处理「HTML → 结构化段落」，渲染与交互在下面 Reader.open()。
 * 正文提取思路参考 prof18/feed-flow 的 Reader Mode（Apache-2.0）与其
 * ReaderModeEligibility 的准入判断。
 * ========================================================================== */
(function (global) {
  'use strict';

  var FULLTEXT_CAP = 40;         // 最多缓存多少篇正文
  var MIN_BLOCK_TEXT = 30;       // 一个候选容器的正文下限

  /* ============================ 准入判断 ============================ */

  var BLOCKED_EXT = ('pdf doc docx xls xlsx ppt pptx epub mobi azw3 zip rar 7z tar gz bz2 ' +
    'apk exe dmg iso mp3 mp4 avi mkv mov wav flac aac jpg jpeg png gif webp svg').split(' ');

  var BLOCKED_HOST = /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com|t\.me|telegram\.me)$/i;

  function canOpen(url) {
    var u = String(url || '').trim();
    if (!/^https?:\/\//i.test(u)) return false;
    var o;
    try { o = new URL(u); } catch (e) { return false; }
    if (BLOCKED_HOST.test(o.hostname)) return false;
    var path = o.pathname.toLowerCase();
    var ext = path.slice(path.lastIndexOf('.') + 1);
    if (ext && BLOCKED_EXT.indexOf(ext) >= 0) return false;
    if (/\.pdf($|\?)/i.test(u)) return false;
    return true;
  }

  /* ============================ 正文提取 ============================ */

  var JUNK_TAG = {
    script: 1, style: 1, noscript: 1, iframe: 1, svg: 1, canvas: 1, form: 1,
    button: 1, input: 1, select: 1, textarea: 1, nav: 1, header: 1, footer: 1,
    aside: 1, dialog: 1, template: 1
  };

  /** 已知的 cookie / 同意管理平台（CMP）容器标记，按子串匹配 */
  var CMP_HINT = /onetrust|ot-sdk|qc-cmp|truste|didomi|sp_message|cc-window|cky-|cookie|consent|gdpr|privacy-|cmp-container/i;

  /**
   * 提示条文案特征。
   * 很多站点（尤其 SPA）的静态 HTML 里根本没有正文，只剩一根 cookie 提示条——
   * 它字够多、链接密度也不高，很容易被误当成正文。这类候选直接排除。
   */
  var BANNER_TEXT = /by continuing to browse|this (?:site|website) uses cookies|we use cookies|accept (?:all )?cookies|manage (?:your )?cookie|change your cookie settings|privacy policy and terms of use|subscribe to our newsletter|enable javascript|please turn on javascript/i;

  var JUNK_ATTR = new RegExp(
    '(^|[-_ ])(' +
    'ad|ads|advert|advertisement|banner|promo|sponsor|' +
    'share|sharing|social|follow|subscribe|newsletter|signup|' +
    'comment|comments|disqus|reply|' +
    'related|recommend|recommendation|readmore|more-|popular|trending|' +
    'sidebar|aside|widget|menu|nav|navbar|breadcrumb|pagination|pager|' +
    'cookie|consent|gdpr|popup|modal|overlay|paywall|' +
    'copyright|footer|header|masthead|toolbar|byline-share|meta-|tags|tag-list' +
    ')([-_ ]|$)', 'i');

  function junkByHint(el) {
    var cls = (el.getAttribute && (el.getAttribute('class') || '')) || '';
    var id = (el.getAttribute && (el.getAttribute('id') || '')) || '';
    var role = (el.getAttribute && (el.getAttribute('role') || '')) || '';
    if (/^(banner|navigation|complementary|search|dialog|menu|menubar|contentinfo)$/i.test(role)) return true;
    if ((el.getAttribute && el.getAttribute('aria-hidden')) === 'true') return true;
    if (JUNK_ATTR.test(cls) || JUNK_ATTR.test(id)) return true;
    if (CMP_HINT.test(cls) || CMP_HINT.test(id)) return true;
    var style = (el.getAttribute && (el.getAttribute('style') || '')) || '';
    if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(style)) return true;
    return false;
  }

  /**
   * 摘掉明显不是正文的节点。
   * 顺带回报「有没有摘掉过 cookie / JS 提示条」——如果整页只剩这种东西，
   * 后面就能给出比「没识别出正文」更准确的原因。
   */
  function prune(root) {
    var all = root.getElementsByTagName('*');
    var drop = [];
    var banner = false;
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var tag = (el.tagName || '').toLowerCase();
      if (!(JUNK_TAG[tag] || junkByHint(el))) continue;
      if (!banner) {
        var cls = (el.getAttribute && (el.getAttribute('class') || '')) || '';
        var id = (el.getAttribute && (el.getAttribute('id') || '')) || '';
        if (CMP_HINT.test(cls) || CMP_HINT.test(id) || BANNER_TEXT.test(norm(el.textContent))) {
          banner = true;
        }
      }
      drop.push(el);
    }
    drop.forEach(function (el) {
      try { el.parentNode.removeChild(el); } catch (e) {}
    });
    return { removed: drop.length, banner: banner };
  }

  function norm(s) {
    return String(s || '').replace(/\s+/g, ' ').trim();
  }

  function textLen(el) {
    return norm(el.textContent).length;
  }

  function parasOf(el) {
    var ps = el.getElementsByTagName('p');
    var out = [];
    for (var i = 0; i < ps.length; i++) {
      if (norm(ps[i].textContent).length >= 20) out.push(ps[i]);
    }
    return out;
  }

  function linkLen(el) {
    var as = el.getElementsByTagName('a');
    var n = 0;
    for (var i = 0; i < as.length; i++) n += textLen(as[i]);
    return n;
  }

  function metaOf(doc, names) {
    for (var i = 0; i < names.length; i++) {
      var sel = 'meta[property="' + names[i] + '"],meta[name="' + names[i] + '"],' +
                'meta[itemprop="' + names[i] + '"]';
      var n = doc.querySelector(sel);
      if (n && n.getAttribute('content')) return norm(n.getAttribute('content'));
    }
    return '';
  }

  function absolutize(src, base, el) {
    var raw = src;
    if (!raw && el) {
      raw = el.getAttribute('data-src') || el.getAttribute('data-original') ||
            el.getAttribute('data-lazy-src') || '';
      if (!raw && el.getAttribute('srcset')) {
        raw = String(el.getAttribute('srcset')).split(',')[0].split(/\s+/)[0];
      }
    }
    if (!raw) return null;
    if (/^data:/i.test(raw)) return raw.length > 2048 ? raw : null;   // 过滤打点像素
    try { return new URL(raw, base || undefined).href; } catch (e) { return null; }
  }

  var BLOCK_TAGS = {
    p: 'p', h1: 'h2', h2: 'h2', h3: 'h3', h4: 'h3', h5: 'h3', h6: 'h3',
    blockquote: 'quote', pre: 'pre', figure: 'figure', img: 'img',
    ul: 'list', ol: 'list', li: 'li', hr: 'hr'
  };
  var RECURSE = { div: 1, section: 1, article: 1, main: 1, span: 1, td: 1, tbody: 1, center: 1 };

  function blocksOf(container, base) {
    var out = [];

    function pushImg(el) {
      var src = absolutize(el.getAttribute('src'), base, el);
      if (!src) return;
      var w = parseInt(el.getAttribute('width') || '0', 10);
      var h = parseInt(el.getAttribute('height') || '0', 10);
      if ((w && w < 80) || (h && h < 60)) return;
      out.push({ t: 'img', src: src, alt: norm(el.getAttribute('alt')) });
    }

    function walk(node, depth) {
      if (depth > 14 || out.length > 400) return;
      var kids = node.children || [];
      for (var i = 0; i < kids.length; i++) {
        var el = kids[i];
        var tag = (el.tagName || '').toLowerCase();
        var kind = BLOCK_TAGS[tag];

        if (tag === 'ul' || tag === 'ol') {
          walk(el, depth + 1);
          continue;
        }
        if (kind === 'li') {
          var t = norm(el.textContent);
          if (t) out.push({ t: 'li', text: t });
          continue;
        }
        if (kind === 'img') { pushImg(el); continue; }
        if (kind === 'figure') {
          var img = el.getElementsByTagName('img')[0];
          if (img) pushImg(img);
          var cap = el.getElementsByTagName('figcaption')[0];
          if (cap && norm(cap.textContent)) out.push({ t: 'cap', text: norm(cap.textContent) });
          continue;
        }
        if (kind === 'hr') { out.push({ t: 'hr' }); continue; }
        if (kind) {
          var txt = norm(el.textContent);
          if (kind === 'pre') {
            if (txt) out.push({ t: 'pre', text: el.textContent.replace(/\s+$/, '') });
          } else if (txt.length >= (kind === 'p' ? 2 : 1)) {
            out.push({ t: kind, text: txt });
          }
          continue;
        }
        if (RECURSE[tag]) walk(el, depth + 1);
      }
    }

    walk(container, 0);
    return out;
  }

  /**
   * 从整页 HTML 里抽出正文。
   * 返回 { title, site, byline, blocks, text, words, ok, reason }
   */
  function extract(html, baseUrl) {
    var res = { title: '', site: '', byline: '', blocks: [], text: '', words: 0, ok: false, reason: '' };
    if (!html || String(html).length < 800) {
      res.reason = T('返回内容太短，可能被拦截或需要 JavaScript 渲染');
      return res;
    }

    var doc;
    try { doc = new DOMParser().parseFromString(html, 'text/html'); } catch (e) {
      res.reason = T('HTML 解析失败');
      return res;
    }
    if (!doc || !doc.body) { res.reason = T('HTML 解析失败'); return res; }

    res.title = metaOf(doc, ['og:title', 'twitter:title', 'headline']) ||
      norm((doc.querySelector('h1') || {}).textContent || '') ||
      norm((doc.title || '').replace(/\s*[|\-–—]\s*[^|\-–—]{0,30}$/, ''));
    res.site = metaOf(doc, ['og:site_name', 'twitter:site', 'application-name']);
    res.byline = metaOf(doc, ['author', 'article:author', 'og:article:author', 'byl']);
    if (!res.byline) {
      var a = doc.querySelector('[rel="author"],[itemprop="author"]');
      if (a) res.byline = norm(a.textContent).slice(0, 60);
    }

    var base = (doc.querySelector('base[href]') || {}).href || baseUrl || '';
    var pruned = prune(doc.body);

    // ---- 候选打分 ----
    var sel = 'article,main,[role="main"],[itemprop="articleBody"],' +
      '.post-content,.entry-content,.article-content,.article-body,.article__body,' +
      '.content-body,.story-body,.post-body,.rich_media_content,#content,.content,' +
      '.mw-parser-output,.markdown-body';
    var cands = [];
    try {
      var nodes = doc.querySelectorAll(sel);
      for (var i = 0; i < nodes.length; i++) cands.push(nodes[i]);
    } catch (e) {}
    // 含 2 段以上正文的 div / section 也纳入候选
    var divs = doc.getElementsByTagName('div');
    for (var j = 0; j < divs.length; j++) {
      if (parasOf(divs[j]).length >= 2) cands.push(divs[j]);
    }
    var secs = doc.getElementsByTagName('section');
    for (var k = 0; k < secs.length; k++) {
      if (parasOf(secs[k]).length >= 2) cands.push(secs[k]);
    }

    var best = null, bestText = 0, bestBlocks = null, sawBanner = pruned.banner;
    var seen = [];
    for (var c = 0; c < cands.length; c++) {
      var el2 = cands[c];
      if (seen.indexOf(el2) >= 0) continue;
      seen.push(el2);
      var ps = parasOf(el2);
      if (!ps.length) continue;
      var pt = 0;
      for (var q = 0; q < ps.length; q++) pt += norm(ps[q].textContent).length;
      if (pt < MIN_BLOCK_TEXT) continue;
      var total = textLen(el2) || 1;
      var linkD = linkLen(el2) / total;
      if (linkD > 0.55) continue;                       // 链接密度过高 = 导航/列表页
      if (BANNER_TEXT.test(norm(el2.textContent))) { sawBanner = true; continue; }  // cookie / JS 提示条
      var blocks = blocksOf(el2, base);
      var blockText = 0;
      blocks.forEach(function (b) { blockText += (b.text || '').length; });
      if (blockText < MIN_BLOCK_TEXT) continue;

      // 取「正文量最大」的候选；在正文量相差不到 10% 时，选总文本更少的那个
      // ——它更贴近真正的正文容器，而不是裹着评论区的整页 div。
      if (blockText > bestText * 1.1) {
        best = el2; bestText = blockText; bestBlocks = blocks;
      } else if (bestBlocks && blockText > bestText * 0.9 && total < textLen(best)) {
        best = el2; bestText = blockText; bestBlocks = blocks;
      }
    }

    if (!bestBlocks) {
      // 兜底：全页所有够长的 <p>
      var allP = parasOf(doc.body).filter(function (p) {
        return !BANNER_TEXT.test(norm(p.textContent));
      });
      if (allP.length) {
        bestBlocks = allP.map(function (p) { return { t: 'p', text: norm(p.textContent) }; });
      }
    }

    if (!bestBlocks || !bestBlocks.length) {
      res.reason = sawBanner
        ? T('页面里只有站点提示条（cookie / 需开启 JavaScript），没有找到正文；') +
          T('这个页面很可能由 JavaScript 渲染')
        : T('没能识别出正文，可能这个页面需要登录或由 JavaScript 动态渲染');
      return res;
    }

    // 合并：连续 li 归组、连续 hr 去重
    var merged = [];
    bestBlocks.forEach(function (b) {
      var last = merged[merged.length - 1];
      if (b.t === 'hr' && last && last.t === 'hr') return;
      merged.push(b);
    });

    res.blocks = merged;
    res.text = merged.map(function (b) { return b.text || ''; }).join('\n');
    res.words = (res.text.match(/[A-Za-z][A-Za-z'’\-]*/g) || []).length;

    if (BANNER_TEXT.test(res.text)) {
      res.ok = false;
      res.reason = T('抓到的是站点提示条（cookie / 需开启 JavaScript），不是正文。') +
        T('这个页面很可能由 JavaScript 渲染，可在「管理订阅源」里对它的域名使用浏览器引擎重试。');
      res.blocks = [];
      res.text = '';
      res.words = 0;
      return res;
    }

    res.ok = res.words >= 25;
    if (!res.ok) res.reason = T('正文过短（') + res.words + T(' 词），可能是列表页或摘要页');
    return res;
  }

  /**
   * 抓一篇文章的正文。
   *
   * 直连拿到的是**未经 JavaScript 执行**的原始 HTML，很多站点（SPA / 前端渲染）
   * 的正文压根不在里面，只剩一根 cookie 提示条。所以：直连没提取出可用正文时，
   * 自动改用隐藏 WebView 再抓一次——那条路会真正执行页面脚本。
   */
  function fetchArticle(url) {
    return Feed.fetchText(url).then(function (r1) {
      var ex1 = extract(r1.body || '', url);
      if (ex1.ok || !Bridge.hasWebFetch()) return { ex: ex1, via: 'direct', tried: ['direct'] };
      return Bridge.webFetch(url).then(function (r2) {
        var ex2 = extract(r2.body || '', url);
        if (ex2.ok) return { ex: ex2, via: 'webview', tried: ['direct', 'webview'] };
        return ex2.words > ex1.words
          ? { ex: ex2, via: 'webview', tried: ['direct', 'webview'] }
          : { ex: ex1, via: 'direct', tried: ['direct', 'webview'] };
      }).catch(function () {
        return { ex: ex1, via: 'direct', tried: ['direct'] };
      });
    });
  }

  /* ============================ 正文字典/分词 ============================ */

  function tokenize(text) {
    var out = [];
    var re = /[A-Za-z][A-Za-z'’\-]*/g;
    var last = 0, m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) out.push({ t: text.slice(last, m.index) });
      out.push({ t: m[0], w: 1 });
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push({ t: text.slice(last) });
    return out;
  }

  /** 把一段文字渲染成可点词节点 */
  function renderText(text, cmap, hl) {
    var bookId = Store.settings.bookId;
    return tokenize(text).map(function (tk) {
      if (!tk.w) return U.esc(tk.t);
      var raw = tk.t;
      var low = raw.toLowerCase().replace(/^['\-]+|['\-]+$/g, '');
      var e = low.length > 1 ? Dict.lemma(low) : null;
      var word = e ? e.word : low;
      var known = !!(e && cmap[e.word]);
      var isNew = hl && !known && !!(e && Dict.inBook(e, bookId));
      return '<span class="wd' + (isNew ? ' new' : '') + (known ? ' known' : '') +
        '" data-w="' + U.attr(word) + '">' + U.esc(raw) + '</span>';
    }).join('');
  }

  /* ============================ 正文缓存 ============================ */

  var ftCache = null;

  function loadFulltext() {
    if (ftCache) return Promise.resolve(ftCache);
    return Store.getMeta('fulltext').then(function (v) {
      ftCache = v && v.docs ? v : { docs: {} };
      return ftCache;
    });
  }

  function getFulltext(id) {
    return loadFulltext().then(function (c) { return c.docs[id] || null; });
  }

  function putFulltext(id, doc) {
    return loadFulltext().then(function (c) {
      c.docs[id] = doc;
      c.docs[id].at = Date.now();
      var keys = Object.keys(c.docs);
      if (keys.length > FULLTEXT_CAP) {
        keys.sort(function (a, b) { return (c.docs[a].at || 0) - (c.docs[b].at || 0); });
        while (keys.length > FULLTEXT_CAP) delete c.docs[keys.shift()];
      }
      return Store.putMeta('fulltext', c);
    });
  }

  function clearFulltext() {
    ftCache = { docs: {} };
    return Store.putMeta('fulltext', ftCache);
  }

  /* ============================== 渲染 ============================== */

  var state = { fontSize: 17, hl: true };

  function loadPrefs() {
    var s = Store.settings;
    if (typeof s.readerFont === 'number') state.fontSize = s.readerFont;
    if (typeof s.readerHl === 'boolean') state.hl = s.readerHl;
  }

  function savePrefs() {
    Store.settings.readerFont = state.fontSize;
    Store.settings.readerHl = state.hl;
    Store.saveSettings();
  }

  function blocksHtml(blocks, cmap, hl) {
    var useHl = (hl === undefined) ? state.hl : !!hl;
    var out = [];
    var liBuf = [];
    function flushLi() {
      if (!liBuf.length) return;
      out.push('<ul>' + liBuf.join('') + '</ul>');
      liBuf = [];
    }
    blocks.forEach(function (b) {
      if (b.t !== 'li') flushLi();
      if (b.t === 'p') out.push('<p>' + renderText(b.text, cmap, useHl) + '</p>');
      // 标题/图注也切成可点词：以前只 U.esc() 成纯文本，大标题上的生词点不动（1.2.3 修复）。
      else if (b.t === 'h2') out.push('<h2>' + renderText(b.text, cmap, false) + '</h2>');
      else if (b.t === 'h3') out.push('<h3>' + renderText(b.text, cmap, false) + '</h3>');
      else if (b.t === 'quote') out.push('<blockquote>' + renderText(b.text, cmap, useHl) + '</blockquote>');
      else if (b.t === 'pre') out.push('<pre>' + U.esc(b.text) + '</pre>');
      else if (b.t === 'cap') out.push('<figcaption>' + renderText(b.text, cmap, false) + '</figcaption>');
      else if (b.t === 'li') liBuf.push('<li>' + renderText(b.text, cmap, useHl) + '</li>');
      else if (b.t === 'img') out.push('<img class="rd-img" src="' + U.attr(b.src) +
        '" alt="' + U.attr(b.alt || '') + '" loading="lazy">');
      else if (b.t === 'hr') out.push('<hr>');
    });
    flushLi();
    return out.join('');
  }

  /** 摘要文本 → 段落块 */
  function blocksFromSummary(text) {
    var t = String(text || '').trim();
    if (!t) return [];
    var parts = t.split(/\n{2,}|(?<=[.!?。！？])\s+(?=[A-Z])/).filter(function (x) {
      return norm(x).length > 1;
    });
    if (parts.length <= 1) parts = [t];
    return parts.map(function (x) { return { t: 'p', text: norm(x) }; });
  }

  function newWordsOf(blocks, cmap) {
    var seen = {}, list = [];
    var bookId = Store.settings.bookId;
    blocks.forEach(function (b) {
      if (!b.text) return;
      U.extractWords(b.text, { minLen: 3, skipStop: true }).forEach(function (w) {
        if (seen[w]) return;
        seen[w] = 1;
        var e = Dict.lemma(w);
        if (e && !cmap[e.word] && Dict.inBook(e, bookId)) list.push(e.word);
      });
    });
    return list;
  }

  /** 中英对照开关：进程内保留，换文章/回列表再进来仍是你上次的选择 */
  var biOn = false;

  /**
   * 打开阅读器。
   * article: { id, title, link, source, dateText, desc|body, builtin, isBuiltin }
   */
  function open(article, onClose) {
    loadPrefs();
    var full = null;      // 已抓到的正文
    var busy = false;
    var host = null;
    var title = article.title || T('阅读');

    function headerHtml() {
      var bits = [];
      if (article.source) bits.push(U.esc(article.source));
      if (article.dateText) bits.push(U.esc(article.dateText));
      return bits.length ? '<div class="rd-meta">' + bits.join(' · ') + '</div>' : '';
    }

    function toolbarHtml() {
      var starred = Feed.isStar(article.id);
      return '<div class="reader-toolbar">' +
        '<button class="btn sm ghost" data-a="minus">A−</button>' +
        '<button class="btn sm ghost" data-a="plus">A＋</button>' +
        '<button class="btn sm ' + (state.hl ? '' : 'ghost') + T('" data-a="hl">生词</button>') +
        '<button class="btn sm ' + (biOn ? '' : 'ghost') + '" data-a="bi">' + I18N.L('biLabel') + '</button>' +
        T('<button class="btn sm ghost" data-a="speak">朗读</button>') +
        '<button class="btn sm ghost" data-a="star">' + (starred ? '★' : '☆') + '</button>' +
        (article.link && canOpen(article.link)
          ? '<button class="btn sm ghost" data-a="full">' + (full ? T('重新抓取') : T('载入全文')) + '</button>'
          : '') +
        (article.link ? T('<button class="btn sm ghost" data-a="ext">原文</button>') : '') +
        '</div>';
    }

    function bodyHtml(cmap) {
      var blocks;
      if (article.builtin) {
        blocks = (article.body || []).map(function (p) { return { t: 'p', text: p }; });
      } else if (full && full.blocks && full.blocks.length) {
        blocks = full.blocks;
      } else {
        blocks = blocksFromSummary(article.desc);
      }
      if (!blocks.length) {
        return '<div class="empty"><div class="big">📄</div>' +
          T('<p>这条订阅只提供了标题与链接，点上方「载入全文」把正文抓回来。</p></div>');
      }
      var fresh = newWordsOf(blocks, cmap);
      var total = 0;
      blocks.forEach(function (b) { total += (b.text || '').length; });
      return '<div class="rd-body article-body" style="font-size:' + state.fontSize + 'px">' +
        blocksHtml(blocks, cmap) + '</div>' +
        '<div class="card tight mt12"><div class="row between">' +
        T('<div class="grow"><div class="small bold">待记 ') + fresh.length + T(' 词</div>') +
        '<div class="xsmall muted mt8">' + (full ? T('已抓取正文') : T('当前为摘要')) +
        T(' · 约 ') + (article.builtin ? (article.body || []).join(' ') : (full ? full.text : article.desc || '')).split(/\s+/).length + T(' 词</div></div>') +
        T('<button class="btn sm" data-a="addall">全部入库</button>') +
        '</div></div>';
    }

    function paint() {
      if (!host) return Promise.resolve();
      return Promise.all([Store.cardMap(), article.link ? getFulltext(article.id) : null])
        .then(function (r) {
          if (r[1] && r[1].blocks) full = r[1];
          host.innerHTML =
            '<div class="rd-wrap">' +
              headerHtml() +
              '<h1 class="rd-title">' + renderText(article.title || '', r[0], false) + '</h1>' +
              toolbarHtml() +
              '<div id="rd-status"></div>' +
              '<div id="rd-body">' + bodyHtml(r[0]) + '</div>' +
            '</div>';
          if (busy) {
            U.$('#rd-status', host).innerHTML =
              T('<div class="notice"><span class="spinner"></span> 正在抓取原文并提取正文…</div>');
          } else if (full && full.ok === false && full.reason) {
            U.$('#rd-status', host).innerHTML =
              '<div class="notice err">' + U.esc(full.reason) + '</div>';
          }
          // 中英对照是「按需」的：只有开着才翻，翻过的段落走缓存，重绘时几乎立刻回来
          if (biOn) startBi();
        });
    }

    /** 逐段填中文译文（先填上面的段落，边翻边出） */
    function startBi() {
      var bodyEl = U.$('.rd-body', host);
      if (!bodyEl || !global.Tr) return;
      var statusEl = U.$('#rd-status', host);
      Tr.bilingual(bodyEl, {
        onProgress: function (p) {
          if (!statusEl) return;
          if (!p.total) return;
          if (p.finished < p.total) {
            statusEl.innerHTML = '<div class="notice"><span class="spinner"></span> '
              + I18N.L('biProgress') + ' ' + p.finished + '/' + p.total + '</div>';
          } else if (p.failed) {
            statusEl.innerHTML = '<div class="notice err">'
              + U.esc(p.quota ? I18N.L('biQuota') : I18N.L('biDoneFail')) + '</div>';
          } else {
            statusEl.innerHTML = '';
          }
        }
      });
    }

    function loadFull() {
      if (busy || !article.link) return;
      if (!canOpen(article.link)) {
        U.toast(T('这个链接不支持阅读模式，可用「原文」在浏览器打开'));
        return;
      }
      busy = true; paint();
      fetchArticle(article.link).then(function (out) {
        var ex = out.ex;
        busy = false;
        if (!ex.ok && !ex.blocks.length) {
          full = { blocks: [], ok: false, reason: ex.reason };
          paint();
          return null;
        }
        full = ex;
        return putFulltext(article.id, {
          blocks: ex.blocks, title: ex.title, site: ex.site,
          byline: ex.byline, text: ex.text, ok: ex.ok, reason: ex.reason
        }).then(function () {
          paint();
          U.toast(T('已提取正文：约 ') + ex.words + T(' 词') +
            (out.via === 'webview' ? T('（直连没抓到，已用浏览器引擎）') : ''));
        });
      }).catch(function (e) {
        busy = false; paint();
        U.toast(T('抓取失败：') + String((e && e.message) || e));
      });
    }

    function speakAll() {
      var el = U.$('.rd-body', host);
      if (!el) return;
      // 朗读只读英文原文：把对照的中文行摘掉再取文字
      var clone = el.cloneNode(true);
      var zh = clone.querySelectorAll('.rd-zh');
      for (var i = 0; i < zh.length; i++) {
        if (zh[i].parentNode) zh[i].parentNode.removeChild(zh[i]);
      }
      var text = (clone.textContent || '').replace(/\s+/g, ' ').slice(0, 1200);
      if (!text) { U.toast(T('没有可朗读的文字')); return; }
      Bridge.speak(text, 1.0);
    }

    function addAll() {
      Promise.all([Store.cardMap(), article.link ? getFulltext(article.id) : null])
        .then(function (r) {
          var blocks = article.builtin
            ? (article.body || []).map(function (p) { return { text: p }; })
            : (r[1] && r[1].blocks || blocksFromSummary(article.desc));
          var list = newWordsOf(blocks, r[0]);
          if (!list.length) { U.toast(T('没有需要入库的生词')); return; }
          U.confirmBox(T('加入生词本'), T('将 ') + list.length + T(' 个生词加入生词本？'), T('加入'))
            .then(function (ok) {
              if (!ok) return;
              Promise.all(list.map(function (w) {
                return UIKit.addWord(w, { source: 'article' });
              })).then(function () {
                Store.cardMap(true);
                U.toast(T('已加入 ') + list.length + T(' 个生词'));
                App.updateDueDot();
                paint();
              });
            });
        });
    }

    App.push(function (el) {
      host = el;
      el.className = 'screen';
      paint();

      el.addEventListener('click', function (e) {
        // 点词查义
        var w = e.target.closest('.wd');
        if (w) {
          UIKit.wordSheet(w.getAttribute('data-w'), { speak: Store.settings.autoSpeak });
          return;
        }
        // 对照译文没翻出来的那段：点一下重试
        var zh = e.target.closest('.rd-zh');
        if (zh) {
          if (String(zh.className).indexOf('err') >= 0 && global.Tr) Tr.retry(zh);
          return;
        }
        var b = e.target.closest('[data-a]');
        if (!b) return;
        var a = b.getAttribute('data-a');
        if (a === 'plus') { state.fontSize = Math.min(26, state.fontSize + 1); savePrefs(); paint(); }
        else if (a === 'minus') { state.fontSize = Math.max(13, state.fontSize - 1); savePrefs(); paint(); }
        else if (a === 'hl') { state.hl = !state.hl; savePrefs(); paint(); }
        else if (a === 'bi') {
          biOn = !biOn;
          var bodyEl = U.$('.rd-body', host);
          if (!biOn && bodyEl && global.Tr) Tr.clear(bodyEl);
          paint();   // 打开时 paint 里会调用 startBi()，翻过的段落直接命中缓存
        }
        else if (a === 'speak') speakAll();
        else if (a === 'full') loadFull();
        else if (a === 'addall') addAll();
        else if (a === 'ext') { Bridge.openExternal(article.link); }
        else if (a === 'star') {
          Feed.toggleStar(article.id).then(function (on) {
            U.toast(on ? T('已收藏') : T('已取消收藏'));
            paint();
            if (onClose) onClose();
          });
        }
      });

      // 进入时：RSS 条目且没抓过 → 不自动抓（省流量），但标记已读
      if (!article.builtin) Feed.markRead(article.id);
      if (article.link && !article.builtin) {
        getFulltext(article.id).then(function (c) {
          if (c && c.blocks && c.blocks.length) { full = c; paint(); }
        });
      }
    }, { title: article.source || T('阅读'), sub: article.builtin ? T('内置短文') : T('订阅文章') });
  }

  global.Reader = {
    extract: extract,
    fetchArticle: fetchArticle,
    canOpen: canOpen,
    open: open,
    blocksFromSummary: blocksFromSummary,
    getFulltext: getFulltext,
    putFulltext: putFulltext,
    clearFulltext: clearFulltext,
    blocksHtml: blocksHtml,
    newWordsOf: newWordsOf
  };
})(window);
