/**
 * 主题（浅色 / 深色 / 跟随系统）。
 *
 * 做法是给 <html> 挂 data-theme，样式集中在 CSS 变量上做覆盖，
 * JS 只负责「算出当前该用哪套」这一件事。
 *
 * 「跟随系统」判定必须以**原生**为准：
 * WebView 的 prefers-color-scheme 取自应用自己的夜间模式配置，在部分 ROM
 * （实测澎湃 OS / Android 17）上即使系统已是深色，WebView 仍报 light，
 * 于是「跟随系统」永远停在浅色——这就是用户报的「默认深浅色有问题」。
 * 所以这里优先问原生的 Configuration.uiMode，matchMedia 只作兜底。
 */
(function (global) {
  'use strict';

  var mq = null;
  var lastSource = 'none';

  /** 问原生：系统当前是不是深色。拿不到返回 null（浏览器里开发时就是这种） */
  function nativeDark() {
    try {
      var N = global.NativeBridge;
      if (N && typeof N.isSystemDark === 'function') {
        var v = N.isSystemDark();
        if (typeof v === 'boolean') { lastSource = 'native'; return v; }
        if (v === 'true' || v === 'false') { lastSource = 'native'; return v === 'true'; }
      }
    } catch (e) {}
    return null;
  }

  function mediaDark() {
    try {
      return !!(global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches);
    } catch (e) {
      return false;
    }
  }

  function systemDark() {
    var n = nativeDark();
    if (n !== null) return n;
    lastSource = 'media';
    return mediaDark();
  }

  /** pref: 'auto' | 'light' | 'dark' */
  function resolve(pref) {
    if (pref === 'light' || pref === 'dark') return pref;
    return systemDark() ? 'dark' : 'light';
  }

  function currentPref() {
    try {
      return (global.Store && Store.settings && Store.settings.theme) || 'auto';
    } catch (e) {
      return 'auto';
    }
  }

  function apply() {
    var th = resolve(currentPref());
    var root = global.document && global.document.documentElement;
    if (root) root.setAttribute('data-theme', th);
    // 状态栏颜色跟着变，否则深色下顶部会有一条亮边
    try {
      var meta = global.document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', th === 'dark' ? '#141a22' : '#3d5a80');
    } catch (e) {}
    return th;
  }

  /** 跟随系统时，系统切换深浅色要即时反映 */
  function watch() {
    try {
      if (mq || !global.matchMedia) return;
      mq = global.matchMedia('(prefers-color-scheme: dark)');
      var handler = function () {
        // 原生可用时以原生为准：matchMedia 在部分 ROM 上不跟着系统走
        if (currentPref() === 'auto' && nativeDark() === null) apply();
      };
      if (mq.addEventListener) mq.addEventListener('change', handler);
      else if (mq.addListener) mq.addListener(handler);
    } catch (e) {}
  }

  /**
   * 原生侧 onConfigurationChanged 会调这个（见 MainActivity）。
   * 系统深浅色一变就立刻重算，不用等下一次进设置页。
   */
  function onSystemChange() {
    if (currentPref() === 'auto') return apply();
    return null;
  }

  function init() {
    apply();
    watch();
  }

  global.Theme = {
    init: init,
    apply: apply,
    resolve: resolve,
    systemDark: systemDark,
    onSystemChange: onSystemChange,
    get source() { return lastSource; },
    get current() {
      var root = global.document && global.document.documentElement;
      return root ? root.getAttribute('data-theme') : 'light';
    }
  };
})(typeof window !== 'undefined' ? window : this);
