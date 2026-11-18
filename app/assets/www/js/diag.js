/* 诊断面板。
 *
 * 为什么要有这个：真机上出的问题（白屏、订阅源拉不到、发音没声音）没法从
 * 用户那里拿 logcat，也不该让用户为了报错去装 adb。这个面板把「环境是什么、
 * 哪一步超时了、网络到底通不通」直接摊在屏幕上，一键复制成纯文本发出来即可。
 *
 * 它只读不写：除了自己开的临时 IndexedDB 连接之外不碰任何数据。
 */
(function (global) {
  'use strict';

  var report = [];
  var pre = null;
  var busy = false;

  function withTimeout(p, ms, label) {
    return new Promise(function (res, rej) {
      var t = setTimeout(function () { rej(new Error(label + ' 超时（' + ms + 'ms）')); }, ms);
      Promise.resolve(p).then(function (v) { clearTimeout(t); res(v); },
        function (e) { clearTimeout(t); rej(e); });
    });
  }

  function ms(t0) { return (Date.now() - t0) + 'ms'; }

  function text() { return report.join('\n'); }

  function paint() {
    if (pre) pre.textContent = text();
  }

  function head(t) { report.push(''); report.push('== ' + t + ' =='); paint(); }
  function ln(k, v) { report.push(k + ': ' + v); paint(); }

  function platform() {
    try {
      return (global.Bridge && Bridge.platform && Bridge.platform()) || {};
    } catch (e) {
      return {};
    }
  }

  function native(name) {
    var N = global.NativeBridge;
    return N && typeof N[name] === 'function' ? N : null;
  }

  function syncCall(name, args) {
    var N = native(name);
    if (!N) return null;
    try { return N[name].apply(N, args || []); } catch (e) { return 'ERR ' + (e && e.message || e); }
  }

  /* ---------------------------- 静态信息 ---------------------------- */

  function environment() {
    var p = platform();
    var v = (global.App && App.version) || null;
    var ua = global.navigator ? navigator.userAgent : '';
    var wv = /Chrome\/([\d.]+)/.exec(ua);

    head('应用');
    ln('版本', (global.App && App.versionText && App.versionText()) || '未知');
    ln('构建日期', (v && v.buildDate) || '未知');
    ln('包名', (v && v.packageName) || 'com.wordpalace.app');
    ln('页面语言', (global.I18N && I18N.lang) || '?');

    head('设备');
    ln('机型', (p.brand || '?') + ' ' + (p.model || '?'));
    ln('Android', (p.release || '?') + ' (SDK ' + (p.sdk || '?') + ')');
    ln('ABI', p.abi || '未知');
    ln('原生桥', global.NativeBridge ? '已注入' : '未注入（浏览器打开？）');
    ln('WebView', (wv ? wv[1] : '未知') + ' / ' + ua);

    head('显示');
    var nativeDark = syncCall('isSystemDark');
    ln('系统深浅色（原生）', nativeDark === null ? '取不到' : (nativeDark ? '深色' : '浅色'));
    var mqDark = null;
    try { mqDark = global.matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) {}
    ln('系统深浅色（WebView）', mqDark === null ? '取不到' : (mqDark ? '深色' : '浅色'));
    ln('主题偏好', (global.Store && Store.settings.theme) || '?');
    ln('当前主题', (global.Theme && Theme.current) || '?');
    ln('判定来源', (global.Theme && Theme.source) || '?');

    head('存储');
    ln('IndexedDB 状态', (global.Store && Store.storageState) || '?');
    ln('内存模式', (global.Store && Store.memoryMode) ? '是（数据不落盘）' : '否');
    ln('localStorage 可写', lsProbe());

    head('词库 / 语音');
    var p2 = platform();
    ln('词库', (global.Dict && Dict.ready && Dict.ready())
      ? (Dict.wordCount() + ' 词') : '未装载');
    ln('OCR 可用', p2.ocr ? '是' : '否');
    var ti = syncCall('ttsInfo');
    if (ti) {
      ln('TTS 原始信息', ti);
    } else {
      ln('TTS 可用', p2.tts ? '是' : '否');
    }
  }

  function lsProbe() {
    try {
      global.localStorage.setItem('wp.diag.probe', '1');
      var ok = global.localStorage.getItem('wp.diag.probe') === '1';
      global.localStorage.removeItem('wp.diag.probe');
      return ok ? '是' : '否';
    } catch (e) {
      return '否（' + (e && e.name || 'error') + '）';
    }
  }

  /* ---------------------------- 动态探测 ---------------------------- */

  function probeIdb() {
    return new Promise(function (resolve) {
      var done = false;
      var t = setTimeout(function () {
        if (done) return; done = true; resolve('超时（5s 无回应）');
      }, 5000);
      try {
        if (!global.indexedDB) throw new Error('indexedDB 不存在');
        var req = indexedDB.open('wp.diag.probe', 1);
        req.onupgradeneeded = function () {};
        req.onsuccess = function () {
          if (done) return; done = true; clearTimeout(t);
          try { req.result.close(); } catch (e) {}
          try { indexedDB.deleteDatabase('wp.diag.probe'); } catch (e) {}
          resolve('可用');
        };
        req.onerror = function () {
          if (done) return; done = true; clearTimeout(t);
          resolve('失败：' + ((req.error && req.error.name) || '未知'));
        };
        req.onblocked = function () { if (!done) { done = true; clearTimeout(t); resolve('被阻塞（onblocked）'); } };
      } catch (e) {
        if (done) return; done = true; clearTimeout(t);
        resolve('异常：' + (e && e.message || e));
      }
    });
  }

  function probeAsset(url) {
    var t0 = Date.now();
    return withTimeout(fetch(url, { cache: 'no-store' }).then(function (r) {
      return r.arrayBuffer().then(function (b) {
        return { status: r.status, bytes: b.byteLength };
      });
    }), 15000, url).then(function (r) {
      return 'OK HTTP ' + r.status + ' / ' + r.bytes + ' 字节 / ' + ms(t0);
    }, function (e) {
      return '失败：' + (e && e.message || e) + ' / ' + ms(t0);
    });
  }

  function probeNativeHttp(url) {
    var t0 = Date.now();
    // 这里显式给 8 秒：直连默认只等 6 秒（原生最坏 4.5s 就会回信），
    // 探测希望看到原生自己的失败原因，而不是被 JS 提前判超时。
    return withTimeout(Bridge.http(url, { timeoutMs: 8000 }), 11000, url).then(function (r) {
      if (r && r.ok) {
        var len = (r.body || '').length;
        return 'OK HTTP ' + r.status + ' / ' + len + ' 字符 / ' + ms(t0);
      }
      return '失败：' + ((r && (r.error || ('HTTP ' + r.status))) || '空响应') + ' / ' + ms(t0);
    }, function (e) {
      return '超时或异常：' + (e && e.message || e) + ' / ' + ms(t0);
    });
  }

  function probeWebFetch(url) {
    if (!Bridge.hasWebFetch || !Bridge.hasWebFetch()) return Promise.resolve('原生不支持');
    var t0 = Date.now();
    // 原生看门狗是 6 秒，所以给 8 秒：让「浏览器引擎请求超时」这条原生错误先回来。
    return withTimeout(Bridge.webFetch(url, { timeoutMs: 8000 }), 11000, url).then(function (r) {
      if (r && r.ok) return 'OK' + (r.status ? ' HTTP ' + r.status : '') + ' / ' + ((r.body || '').length) + ' 字符 / ' + ms(t0);
      return '失败：' + ((r && r.error) || '') + ' / ' + ms(t0);
    }, function (e) {
      return '超时或异常：' + (e && e.message || e) + ' / ' + ms(t0);
    });
  }

  var NET_TARGETS = [
    { name: 'HTTPS 探测', url: 'https://www.baidu.com/' },
    { name: '明文 HTTP 探测', url: 'http://www.people.com.cn/' }
  ];

  function probes() {
    head('存储探测');
    return probeIdb().then(function (r) {
      ln('新建 IndexedDB 连接', r);

      head('内置资源读取');
      return probeAsset('version.json').then(function (r1) {
        ln('version.json', r1);
        return probeAsset('data/words.json');
      }).then(function (r2) {
        ln('data/words.json', r2);
      });
    }).then(function () {
      var chain = Promise.resolve();
      NET_TARGETS.forEach(function (t) {
        chain = chain.then(function () {
          head('网络：' + t.name + '（' + t.url + '）');
          return probeNativeHttp(t.url).then(function (r) {
            ln('原生 HttpURLConnection', r);
            return probeWebFetch(t.url);
          }).then(function (r2) {
            ln('WebView 后备通道', r2);
          });
        });
      });
      return chain;
    }).then(function () {
      head('启动步骤');
      var steps = (global.App && App.diag && App.diag.steps) || [];
      if (!steps.length) ln('步骤', '无记录（启动已完成且页面重绘过？）');
      steps.forEach(function (s) {
        ln(s.name, s.state + (s.ms ? ' / ' + s.ms + 'ms' : '') + (s.note ? ' / ' + s.note : ''));
      });
      head('最近报错');
      var errs = (global.App && App.diag && App.diag.errors) || [];
      if (!errs.length) ln('报错', '无');
      errs.forEach(function (e) { ln(e.at + ' ' + e.where, e.msg); });
      report.push('');
      report.push('== 结束 ==');
      paint();
    }).catch(function (e) {
      ln('探测异常', (e && e.message) || e);
    });
  }

  /* ------------------------------ 面板 ------------------------------ */

  function open() {
    if (busy) return;
    busy = true;
    report = [];
    pre = document.createElement('pre');
    pre.setAttribute('style',
      'white-space:pre-wrap;word-break:break-all;font-size:11px;line-height:1.5;' +
      'margin:0;max-height:56vh;overflow:auto;background:transparent;color:inherit');
    pre.textContent = '正在收集…';

    var body = U.dom('<div></div>');
    body.appendChild(pre);

    var foot = U.dom('<div class="sheet-foot">' +
      '<button class="btn grow" data-d="copy">复制诊断信息</button>' +
      '<button class="btn ghost" data-d="speak">测试发音</button>' +
      '<button class="btn ghost" data-d="reload">重载</button>' +
      '</div>');

    var sheet = U.openSheet({ title: '诊断信息', body: body, footer: foot });

    foot.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-d]');
      if (!b) return;
      var a = b.getAttribute('data-d');
      if (a === 'copy') {
        Bridge.copy(text());
        U.toast('已复制');
      } else if (a === 'speak') {
        Bridge.vibrate(20);
        Bridge.speak('apple');
        U.toast('已请求发音：若没声音，请到「词书 → 学习设置」打开系统语音设置');
      } else if (a === 'reload') {
        sheet.close();
        try { location.reload(); } catch (e) {}
      }
    });

    environment();
    probes().then(function () {
      busy = false;
      paint();
    }, function () {
      busy = false;
      paint();
    });
  }

  /**
   * 从系统「文字转语音」设置回来后刷新发音状态。
   * 原生 onResume 会调它——用户可能刚在那里装好英语语音，界面上的状态
   * 应该立刻反映出来，而不是等下次启动设置页。
   */
  function refreshTts() {
    var el = null;
    try { el = document.getElementById('set-tts-note'); } catch (e) { el = null; }
    if (!el) return;
    var info = null;
    try { info = global.Bridge && Bridge.ttsInfo ? Bridge.ttsInfo() : null; } catch (e) { info = null; }
    var L = global.I18N ? I18N.L : function (k) { return k; };
    var txt;
    if (!info) txt = L('ttsAuto');
    else if (!info.available) txt = info.note || L('ttsHint');
    else txt = (info.language || '') + (info.note ? ' · ' + info.note : '');
    el.textContent = txt;
  }

  global.Diag = { open: open, collect: text, refreshTts: refreshTts };
})(typeof window !== 'undefined' ? window : this);
