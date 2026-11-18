/* ============================================================================
 * 阅读 —— 界面层
 *
 * 三个标签：
 *   推荐   内置分级短文 + 订阅文章，按「词书匹配 + 生词比例」打分混排
 *   订阅   feed-flow 式时间线：全部 / 未读 / 收藏，可按源筛选，带订阅源管理
 *   收藏   已收藏的文章
 *
 * 领域逻辑在 feed.js，正文提取与阅读器在 reader.js。
 * ========================================================================== */
(function (global) {
  'use strict';

  /**
   * 渲染入口的统一兜底。
   *
   * 以前三个页面（推荐 / 订阅 / 收藏）的 Promise 链都没有 catch：只要中间
   * 任何一步抛错，`.then` 里画界面的代码就整个不执行，屏幕上什么都不剩——
   * 用户看到的就是「一片空白」。这里把失败变成看得见的一块提示。
   */
  function failPage(label, el, e) {
    if (global.App && App.recordError) App.recordError(label, e);
    if (!el) return;
    el.innerHTML = '';
    el.appendChild(U.dom('<div class="empty"><div class="big">⚠️</div>' +
      T('<h3>页面加载失败</h3><p>可以下拉重试；原因见「设置 → 诊断信息」。</p></div>')));
  }

  /**
   * 推荐打分。
   *
   * 只用「词书匹配度」排序有个致命问题：它只跟词书有关、跟学习进度无关，
   * 于是推荐结果永远不变。所以必须把「学习收益」也放进来。
   *
   * 但「收益」不能按生词的**绝对数量**比：长文章天生生词就多，
   * 拿一篇 300 词的短文和一条 20 词的新闻摘要比，短文永远输。
   * 因此两处都做归一化：
   *
   *   1. 目标值随长度缩放     期望待记词约占正文 10%，并限制在 5~40 之间
   *   2. 偏离度按目标值归一化 用相对偏离而不是绝对差值
   *
   * 于是「20 词、0 生词」的空摘要会被清楚地压到下面，而「一篇文章里
   * 恰好有十来二十个新词」会排到前面。待记词数随生词本积累自然下降，
   * 推荐因此会自己往前走——这一条有测试实测验证。
   */
  var IDEAL_RATIO = 0.10;
  var IDEAL_MIN = 5;
  var IDEAL_MAX = 40;

  function idealFresh(st) {
    var n = st.len || 0;
    if (!n) return IDEAL_MIN;
    return Math.max(IDEAL_MIN, Math.min(IDEAL_MAX, Math.round(n * IDEAL_RATIO)));
  }

  /**
   * 收尾两项修正。
   *
   * 「样本太短」的折扣：订阅源往往只给一两句摘要，十几词的样本里正好有 5 个生词
   * 纯属运气，不能因此排到一篇百来词短文前面。样本越短扣得越多，60 词以上不再扣。
   *
   * 「生词偏多」用非对称罚分：对学英语的人来说，
   *   · 生词**不够** = 白读一场，是主要失败模式 → 全额罚
   *   · 生词**偏多** = 读起来吃力，但仍有收获 → 半额罚，且封顶
   * 否则一篇新词很多的文章会被罚得比「一个生词都没有」还狠，显然是反的。
   */
  var THIN_WORDS = 60;
  var THIN_PENALTY = 20;
  var OVER_WEIGHT = 0.5;

  function recScore(st) {
    var target = idealFresh(st);
    var base = Math.max(IDEAL_MIN, target);
    var under = Math.max(0, target - st.fresh) / base;
    var over = Math.min(1, Math.max(0, st.fresh - target) / base) * OVER_WEIGHT;
    var tooHard = Math.max(0, 0.80 - st.fit);
    var thin = st.len < THIN_WORDS ? (THIN_WORDS - st.len) / THIN_WORDS * THIN_PENALTY : 0;
    return -((under + over) * 60 + tooHard * 30 + thin);
  }

  /* ============================== 页面状态 ============================== */

  var state = {
    tab: 'rec',          // rec | feed | star
    filter: 'all',       // all | unread | star（订阅页）
    kind: 'all',         // all | short | feed（推荐页：全部 / 分级短文 / 订阅文章）
    refreshing: false
  };

  var builtin = null;

  /** 少于这么多词的条目无法可靠评估难度，不进入「为你推荐」 */
  var MIN_REC_WORDS = 20;

  /* ============================ 内置分级短文 ============================ */

  function loadBuiltin() {
    if (builtin) return Promise.resolve(builtin);
    return fetch('data/articles.json').then(function (r) { return r.json(); })
      .then(function (d) { builtin = d.articles || []; return builtin; })
      .catch(function () { builtin = []; return builtin; });
  }

  /**
   * 统计一篇文章（或一段文本）的难度。
   *   len   正文词数（用于把「待记词数」按长度归一化）
   *   fit   词书匹配度 = 正文里属于当前词书的词占比（与个人进度无关）
   *   fresh 待记词数 = 词书内、且尚未进生词本的词数（学习收益）
   */
  function stats(article, cmap) {
    var seen = {}, total = 0, inBookN = 0, knownN = 0, fresh = 0, tokens = 0;
    var bookId = Store.settings.bookId;
    (article.body || []).forEach(function (p) {
      U.extractWords(p, { minLen: 3, skipStop: true }).forEach(function (w) {
        tokens++;
        if (seen[w]) return;
        seen[w] = 1;
        var e = Dict.lemma(w);
        if (!e) return;
        total++;
        if (!Dict.inBook(e, bookId)) return;
        inBookN++;
        if (cmap[e.word]) knownN++;
        else fresh++;
      });
    });
    return {
      total: total, inBookN: inBookN, knownN: knownN, fresh: fresh, len: tokens,
      fit: total ? inBookN / total : 0,
      progress: inBookN ? knownN / inBookN : 0
    };
  }

  /* ============================== 通用片段 ============================== */

  function segmented(items, active, attr) {
    return '<div class="segmented" ' + (attr || 'data-seg') + '>' +
      items.map(function (it) {
        return '<button' + (it.key ? ' data-tab="' + it.key + '"' : '') +
          ' class="' + (it.key === active ? 'on' : '') + '">' + U.esc(it.label) + '</button>';
      }).join('') + '</div>';
  }

  function agoText(it) {
    if (!it || !it.ts) return it && it.date ? String(it.date).slice(0, 16) : '';
    var d = Date.now() - it.ts;
    if (d < 0) return '';
    if (d < 3600000) return Math.max(1, Math.round(d / 60000)) + T(' 分钟前');
    if (d < 86400000) return Math.round(d / 3600000) + T(' 小时前');
    if (d < 86400000 * 7) return Math.round(d / 86400000) + T(' 天前');
    var dt = new Date(it.ts);
    return (dt.getMonth() + 1) + T('月') + dt.getDate() + T('日');
  }

  /** 订阅条目 → 时间线一行 */
  function itemRow(it, showSource) {
    return '<div class="list-item ti' + (it.read ? ' read' : '') + '" data-item="' + U.attr(it.id) + '">' +
      '<div class="ti-dot' + (it.read ? ' off' : '') + '"></div>' +
      '<div class="li-main">' +
        '<div class="li-title">' + U.esc(it.title || T('(无标题)')) + '</div>' +
        '<div class="li-sub">' +
          (showSource !== false ? '<span class="ti-src">' + U.esc(it.feedName) + '</span> · ' : '') +
          agoText(it) + '</div>' +
      '</div>' +
      '<button class="ti-star' + (it.star ? ' on' : '') + '" data-star="' + U.attr(it.id) + '">' +
        (it.star ? '★' : '☆') + '</button>' +
    '</div>';
  }

  /* ============================== 推荐页 ============================== */

  function renderRec(el) {
    Promise.all([loadBuiltin(), Store.cardMap(), Feed.loadCache()])
      .then(function (r) {
        var arts = r[0], cmap = r[1];
        var recs = [];

        arts.forEach(function (a) {
          var st = stats(a, cmap);
          recs.push({
            kind: 'builtin', id: a.id, level: a.level, title: a.title,
            desc: a.summary || (a.body || []).join(' ').slice(0, 140),
            ts: 0, st: st, score: recScore(st)
          });
        });

        Feed.allItems().forEach(function (it) {
          var st = stats({ body: [it.title + ' ' + (it.desc || '')] }, cmap);
          // 摘要太短的条目无法评估难度（有的源只给个标题），
          // 让它参与推荐等于靠运气排序，所以直接不入选；在「订阅」里仍然能看到。
          if (st.len < MIN_REC_WORDS) return;
          recs.push({
            kind: 'feed', id: it.id, level: it.level, title: it.title,
            desc: it.desc, ts: it.ts, feedName: it.feedName, link: it.link,
            date: it.date, read: it.read, star: it.star, st: st, score: recScore(st)
          });
        });

        recs.sort(function (a, b) {
          if (b.score !== a.score) return b.score - a.score;
          return (b.ts || 0) - (a.ts || 0);
        });

        if (state.kind === 'short') recs = recs.filter(function (x) { return x.kind === 'builtin'; });
        else if (state.kind === 'feed') recs = recs.filter(function (x) { return x.kind === 'feed'; });

        var fst = Feed.stats();
        el.innerHTML = '';
        el.appendChild(U.dom(
          '<div class="card tight">' +
            T('<div class="bold small">为你推荐</div>') +
            T('<div class="xsmall muted mt8">优先选<b>词书匹配度高</b>、且生词比例适中的文章') +
              T('（期望待记词约占正文 10%，下限 5 词、上限 40 词）。') +
              T('随着生词本积累，推荐会自己往前走；摘要过短的条目无法评估难度，不参与推荐。</div>') +
            T('<div class="xsmall muted mt8">上方可按类型筛选；订阅：') +
              Feed.enabled().length + '/' + Feed.list().length +
              T(' 个源 · ') + fst.count + T(' 条 · ') +
              (fst.fetchedAt ? agoText({ ts: fst.fetchedAt }) + T('更新') : T('尚未更新')) + '</div>' +
          '</div>'));

        var list = U.dom('<div></div>');
        recs.slice(0, 12).forEach(function (x) {
          var isBuiltin = x.kind === 'builtin';
          var fit = Math.round(x.st.fit * 100);
          list.appendChild(U.dom(
            '<div class="card feed-card" data-rec="' + U.attr(x.kind + ':' + x.id) + '">' +
              '<div class="fc-head">' +
                '<span class="tag' + (isBuiltin ? ' tag-lv' : '') + '">' +
                  (isBuiltin ? 'L' + x.level + T(' 短文') : U.esc(x.feedName)) + '</span>' +
                '<span class="muted xsmall">' + (isBuiltin ? '' : agoText(x)) +
                  (x.read ? T(' · 已读') : '') + '</span>' +
              '</div>' +
              '<div class="fc-title">' + U.esc(x.title) + '</div>' +
              (x.desc ? '<div class="fc-desc">' + U.esc(String(x.desc).slice(0, 130)) + '</div>' : '') +
              '<div class="row mt8" style="gap:6px;flex-wrap:wrap">' +
                (x.st.fresh ? T('<span class="chip soft">待记 ') + x.st.fresh + T(' 词</span>')
                            : T('<span class="chip ok">词书内已掌握</span>')) +
                T('<span class="chip">词书匹配 ') + fit + '%</span>' +
                '<span class="chip">' + x.st.len + T(' 词</span>') +
              '</div>' +
            '</div>'));
        });

        if (!recs.length) {
          list.appendChild(U.dom('<div class="empty"><div class="big">📚</div>' +
            T('<h3>还没有可读内容</h3><p>内置短文加载失败，订阅也还没有内容。</p></div>')));
        }

        el.appendChild(U.dom(
          T('<div class="section-title">按你的词书排序</div>') +
          '<div class="row mb8" style="gap:6px">' +
            '<button class="btn sm ' + (state.kind === 'all' ? 'line' : 'ghost') +
              T('" data-kind="all">全部</button>') +
            '<button class="btn sm ' + (state.kind === 'short' ? 'line' : 'ghost') +
              T('" data-kind="short">分级短文</button>') +
            '<button class="btn sm ' + (state.kind === 'feed' ? 'line' : 'ghost') +
              T('" data-kind="feed">订阅文章</button>') +
          '</div>'));
        el.appendChild(list);

        el.addEventListener('click', function (e) {
          var kb = e.target.closest('[data-kind]');
          if (kb) { state.kind = kb.getAttribute('data-kind'); App.rerender(); return; }
          var c = e.target.closest('[data-rec]');
          if (!c) return;
          var v = String(c.getAttribute('data-rec')).split(':');
          var kind = v[0], id = v.slice(1).join(':');

          if (kind === 'builtin') {
            var a = null;
            arts.forEach(function (x) { if (x.id === id) a = x; });
            if (!a) return;
            Reader.open({
              builtin: true, id: 'b-' + a.id, title: a.title, body: a.body,
              source: T('分级短文'), dateText: 'L' + a.level, level: a.level
            });
          } else {
            var found = null;
            Feed.allItems().forEach(function (it) { if (it.id === id) found = it; });
            if (!found) return;
            Reader.open({
              id: found.id, title: found.title, link: found.link, desc: found.desc,
              source: found.feedName, dateText: agoText(found), level: found.level
            }, function () { Feed.loadCache().then(function () { App.rerender(); }); });
          }
        });
      })
      .catch(function (e) { failPage('推荐页', el, e); });
  }

  /* ============================== 订阅页 ============================== */

  function renderFeed(el) {
    Feed.loadCache().then(function () {
      var all = Feed.allItems();
      var filter = state.filter;

      var list = all.filter(function (it) {
        if (filter === 'unread') return !it.read;
        if (filter === 'star') return it.star;
        return true;
      });

      var st = Feed.stats();

      el.innerHTML = '';
      el.appendChild(U.dom(
        '<div class="card tight">' +
          '<div class="row between">' +
            T('<div class="grow"><div class="bold small">每日外刊</div>') +
            '<div class="xsmall muted mt8">' + all.length + T(' 条') +
              (all.length && st.unread ? '，' + st.unread + T(' 条未读') : '') +
              ' · ' + (st.busy
                ? T('正在更新…')
                : (st.fetchedAt ? agoText({ ts: st.fetchedAt }) + T('更新') : T('尚未更新'))) +
            '</div></div>' +
            (st.busy
              ? '<div class="xsmall muted" style="text-align:right;min-width:64px">' +
                  T('<span class="spinner"></span><br>更新中 ') +
                  st.progress.done + '/' + st.progress.total + '</div>'
              : T('<button class="btn sm" data-a="refresh">更新</button>')) +
          '</div>' +
          '<div class="row mt12" style="gap:8px">' +
            T('<button class="btn sm grow line" data-a="sources">订阅源 ') +
              Feed.enabled().length + '/' + Feed.list().length + '</button>' +
            T('<button class="btn sm grow ghost" data-a="catalog">精选源</button>') +
            T('<button class="btn sm grow ghost" data-a="add">＋粘贴网址</button>') +
          '</div>' +
        '</div>'));

      el.appendChild(U.dom(segmented([
        { key: 'all', label: T('全部') },
        { key: 'unread', label: T('未读 ') + st.unread },
        { key: 'star', label: T('收藏') }
      ], filter, 'data-filter')));

      var body = U.dom('<div class="mt12"></div>');
      var noEnabled = Feed.list().length > 0 && !Feed.enabled().length;
      var lr = st.lastResult;
      var allFailed = !!(lr && lr.total > 0 && lr.ok === 0);
      if (noEnabled) {
        body.appendChild(U.dom(T('<div class="notice err">所有订阅源都已关闭。') +
          T('点上面「订阅源」至少打开一个，才能获取内容。</div>')));
      }
      // 注意：列表必须写进子容器。以前这里直接 body.innerHTML = …，
      // 会在缓存里仍有旧条目时把上面的提示整块覆盖掉，导致「全部关闭」永远看不到提示。
      var listBox = U.dom('<div></div>');
      if (list.length) {
        listBox.innerHTML = list.map(function (it) { return itemRow(it, true); }).join('');
      } else if (!noEnabled) {
        if (!Feed.list().length) {
          listBox.appendChild(U.dom('<div class="empty"><div class="big">📡</div>' +
            T('<h3>还没有订阅源</h3><p>点「精选源」挑几个，或在右上角「＋订阅」粘贴一个网址。</p></div>')));
          // 目录（data/feeds.json）读不出来时，「精选源」也是空的——把真实原因说出来，
          // 否则用户只会看到「一个源都没有」，以为应用坏了。
          if (st.catalogError) {
            listBox.appendChild(U.dom('<div class="notice err">' + U.esc(st.catalogError) + '</div>'));
          }
        } else if (allFailed) {
          // 更新过了，但一个源都没成功——这是最让人困惑的情况，
          // 必须把「为什么是空的」直接摆在最上面，而不是含糊地说「还没有内容」。
          listBox.appendChild(U.dom('<div class="notice err">' +
            T('更新完成，但 ') + lr.total + T(' 个源都没有取到内容。下面是每个源的具体原因。</div>')));
          var failBox = U.dom('<div class="card tight"></div>');
          failBox.innerHTML = (lr.reasons || []).map(function (x) {
            return '<div class="list-item"><div class="li-main">' +
              '<div class="li-title">' + U.esc(x.name) + '</div>' +
              '<div class="li-sub" style="color:#a33248">' + U.esc(x.err) + '</div>' +
              (x.raw ? '<div class="xsmall muted" style="word-break:break-all">' +
                U.esc(x.raw) + '</div>' : '') +
              '</div></div>';
          }).join('');
          listBox.appendChild(failBox);
          listBox.appendChild(U.dom('<div class="muted xsmall center mt12">' +
            T('常见原因：这几个源在境内连不上（试试点「精选源」换成国内可直连的），') +
            T('或者当时手机网络不通。可以稍后点「更新」重试，也可以到「订阅源」里逐个「测试连接」。</div>')));
        } else if (!all.length) {
          listBox.appendChild(U.dom('<div class="empty"><div class="big">📡</div>' +
            T('<h3>还没有内容</h3><p>点「更新」联网抓取一次，之后每天首次打开会自动刷新。</p></div>')));
        } else {
          listBox.appendChild(U.dom('<div class="empty"><div class="big">✅</div>' +
            T('<h3>这里空了</h3><p>当前筛选条件下没有文章。</p></div>')));
        }
      }
      body.appendChild(listBox);
      el.appendChild(body);

      el.addEventListener('click', function (e) {
        var seg = e.target.closest('[data-filter] [data-tab]');
        if (seg) { state.filter = seg.getAttribute('data-tab'); App.rerender(); return; }

        var b = e.target.closest('[data-a]');
        if (b) {
          var a = b.getAttribute('data-a');
          if (a === 'refresh') { doRefresh(); return; }
          if (a === 'sources') { openSourceManager(function () { App.rerender(); }); return; }
          if (a === 'catalog') { openCatalog(function () { App.rerender(); }); return; }
          if (a === 'add') { openAddFeed(function () { App.rerender(); }); return; }
        }

        var star = e.target.closest('[data-star]');
        if (star) {
          e.stopPropagation();
          Feed.toggleStar(star.getAttribute('data-star')).then(function () { App.rerender(); });
          return;
        }

        var it = e.target.closest('[data-item]');
        if (!it) return;
        var id = it.getAttribute('data-item');
        var found = null;
        all.forEach(function (x) { if (x.id === id) found = x; });
        if (!found) return;
        Reader.open({
          id: found.id, title: found.title, link: found.link, desc: found.desc,
          source: found.feedName, dateText: agoText(found), level: found.level
        }, function () { Feed.loadCache().then(function () { App.rerender(); }); });
      });
    }).catch(function (e) { failPage('订阅页', el, e); });
  }

  /* ============================== 收藏页 ============================== */

  function renderStar(el) {
    Feed.loadCache().then(function () {
      var list = Feed.allItems().filter(function (it) { return it.star; });
      el.innerHTML = '';
      var box = U.dom('<div></div>');
      if (!list.length) {
        box.appendChild(U.dom('<div class="empty"><div class="big">☆</div>' +
          T('<h3>还没有收藏</h3><p>在文章列表或阅读器里点 ☆，就会出现在这里。</p></div>')));
      } else {
        box.innerHTML = list.map(function (it) { return itemRow(it, true); }).join('');
      }
      el.appendChild(box);

      el.addEventListener('click', function (e) {
        var star = e.target.closest('[data-star]');
        if (star) {
          e.stopPropagation();
          Feed.toggleStar(star.getAttribute('data-star')).then(function () { App.rerender(); });
          return;
        }
        var it = e.target.closest('[data-item]');
        if (!it) return;
        var id = it.getAttribute('data-item');
        list.forEach(function (x) {
          if (x.id !== id) return;
          Reader.open({
            id: x.id, title: x.title, link: x.link, desc: x.desc,
            source: x.feedName, dateText: agoText(x), level: x.level
          }, function () { Feed.loadCache().then(function () { App.rerender(); }); });
        });
      });
    }).catch(function (e) { failPage('收藏页', el, e); });
  }

  /* ============================== 刷新 ============================== */

  function doRefresh() {
    if (state.refreshing) { U.toast(T('正在更新…')); return; }
    var n = Feed.enabled().length;
    if (!n) { U.toast(T('请先启用至少一个订阅源')); return; }
    state.refreshing = true;
    U.toast(T('正在更新 ') + n + T(' 个源…'));
    App.rerender();
    Feed.refreshAll().then(function (ok) {
      state.refreshing = false;
      var st = Feed.stats();
      var lr = st.lastResult;
      if (ok === false) { App.rerender(); return; }
      if (lr && lr.ok === 0) {
        U.toast(T('更新完成，但 ') + lr.total + T(' 个源都没取到内容'));
      } else if (lr) {
        U.toast(T('已更新：') + lr.ok + '/' + lr.total + T(' 个源成功，共 ') + st.count + T(' 条'));
      } else {
        U.toast(T('已更新，共 ') + st.count + T(' 条'));
      }
      App.rerender();
    }).catch(function (e) {
      state.refreshing = false;
      U.toast(T('更新失败：') + String((e && e.message) || e));
      App.rerender();
    });
  }

  /* ======================== 添加订阅源（自动发现） ======================== */

  function openAddFeed(done) {
    var box = U.dom(
      '<div>' +
        T('<div class="muted small mb8">粘贴网站首页、文章页或 RSS 地址，') +
        T('会自动帮你找出真正的订阅地址</div>') +
        '<input type="text" id="af-url" placeholder="https://example.com" ' +
          'autocapitalize="off" autocorrect="off" spellcheck="false">' +
        '<div id="af-out" class="mt12"></div>' +
      '</div>');

    var h = U.openSheet({
      title: T('添加订阅源'),
      body: box,
      footer: '<div class="sheet-foot">' +
        T('<button class="btn line" data-af="test">识别</button>') +
        T('<button class="btn" data-af="save">直接保存</button></div>')
    });

    function url() { return U.$('#af-url', box).value.trim(); }
    var found = null;

    function probe() {
      var u = url();
      if (!u) { U.toast(T('先填一个网址')); return; }
      var out = U.$('#af-out', box);
      out.innerHTML = T('<div class="notice"><span class="spinner"></span> 正在识别…</div>');
      Feed.discover(u).then(function (r) {
        if (r.error) {
          out.innerHTML = '<div class="notice err">' + U.esc(r.error) +
            (r.detail ? '<div class="xsmall muted mt8">' + U.esc(r.detail) + '</div>' : '') +
            T('<div class="xsmall muted mt8">如果这个网址本身就是 RSS 地址，') +
            T('可以用下方「直接保存」。</div></div>');
          return;
        }
        found = r;
        var sample = r.pf.items.slice(0, 3).map(function (x) {
          return '<div class="xsmall muted ellipsis">· ' + U.esc(String(x.title || '').slice(0, 60)) + '</div>';
        }).join('');
        out.innerHTML =
          '<div class="notice" style="background:#e8f4ed;border-color:#b9dcc6;color:#2f6f4e">' +
            T('找到订阅地址：<b style="word-break:break-all">') + U.esc(r.url) + '</b><br>' +
            T('格式 ') + U.esc(r.pf.format.toUpperCase()) +
            '（' + (r.via === 'webview' ? T('浏览器引擎') : T('直连')) +
            (r.pf.strict ? T('，标准解析') : T('，已容错降级')) + T('），共 <b>') + r.pf.items.length + T('</b> 条') +
            sample +
          '</div>';
      }).catch(function (e) {
        out.innerHTML = T('<div class="notice err">识别失败：') + U.esc(String((e && e.message) || e)) + '</div>';
      });
    }

    h.el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-af]');
      if (!b) return;
      if (b.getAttribute('data-af') === 'test') { probe(); return; }

      var u = (found && found.url) || url();
      if (!u) { U.toast(T('请填写地址')); return; }
      if (!/^https?:\/\//i.test(u)) { U.toast(T('地址需要以 http(s):// 开头')); return; }
      if (Feed.list().some(function (f) { return f.url === u; })) {
        U.toast(T('这个源已经在列表里了'));
        return;
      }
      var guess = u.replace(/^https?:\/\//, '').split('/')[0];
      U.promptBox(T('给这个源起个名字'), guess, T('例如：某英文媒体')).then(function (n) {
        if (n === null) return;
        Feed.add({ name: n || guess, url: u, on: true });
        h.close();
        U.toast(T('已添加，正在抓取…'));
        Feed.refreshAll().then(function () {
          if (done) done();
          App.rerender();
        });
      });
    });

    U.$('#af-url', box).addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); probe(); }
    });
  }

  /* ============================== 精选源目录 ============================== */

  function openCatalog(done) {
    Feed.catalog().then(function (cat) {
      var body = U.dom('<div></div>');
      var mine = {};
      Feed.list().forEach(function (f) { mine[f.id] = f; });
      var added = 0;

      function paint() {
        body.innerHTML =
          T('<div class="muted small mb8">标「需海外网络」的源在境内连接会直接失败，默认关闭；') +
          T('其余都在<b>国内网络实测可用</b>。</div>') +
          (cat.categories || []).map(function (c) {
            return '<div class="section-title">' + U.esc(c.name) + '</div>' +
              (c.desc ? '<div class="muted xsmall mb8">' + U.esc(c.desc) + '</div>' : '') +
              '<div class="card tight">' + (c.feeds || []).map(function (f) {
                var has = !!mine[f.id];
                var on = has && mine[f.id].on !== false;
                var label = on ? T('已订阅') : (has ? T('启用') : T('订阅'));
                return '<div class="list-item">' +
                  '<div class="li-main">' +
                    '<div class="li-title">' + U.esc(f.name) +
                      (f.cn ? '' : T(' <span class="tag">需海外网络</span>')) + '</div>' +
                    '<div class="li-sub">' + U.esc(f.desc || f.url) +
                      (has && !on ? T(' · 已在列表中，当前为关闭') : '') + '</div>' +
                  '</div>' +
                  '<button class="btn sm ' + (on ? 'ghost' : '') + '" data-add="' + U.attr(f.id) + '" ' +
                    (on ? 'disabled' : '') + '>' + label + '</button>' +
                '</div>';
              }).join('') + '</div>';
          }).join('');
      }
      paint();

      var h = U.openSheet({ title: T('精选订阅源'), body: body });

      body.addEventListener('click', function (e) {
        var b = e.target.closest('[data-add]');
        if (!b) return;
        var id = b.getAttribute('data-add');
        var f = null;
        (cat.categories || []).forEach(function (c) {
          (c.feeds || []).forEach(function (x) { if (x.id === id) f = x; });
        });
        if (!f) return;
        if (mine[f.id]) {
          // 已经在列表里但被关掉了 -> 直接启用
          Feed.setOn(f.id, true);
          mine[f.id].on = true;
          added++;
          paint();
          U.toast(T('已启用「') + f.name + '」');
          return;
        }
        Feed.add({
          id: f.id, name: f.name, url: f.url, cat: f.cat, catName: c_name(f, cat),
          level: f.level, cn: f.cn, on: true, fromCatalog: true
        });
        mine[f.id] = { on: true };
        added++;
        paint();
        U.toast(T('已订阅「') + f.name + '」');
      });

      function c_name(f, cat) {
        var n = '';
        (cat.categories || []).forEach(function (c) {
          (c.feeds || []).forEach(function (x) { if (x.id === f.id) n = c.name; });
        });
        return n;
      }

      var origClose = h.close;
      h.close = function () {
        origClose();
        if (!added) return;
        U.toast(T('正在抓取新增的 ') + added + T(' 个源…'));
        Feed.refreshAll().then(function () {
          if (done) done();
          App.rerender();
        });
      };
    });
  }

  /* ============================ 订阅源管理 ============================ */

  var testResults = {};

  function statusHtml(f, tr) {
    var isOn = f.on !== false;
    var st = Feed.sourceState(f.id);
    if (tr && tr.busy) return T('<div class="small mt8 muted"><span class="spinner"></span> 正在测试…</div>');
    if (isOn && tr) {
      return '<div class="small mt8" style="color:' + (tr.ok ? '#4c956c' : '#a33248') + '">' +
        U.esc(tr.msg) +
        (tr.raw ? '<div class="xsmall muted" style="word-break:break-all">' + U.esc(tr.raw) + '</div>' : '') +
        '</div>';
    }
    if (!isOn) return T('<div class="small mt8 muted">已关闭，不会请求该源</div>');
    if (st && st.note) return '<div class="small mt8" style="color:#c9803a">' + U.esc(st.note) + '</div>';
    if (st && st.error) {
      return '<div class="small mt8" style="color:#a33248">' + U.esc(st.error) +
        (st.raw ? '<div class="xsmall muted" style="word-break:break-all">' + U.esc(st.raw) + '</div>' : '') +
        '</div>';
    }
    if (st && st.items) {
      return '<div class="small mt8 muted">' + st.items.length + T(' 条 · ') + agoText({ ts: st.at }) + '</div>';
    }
    return T('<div class="small mt8 muted">暂无缓存，点「测试连接」看具体原因</div>');
  }

  function sourceManagerHtml() {
    var list = Feed.list();
    var total = Feed.stats();
    return '<div class="muted small mb8">' + Feed.enabled().length + ' / ' + list.length +
        T(' 个源启用 · 缓存 ') + total.count + T(' 条 · ') +
        (total.fetchedAt ? agoText({ ts: total.fetchedAt }) + T('更新') : T('尚未更新')) + '</div>' +
      list.map(function (f) {
        var isOn = f.on !== false;
        return '<div class="card tight"' + (isOn ? '' : ' style="opacity:.66"') + '>' +
          '<div class="row between">' +
            '<div class="grow" style="min-width:0">' +
              '<div class="bold ellipsis">' + U.esc(f.name) +
                (f.custom ? T(' <span class="tag">自定义</span>') : '') +
                (f.cn === false ? T(' <span class="tag">需海外网络</span>') : '') +
                (Feed.isInvalid(f.id) ? T(' <span class="tag bad">无效</span>') : '') + '</div>' +
              '<div class="muted xsmall mt8" style="word-break:break-all">' + U.esc(f.url) + '</div>' +
            '</div>' +
            '<button class="switch' + (isOn ? ' on' : '') + '" data-toggle="' + U.attr(f.id) +
              '"><i></i></button>' +
          '</div>' + statusHtml(f, testResults[f.id]) +
          '<div class="row mt8" style="gap:6px;flex-wrap:wrap">' +
            '<button class="btn sm line" data-test="' + U.attr(f.id) + T('">测试连接</button>') +
            '<button class="btn sm ghost" data-edit="' + U.attr(f.id) + T('">改地址</button>') +
            (f.custom
              ? '<button class="btn sm ghost" data-del="' + U.attr(f.id) + T('">删除</button>')
              : '<button class="btn sm ghost" data-reset="' + U.attr(f.id) + T('">恢复默认</button>')) +
          '</div>' +
        '</div>';
      }).join('') +
      T('<button class="btn block mt12" data-add="1">＋ 添加订阅源</button>') +
      '<div class="row mt8" style="gap:8px">' +
        T('<button class="btn grow ghost" data-retest="1">全部测试</button>') +
        '<button class="btn grow ghost" data-opml="1">OPML</button>' +
      '</div>' +
      T('<button class="btn block ghost mt8" data-blocked="1">屏蔽词（') +
        Feed.blockedWords().length + '）</button>';
  }

  function testOne(f, paint) {
    testResults[f.id] = { busy: true };
    paint();
    Feed.fetchFeed(f.url).then(function (out) {
      var r = out.res, pf = out.pf;
      if (pf.items.length) {
        testResults[f.id] = {
          ok: true,
          msg: T('解析到 ') + pf.items.length + T(' 条（') +
            (out.via === 'webview' ? T('浏览器引擎') : T('直连')) + T('，格式 ') +
            pf.format.toUpperCase() + (pf.strict ? T('，标准解析）') : T('，已容错降级）')) +
            (out.via === 'webview' ? T('：直连被站点拦截，已自动切换') : '')
        };
      } else {
        var why = [];
        if (r.error) why.push(Feed.humanError(r.error, r.status));
        if (r.status >= 400) why.push('HTTP ' + r.status);
        if (pf.error) why.push(pf.error);
        testResults[f.id] = {
          ok: false,
          msg: T('取不到条目：') + (why.join('；') || T('未知原因')),
          raw: T('识别格式=') + pf.format + T('，已尝试通道=') + out.tried.join(' → ')
        };
      }
      paint();
    }).catch(function (e) {
      testResults[f.id] = { ok: false, msg: Feed.humanError(e) };
      paint();
    });
  }

  function openSourceManager(done) {
    var body = U.dom('<div></div>');
    function paint() { body.innerHTML = sourceManagerHtml(); }
    paint();
    U.openSheet({ title: T('订阅源'), body: body });

    body.addEventListener('click', function (e) {
      var b = e.target.closest('[data-toggle],[data-test],[data-edit],[data-del],[data-reset],' +
        '[data-add],[data-retest],[data-opml],[data-blocked]');
      if (!b) return;
      var f = null;

      if (b.hasAttribute('data-toggle')) {
        f = Feed.byId(b.getAttribute('data-toggle'));
        if (f) { Feed.setOn(f.id, f.on === false); paint(); }
      } else if (b.hasAttribute('data-test')) {
        f = Feed.byId(b.getAttribute('data-test'));
        if (f) testOne(f, paint);
      } else if (b.hasAttribute('data-edit')) {
        f = Feed.byId(b.getAttribute('data-edit'));
        if (f) openSourceEdit(f, paint);
      } else if (b.hasAttribute('data-del')) {
        f = Feed.byId(b.getAttribute('data-del'));
        if (f) {
          U.confirmBox(T('删除订阅源'), T('将删除「') + f.name + T('」及其缓存。'), T('删除')).then(function (ok) {
            if (!ok) return;
            Feed.remove(f.id);
            paint();
            U.toast(T('已删除'));
          });
        }
      } else if (b.hasAttribute('data-reset')) {
        f = Feed.byId(b.getAttribute('data-reset'));
        if (f) {
          Feed.catalogFeeds().then(function (known) {
            known.forEach(function (k) {
              if (k.id !== f.id) return;
              f.name = k.name; f.url = k.url; f.cat = k.cat; f.level = k.level;
            });
            delete f.urlEdited;
            Store.saveSettings();
            paint();
            U.toast(T('已恢复默认地址'));
          });
        }
      } else if (b.hasAttribute('data-add')) {
        openAddFeed(function () { paint(); if (done) done(); });
      } else if (b.hasAttribute('data-retest')) {
        var on = Feed.enabled();
        if (!on.length) { U.toast(T('没有启用中的源')); return; }
        on.forEach(function (x, k) { setTimeout(function () { testOne(x, paint); }, k * 400); });
      } else if (b.hasAttribute('data-opml')) {
        openOpml(paint);
      } else if (b.hasAttribute('data-blocked')) {
        openBlocked(paint);
      }
    });
  }

  function openSourceEdit(f, done) {
    var box = U.dom(
      '<div>' +
        T('<div class="muted small mb8">名称</div>') +
        '<input type="text" id="sf-name" value="' + U.attr(f.name) + '">' +
        T('<div class="muted small mb8 mt12">RSS 地址</div>') +
        '<input type="text" id="sf-url" value="' + U.attr(f.url) + '" ' +
          'autocapitalize="off" autocorrect="off" spellcheck="false">' +
        '<div id="sf-out" class="mt12"></div>' +
      '</div>');
    var h = U.openSheet({
      title: T('编辑订阅源'),
      body: box,
      footer: '<div class="sheet-foot">' +
        T('<button class="btn line" data-sf="test">测试连接</button>') +
        T('<button class="btn" data-sf="save">保存</button></div>')
    });

    h.el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-sf]');
      if (!b) return;
      var u = U.$('#sf-url', box).value.trim();
      var n = U.$('#sf-name', box).value.trim();

      if (b.getAttribute('data-sf') === 'test') {
        if (!u) { U.toast(T('先填地址')); return; }
        var out = U.$('#sf-out', box);
        out.innerHTML = T('<div class="muted small"><span class="spinner"></span> 正在测试…</div>');
        Feed.fetchFeed(u).then(function (r) {
          var pf = r.pf;
          if (pf.items.length) {
            out.innerHTML = '<div class="notice" style="background:#e8f4ed;border-color:#b9dcc6;color:#2f6f4e">' +
              T('正常：') + (r.via === 'webview' ? T('经浏览器引擎') : T('直连')) + T('，格式 ') +
              U.esc(pf.format.toUpperCase()) +
              (pf.strict ? T('（标准解析）') : T('（已容错降级：') + U.esc(pf.error || '') + '）') +
              T('，共 <b>') + pf.items.length + T('</b> 条</div>');
          } else {
            var why = [];
            if (r.res && r.res.error) why.push(Feed.humanError(r.res.error, r.res.status));
            if (r.res && r.res.status >= 400) why.push('HTTP ' + r.res.status);
            if (pf.error) why.push(pf.error);
            out.innerHTML = T('<div class="notice err">失败：') + U.esc(why.join('；') || T('未知原因')) +
              T('<div class="xsmall muted mt8">识别格式=') + U.esc(pf.format) +
              T('，通道=') + U.esc(r.tried.join(' → ')) + '</div></div>';
          }
        });
        return;
      }

      if (!/^https?:\/\//i.test(u)) { U.toast(T('地址需要以 http(s):// 开头')); return; }
      if (n) f.name = n;
      if (f.url !== u) { f.url = u; f.urlEdited = true; }
      Store.saveSettings();
      h.close();
      U.toast(T('已保存'));
      if (done) done();
    });
  }

  /* ============================== OPML ============================== */

  function openOpml(done) {
    var body = U.dom(
      '<div>' +
        T('<div class="muted small mb8">导出：生成 OPML，可粘到别的阅读器，或留作备份。</div>') +
        '<div class="row" style="gap:8px">' +
          T('<button class="btn grow" data-o="copy">复制到剪贴板</button>') +
          T('<button class="btn grow ghost" data-o="save">存为文件</button>') +
        '</div>' +
        T('<div class="section-title">导入</div>') +
        T('<div class="muted small mb8">从别的阅读器导出 OPML 后，选文件或直接粘贴内容。') +
        T('已存在的地址会自动跳过。</div>') +
        T('<button class="btn block line" data-o="file">选择文件</button>') +
        T('<textarea id="op-text" rows="5" placeholder="或者把 OPML 内容粘贴到这里" ') +
          'style="margin-top:8px"></textarea>' +
        '<div id="op-out" class="mt12"></div>' +
      '</div>');
    var h = U.openSheet({
      title: T('OPML 导入 / 导出'),
      body: body,
      footer: '<div class="sheet-foot">' +
        T('<button class="btn" data-o="paste">导入粘贴的内容</button></div>')
    });

    function report(r) {
      U.$('#op-out', body).innerHTML = r.ok
        ? '<div class="notice" style="background:#e8f4ed;border-color:#b9dcc6;color:#2f6f4e">' +
          T('已导入 ') + r.added + T(' 个源（文件里共 ') + r.total + T(' 个，重复的已跳过）。') +
          T('关闭后会自动抓取。</div>')
        : '<div class="notice err">' + U.esc(r.error || T('导入失败')) + '</div>';
      if (r.ok) {
        if (done) done();
        h._opmlAdded = true;
      }
    }

    h.el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-o]');
      if (!b) return;
      var a = b.getAttribute('data-o');

      if (a === 'copy') { Bridge.copy(Feed.buildOpml()); U.toast(T('OPML 已复制到剪贴板')); }
      else if (a === 'save') {
        Bridge.saveFile('wordpalace-feeds.opml', Feed.buildOpml(), 'text/xml').then(function (r) {
          U.toast(r && r.ok ? T('已保存到「下载」目录') : (T('保存失败：') + ((r && r.error) || T('未知原因'))));
        });
      } else if (a === 'file') {
        Bridge.pickTextFile('text/xml').then(function (r) {
          if (!r) { U.toast(T('读取失败')); return; }
          if (!r.ok) {
            if (r.error === 'cancelled') return;
            U.$('#op-out', body).innerHTML =
              T('<div class="notice err">读取文件失败：') + U.esc(r.error || T('未知原因')) + '</div>';
            return;
          }
          Feed.importOpml(r.text, true).then(report);
        });
      } else if (a === 'paste') {
        var t = U.$('#op-text', body).value;
        if (!t.trim()) { U.toast(T('先粘贴 OPML 内容，或选择文件')); return; }
        Feed.importOpml(t, true).then(report);
      }
    });

    var origClose = h.close;
    h.close = function () {
      origClose();
      if (!h._opmlAdded) return;
      Feed.refreshAll().then(function () { if (done) done(); App.rerender(); });
    };
  }

  /* ============================== 屏蔽词 ============================== */

  function openBlocked(done) {
    var box = U.dom('<div></div>');
    function paint() {
      var words = Feed.blockedWords();
      box.innerHTML =
        T('<div class="muted small mb8">标题或摘要里包含这些词的条目会被隐藏（不区分大小写）。</div>') +
        (words.length
          ? '<div class="card tight">' + words.map(function (w) {
              return '<div class="list-item"><div class="li-main"><div class="li-title">' +
                U.esc(w) + '</div></div>' +
                '<button class="btn sm ghost" data-rm="' + U.attr(w) + T('">删除</button></div>');
            }).join('') + '</div>'
          : T('<div class="muted small">还没有屏蔽词。</div>')) +
        T('<button class="btn block mt12" data-new="1">＋ 添加屏蔽词</button>');
    }
    paint();
    U.openSheet({ title: T('屏蔽词'), body: box });

    box.addEventListener('click', function (e) {
      var rm = e.target.closest('[data-rm]');
      if (rm) {
        var w = rm.getAttribute('data-rm');
        Store.settings.blocked = Feed.blockedWords().filter(function (x) { return x !== w; });
        Store.saveSettings();
        paint();
        if (done) done();
        return;
      }
      if (e.target.closest('[data-new]')) {
        U.promptBox(T('添加屏蔽词'), '', T('例如：horoscope')).then(function (v) {
          if (!v) return;
          var l = Feed.blockedWords().slice();
          if (l.indexOf(v) < 0) l.push(v);
          Store.settings.blocked = l;
          Store.saveSettings();
          paint();
          if (done) done();
        });
      }
    });
  }

  /* ============================== 注册 ============================== */

  App.register('read', {
    title: '阅读',
    sub: '分级短文 · 每日外刊',
    actions: function () {
      return [
        { key: 'add', label: T('＋订阅'), onClick: function () { openAddFeed(function () { App.rerender(); }); } },
        { key: 'cat', label: T('精选'), onClick: function () { openCatalog(function () { App.rerender(); }); } }
      ];
    },
    onEnter: function () {
      if (Store.settings.autoFeed === false) return;
      Feed.ensureFeeds(false).then(function (ok) {
        if (ok && App.current === 'read') App.rerender();
      }).catch(function () {});
    },
    render: function (el) {
      el.appendChild(U.dom(segmented([
        { key: 'rec', label: T('推荐') },
        { key: 'feed', label: T('订阅') },
        { key: 'star', label: T('收藏') }
      ], state.tab, 'data-seg')));

      var body = U.dom('<div class="mt12"></div>');
      el.appendChild(body);

      el.addEventListener('click', function (e) {
        var seg = e.target.closest('[data-seg] [data-tab]');
        if (seg) { state.tab = seg.getAttribute('data-tab'); App.rerender(); }
      });

      if (state.tab === 'feed') renderFeed(body);
      else if (state.tab === 'star') renderStar(body);
      else renderRec(body);
    }
  });

  global.ReadView = {
    state: state,
    openAddFeed: openAddFeed,
    openCatalog: openCatalog,
    openSourceManager: openSourceManager
  };
})(window);
