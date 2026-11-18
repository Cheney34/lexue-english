/* 应用入口：路由、底部导航、标题栏、子页面栈 */
(function (global) {
  'use strict';

  /*
   * 底部导航：首页「背单词」居中（第 3/5 个），一打开应用就能直接开始背。
   * 词典不再占一个标签位——它变成了标题栏右上角的全局搜索入口，任何页面都能叫出来。
   */
  var TABS = [
    { id: 'gallery', label: '图库', svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="15" rx="2.6"/><circle cx="8.6" cy="9.8" r="1.7"/><path d="M3.6 17.6l4.6-4.6a2 2 0 0 1 2.8 0l3.1 3.1"/><path d="M14.2 15.1l2.4-2.4a2 2 0 0 1 2.8 0l2 2"/></svg>' },
    { id: 'scan',    label: '识图', svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4.2 8.8h2.5l1.3-2.3h8l1.3 2.3h2.5A1.6 1.6 0 0 1 21.4 10.4v7.8a1.6 1.6 0 0 1-1.6 1.6H4.2a1.6 1.6 0 0 1-1.6-1.6v-7.8A1.6 1.6 0 0 1 4.2 8.8z"/><circle cx="12" cy="14.2" r="3.1"/></svg>' },
    { id: 'review',  label: '背单词', svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4.6 12a7.4 7.4 0 0 1 12.4-5.5"/><path d="M17.9 3.6v3.6h-3.6"/><path d="M19.4 12a7.4 7.4 0 0 1-12.4 5.5"/><path d="M6.1 20.4v-3.6h3.6"/></svg>' },
    { id: 'read',    label: '阅读', svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6.6C10.4 5.3 8.6 4.7 6.4 4.7H3.6v13c2 0 3.7.6 5.4 1.9V6.6z"/><path d="M12 6.6c1.6-1.3 3.4-1.9 5.6-1.9h2.8v13c-2 0-3.7.6-5.4 1.9"/><path d="M12 6.6v13"/></svg>' },
    { id: 'books',   label: '词书', svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.6" y="4.6" width="7" height="14.8" rx="1.5"/><rect x="13.4" y="4.6" width="7" height="14.8" rx="1.5"/><path d="M6 8.4h1.8M15.8 8.4H18M6 12h1.8M15.8 12H18"/></svg>' }
  ];

  /** 首页（居中那个）：背单词 */
  var HOME_TAB = 'review';

  function isTabId(id) {
    for (var i = 0; i < TABS.length; i++) if (TABS[i].id === id) return true;
    return false;
  }



  var screens = {};
  var currentTab = null;
  var versionInfo = null;    // 来自 assets/www/version.json（由 build.sh 从 version.json 生成）
  var lastTab = null;      // 从哪个标签跳到「词典」这类非标签页，返回时回到它
  var subStack = [];
  var barActions = [];

  function register(id, def) {
    screens[id] = def;
    def.id = id;
  }

  function screenEl() { return document.getElementById('screen'); }

  function renderTabs() {
    var bar = document.getElementById('tabbar');
    bar.innerHTML = TABS.map(function (t) {
      return '<button class="tab" data-tab="' + t.id + '">' +
        '<span class="ic">' + t.svg + '</span><span>' + T(t.label) + '</span>' +
        (t.id === 'review' ? '<span class="dot hide" id="tab-due-dot"></span>' : '') +
        '</button>';
    }).join('');
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('[data-tab]');
      if (!b) return;
      go(b.getAttribute('data-tab'));
    });
  }

  function paintTabs() {
    U.$$('#tabbar .tab').forEach(function (b) {
      var on = b.getAttribute('data-tab') === currentTab;
      b.classList[on ? 'add' : 'remove']('on');
    });
  }

  function setBar(title, sub, actions) {
    // 标题是视图注册时写的字面量，在渲染这一刻才翻译——
    // 注册发生在脚本加载期，那时语言可能还没定下来
    document.getElementById('bar-title').innerHTML =
      '<span class="t">' + U.esc(title ? T(title) : T('乐学英语')) + '</span>' +
      (sub ? '<span class="sub">' + U.esc(T(sub)) + '</span>' : '');
    barActions = actions || [];
    var box = document.getElementById('bar-actions');
    // 最右侧常驻一个词典搜索按钮：任何页面都能直接查词
    box.innerHTML = barActions.map(function (a) {
      return '<button class="appbar-btn" data-act="' + a.key + '">' + U.esc(a.label) + '</button>';
    }).join('') +
      T('<button class="appbar-btn appbar-search" data-act="__dict" title="查词典" aria-label="查词典">') +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
        'stroke-linecap="round" stroke-linejoin="round"><circle cx="10.8" cy="10.8" r="6.3"/>' +
        '<path d="M15.4 15.4L20.6 20.6"/></svg></button>';
  }

  /* ============================ 设置面板 ============================
   * 左上角齿轮打开。只放「语言」与「外观」两项——
   * 这两项是随时想改、且与当前内容无关的；学习相关的设置仍在「词书」页里。
   * ================================================================= */

  var LANG_OPTIONS = [
    { v: 'auto',    name: function () { return I18N.L('followSystem'); } },
    { v: 'zh-Hans', name: function () { return I18N.langName('zh-Hans'); } },
    { v: 'zh-Hant', name: function () { return I18N.langName('zh-Hant'); } },
    { v: 'en',      name: function () { return I18N.langName('en'); } }
  ];

  var THEME_OPTIONS = [
    { v: 'auto',  name: function () { return I18N.L('themeAuto'); } },
    { v: 'light', name: function () { return I18N.L('light'); } },
    { v: 'dark',  name: function () { return I18N.L('dark'); } }
  ];

  function settingsRow(group, opt, value) {
    var on = value === opt.v;
    return '<div class="list-item opt' + (on ? ' on' : '') + '" data-set="' + group +
      '" data-v="' + opt.v + '">' +
      '<div class="li-main"><div class="li-title">' + U.esc(opt.name()) + '</div></div>' +
      '<span class="opt-mark">' + (on ? '✓' : '') + '</span></div>';
  }

  function openSettings() {
    var body = U.dom('<div></div>');
    var sheet = U.openSheet({ title: I18N.L('settings'), body: body });

    function paint() {
      var lang = Store.settings.lang || 'auto';
      var theme = Store.settings.theme || 'auto';
      body.innerHTML =
        '<div class="section-title">' + U.esc(I18N.L('language')) + '</div>' +
        '<div class="card tight">' +
          LANG_OPTIONS.map(function (o) { return settingsRow('lang', o, lang); }).join('') +
        '</div>' +
        '<div class="muted xsmall mt8">' + U.esc(I18N.L('langAuto')) + '</div>' +
        '<div class="section-title mt12">' + U.esc(I18N.L('appearance')) + '</div>' +
        '<div class="card tight">' +
          THEME_OPTIONS.map(function (o) { return settingsRow('theme', o, theme); }).join('') +
        '</div>' +
        '<div class="muted xsmall mt8">' + U.esc(I18N.L('themeHint')) + '</div>' +
        '<button class="btn block ghost mt12" data-more="1">' + U.esc(I18N.L('moreSettings')) + '</button>';
    }

    body.addEventListener('click', function (e) {
      if (e.target.closest('[data-more]')) {
        sheet.close();
        go('books');
        return;
      }
      var row = e.target.closest('[data-set]');
      if (!row) return;
      var group = row.getAttribute('data-set');
      var v = row.getAttribute('data-v');
      if (group === 'lang') {
        if (Store.settings.lang === v) return;
        Store.settings.lang = v;
        Store.saveSettings();
        I18N.setLang(v);
        U.haptic();
        // 界面文案已经烘进 DOM，改语言要整页重画一次
        renderTabs();
        refresh();
        paint();
        sheet.setTitle(I18N.L('settings'));
      } else {
        if (Store.settings.theme === v) return;
        Store.settings.theme = v;
        Store.saveSettings();
        Theme.apply();
        U.haptic();
        paint();
      }
    });

    paint();
    return sheet;
  }

  /** 打开词典（非标签页，返回时回到刚才的标签） */
  function openDict() {
    if (currentTab === 'dict') return;
    go('dict');
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('#bar-actions [data-act]');
    if (!b) return;
    var key = b.getAttribute('data-act');
    if (key === '__dict') { openDict(); return; }
    for (var i = 0; i < barActions.length; i++) {
      if (barActions[i].key === key && barActions[i].onClick) {
        barActions[i].onClick();
        return;
      }
    }
  });

  /**
   * 清空并返回一个**全新的** #screen 节点。
   * 视图会把事件监听挂在 #screen 上，若复用同一节点，反复渲染会导致
   * 监听器累积、旧闭包引用已销毁的 DOM，因此这里整体替换节点。
   */
  function clearScreen() {
    var old = document.getElementById('screen');
    var el = document.createElement('main');
    el.className = 'screen';
    el.id = 'screen';
    old.parentNode.replaceChild(el, old);
    return el;
  }

  /** 渲染当前 tab 的顶层页面 */
  function renderTop() {
    subStack = [];
    var def = screens[currentTab];
    if (!def) return;
    var el = clearScreen();
    setBar(def.title, def.sub, typeof def.actions === 'function' ? def.actions() : def.actions);
    if (def.render) def.render(el);
  }

  function rerender() {
    if (subStack.length) {
      var top = subStack[subStack.length - 1];
      var el = clearScreen();
      top(el);
    } else {
      renderTop();
    }
  }

  /** 打开子页面；fn(container) 负责渲染，可用 opts 覆盖标题栏 */
  function push(fn, opts) {
    opts = opts || {};
    if (opts.keepBar !== true) {
      setBar(opts.title || '', opts.sub || '', opts.actions || []);
    }
    subStack.push(function (el) {
      if (opts.title !== undefined) setBar(opts.title, opts.sub || '', opts.actions || []);
      fn(el, opts);
    });
    // 首次渲染
    var el = clearScreen();
    subStack[subStack.length - 1](el);
  }

  function pop() {
    if (!subStack.length) return false;
    subStack.pop();
    rerender();
    return true;
  }

  function go(tabId) {
    if (!screens[tabId]) return;
    // 离开某个标签页时记一下，供「词典」这类非标签页返回使用
    if (currentTab && currentTab !== tabId && isTabId(currentTab)) lastTab = currentTab;
    currentTab = tabId;
    paintTabs();
    renderTop();
    if (screens[tabId].onEnter) screens[tabId].onEnter();
  }

  function refresh() {
    var def = screens[currentTab];
    if (subStack.length) return;
    if (!def) return;
    var el = clearScreen();
    setBar(def.title, def.sub, typeof def.actions === 'function' ? def.actions() : def.actions);
    if (def.render) def.render(el);
  }

  function updateDueDot() {
    Store.cardStats().then(function (s) {
      var dot = document.getElementById('tab-due-dot');
      if (!dot) return;
      if (s.due > 0) {
        dot.textContent = s.due > 99 ? '99+' : String(s.due);
        dot.classList.remove('hide');
      } else {
        dot.classList.add('hide');
      }
    });
  }

  /* 安卓返回键 */
  /** 语言变化后重画整个界面：标签栏与当前页都是渲染时翻译的 */
  function onLocaleChange() {
    renderTabs();
    if (currentTab) refresh();
  }

  global.__wpBack = function () {
    if (U.closeTopSheet()) return 1;
    if (subStack.length) { pop(); return 1; }
    if (!isTabId(currentTab)) { go(lastTab && screens[lastTab] ? lastTab : HOME_TAB); return 1; }
    if (currentTab !== HOME_TAB) { go(HOME_TAB); return 1; }
    return 0;
  };

  /**
   * 读取版本信息。
   * 这个文件由构建脚本从项目根的 version.json 拷进来，是版本号的唯一来源——
   * 界面上的「版本」永远和安装的 APK 一致，不会出现两处各写一份、对不上的情况。
   */
  function loadVersion() {
    return fetch('version.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { versionInfo = d || null; return versionInfo; })
      .catch(function () { versionInfo = null; return null; });
  }

  /** 形如「乐学英语 v1.1.0 (build 2)」 */
  function versionText() {
    var v = versionInfo;
    if (!v || !v.versionName) return T('版本信息不可用');
    return (v.appName || T('乐学英语')) + ' v' + v.versionName +
      ' (build ' + v.versionCode + ')';
  }

  /** 更新日志：把 version.json 里的 history 摊成一张清单 */
  function changelogSheet() {
    var v = versionInfo;
    if (!v || !(v.history || []).length) {
      U.alertBox ? U.alertBox(T('更新日志'), T('暂无更新记录')) : U.toast(T('暂无更新记录'));
      return;
    }
    var html = (v.history || []).map(function (h, idx) {
      return '<div class="card tight"' + (idx ? ' style="margin-top:8px"' : '') + '>' +
        '<div class="row between">' +
          '<div class="bold">v' + U.esc(h.version) + '</div>' +
          '<div class="muted xsmall">' + U.esc(h.date || '') + '</div>' +
        '</div>' +
        (h.title ? '<div class="muted xsmall mt8">' + U.esc(h.title) + '</div>' : '') +
        '<ul class="cl-list">' + (h.changes || []).map(function (c) {
          return '<li>' + U.esc(c) + '</li>';
        }).join('') + '</ul>' +
      '</div>';
    }).join('');
    U.openSheet({
      title: T('更新日志'),
      body: U.dom('<div>' +
        '<div class="muted small mb8">' + U.esc(versionText()) +
        (v.buildDate ? ' · ' + U.esc(v.buildDate) : '') + '</div>' + html + '</div>')
    });
  }

  /* ============================ 启动诊断 ============================
   * 真机上的「白屏 / 一直转圈」没法抓日志，所以把启动每一步的状态、耗时、
   * 以及捕获到的报错都留在内存里：卡住时直接把现场摊在屏幕上，
   * 用户点「诊断信息」复制一段文本就能定位，不需要 adb。
   * ================================================================ */

  var diag = { steps: [], errors: [], startAt: 0 };
  var bootWatchdog = null;
  var bootedOnce = false;

  var BOOT_WATCHDOG_MS = 25000;

  function errText(e) {
    if (!e) return '未知错误';
    if (typeof e === 'string') return e;
    return String((e.name ? e.name + ': ' : '') + (e.message || e));
  }

  function recordError(where, e) {
    diag.errors.push({ at: (Date.now() - diag.startAt) + 'ms', where: where, msg: errText(e) });
    if (diag.errors.length > 40) diag.errors.shift();
    paintBootStatus();
  }

  function installErrorHooks() {
    if (global.__wpErrHooked) return;
    global.__wpErrHooked = true;
    global.addEventListener('error', function (ev) {
      var msg;
      if (ev && ev.message) msg = ev.message + ' @' + ev.lineno + ':' + ev.colno;
      else msg = '资源加载失败：' + ((ev && ev.target && (ev.target.src || ev.target.href)) || '?');
      recordError('window.onerror', msg);
    });
    global.addEventListener('unhandledrejection', function (ev) {
      recordError('unhandledrejection', errText(ev && ev.reason));
    });
    // 原生转发过来的控制台报错与「网页进程崩了 / 主文档加载失败」
    global.__wpLog = function (level, msg) { recordError('console.' + level, msg); };
    global.__wpNativeError = function (kind, detail) {
      recordError('native:' + kind, detail);
      showBootProblem(T('网页内容加载失败'), detail);
    };
  }

  /** 给启动的每一步记一笔状态与耗时，供诊断与错误页展示 */
  function track(name) {
    var rec = { name: name, state: 'running', ms: 0, note: '' };
    diag.steps.push(rec);
    var t0 = Date.now();
    function set(state, note) {
      rec.state = state;
      rec.ms = Date.now() - t0;
      if (note) rec.note = note;
      paintBootStatus();
    }
    return {
      done: function () { set('ok'); },
      soft: function (note) { set('warn', note); },
      fail: function (note) { set('fail', note); }
    };
  }

  /**
   * 给任意 Promise 加超时。
   * 这个项目里绝大多数「卡死」都是某个 Promise 永远不 settle（本地存储被 ROM
   * 拦下、2MB 词库读取卡住……），加一道超时就能保证界面一定走得下去。
   */
  function withTimeout(p, ms, label) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () {
        reject(new Error(label + ' 超过 ' + Math.round(ms / 1000) + ' 秒没有响应'));
      }, ms);
      Promise.resolve(p).then(function (v) {
        clearTimeout(t); resolve(v);
      }, function (e) {
        clearTimeout(t); reject(e);
      });
    });
  }

  function paintBootStatus() {
    if (bootedOnce) return;
    var el = document.getElementById('boot-hint');
    if (!el) return;
    var parts = diag.steps.map(function (s) {
      var mark = s.state === 'ok' ? '✓' : (s.state === 'running' ? '…' : (s.state === 'warn' ? '!' : '✕'));
      return mark + s.name + (s.ms ? ' ' + s.ms + 'ms' : '');
    });
    if (diag.errors.length) parts.push('报错 ' + diag.errors.length + ' 条');
    el.textContent = parts.join('　');
  }

  function stepRows() {
    if (!diag.steps.length) return '<div class="li-sub">（没有记录到启动步骤）</div>';
    return diag.steps.map(function (s) {
      var mark = s.state === 'ok' ? '✓' : (s.state === 'running' ? '…' : (s.state === 'warn' ? '!' : '✕'));
      return '<div style="padding:4px 0"><b>' + mark + ' ' + U.esc(s.name) + '</b>' +
        (s.ms ? ' <span class="muted xsmall">' + s.ms + 'ms</span>' : '') +
        (s.note ? '<div class="muted xsmall">' + U.esc(s.note) + '</div>' : '') + '</div>';
    }).join('');
  }

  function errorRows() {
    if (!diag.errors.length) return '';
    return diag.errors.slice(-8).map(function (e) {
      return '<div style="padding:4px 0"><b class="xsmall">' + U.esc(e.at + ' ' + e.where) + '</b>' +
        '<div class="muted xsmall" style="word-break:break-all">' + U.esc(e.msg) + '</div></div>';
    }).join('');
  }

  /** 启动走不下去时的兜底页面：看得见原因 + 能重新加载 + 能复制诊断 */
  function showBootProblem(title, detail) {
    var box = document.getElementById('screen');
    if (!box) { try { U.toast(title + (detail ? '：' + detail : ''), 8000); } catch (e) {} return; }
    box.innerHTML =
      '<div style="padding:20px 14px">' +
        '<div style="text-align:center;font-size:34px">⚠️</div>' +
        '<h3 style="text-align:center">' + U.esc(title) + '</h3>' +
        (detail ? '<p class="small muted" style="word-break:break-all">' + U.esc(detail) + '</p>' : '') +
        '<div class="card tight mt12">' + stepRows() + errorRows() + '</div>' +
        '<div class="row mt12" style="gap:8px">' +
          '<button class="btn grow" id="boot-retry">重新加载</button>' +
          '<button class="btn ghost grow" id="boot-diag">诊断信息</button>' +
        '</div>' +
        '<div class="muted xsmall mt8">' + U.esc(T('把「诊断信息」里的内容发给我，就能定位问题。')) + '</div>' +
      '</div>';
    var r = document.getElementById('boot-retry');
    if (r) r.addEventListener('click', function () { try { location.reload(); } catch (e) {} });
    var d = document.getElementById('boot-diag');
    if (d) d.addEventListener('click', function () { if (global.Diag) global.Diag.open(); });
  }

  function boot() {
    // 语言和主题要在任何界面渲染之前定下来，否则会先闪一下默认语言/浅色
    I18N.setLang(Store.settings.lang);
    Theme.init();
    // 把发音引擎模式同步给原生（默认 auto = 优先英语发音）：
    // 有些手机上系统只装了中文语音，切到 system 才发得出声
    try { Bridge.setTtsMode(Store.settings.ttsMode || 'auto'); } catch (e) {}
    bindSettingsButton();
    renderTabs();
    installErrorHooks();
    diag.startAt = Date.now();
    paintBootStatus();

    // 看门狗：万一某一步连超时都没触发，也要给用户一个出口，而不是永远转圈
    bootWatchdog = setTimeout(function () {
      if (bootedOnce) return;
      recordError('watchdog', '启动 ' + Math.round(BOOT_WATCHDOG_MS / 1000) + ' 秒仍未完成');
      showBootProblem(T('启动超时'), T('下面哪一步没完成，基本就是问题所在。'));
    }, BOOT_WATCHDOG_MS);

    var soft = [];
    var tStore = track(T('本地存储'));
    var tDict = track(T('离线词库'));
    var tVer = track(T('版本信息'));

    Promise.all([
      // 本地存储不可用不致命：Store 的读写会落到内存兜底，只是关掉应用不留数据
      withTimeout(Store.init(), 9000, '本地存储').then(function () {
        tStore.done();
      }, function (e) {
        tStore.soft(errText(e));
        soft.push(T('本地存储不可用，学习记录不会被保存'));
      }),
      withTimeout(Dict.load(), 20000, '离线词库').then(function (ok) {
        if (ok) tDict.done();
        else { tDict.soft('词库返回空'); soft.push(T('离线词库没能装载')); }
      }, function (e) {
        tDict.fail(errText(e));
        soft.push(T('离线词库装载失败'));
      }),
      withTimeout(loadVersion(), 8000, '版本信息').then(function () { tVer.done(); },
        function (e) { tVer.soft(errText(e)); })
    ])
      .then(function () {
        var tFeed = track(T('订阅缓存'));
        if (!global.Feed) { tFeed.soft('无订阅模块'); return null; }
        // 订阅拉取失败绝不能挡住启动：它只是「阅读」页的内容
        return withTimeout(
          global.Feed.syncWithCatalog().then(function () { return global.Feed.loadCache(); }),
          12000, '订阅缓存'
        ).then(function () {
          tFeed.done();
        }, function (e) {
          tFeed.soft(errText(e));
        });
      })
      .then(function () {
        bootedOnce = true;
        if (bootWatchdog) { clearTimeout(bootWatchdog); bootWatchdog = null; }
        var hint = document.getElementById('boot-hint');
        if (hint) hint.textContent = '';
        go(HOME_TAB);
        updateDueDot();
        setInterval(updateDueDot, 30000);
        if (soft.length) U.toast(soft.join('；'), 7000);
        // 启动后静默预热订阅缓存：过期才真正联网，成功后刷新「阅读」页
        if (Store.settings.autoFeed !== false && global.Feed) {
          setTimeout(function () {
            global.Feed.ensureFeeds(false).then(function () {
              if (currentTab === 'read' && !subStack.length) refresh();
            }).catch(function (e) { recordError('feed.warmup', e); });
          }, 1500);
        }
      })
      .catch(function (e) {
        // 走到这里只剩「首页本身渲染不出来」这类硬故障
        recordError('boot', e);
        showBootProblem(T('初始化失败'), errText(e));
      });
  }

  function bindSettingsButton() {
    var btn = document.getElementById('bar-settings');
    if (btn) btn.addEventListener('click', function () { openSettings(); });
  }

  global.App = {
    register: register, go: go, push: push, pop: pop, refresh: refresh,
    rerender: rerender, setBar: setBar, updateDueDot: updateDueDot,
    tabs: TABS, screens: screens, homeTab: HOME_TAB,
    openDict: openDict,
    openSettings: openSettings,
    onLocaleChange: onLocaleChange,
    loadVersion: loadVersion,
    versionText: versionText,
    changelogSheet: changelogSheet,
    // 诊断：面板在 js/diag.js，这里只暴露现场数据与错误展示入口
    diag: diag,
    recordError: recordError,
    errText: errText,
    showBootProblem: showBootProblem,
    stepRows: stepRows,
    errorRows: errorRows,
    get version() { return versionInfo; },
    get current() { return currentTab; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
