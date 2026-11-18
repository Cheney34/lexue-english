/* JS ⇄ 原生桥。原生不可用时（浏览器调试）自动降级为 Web 实现。 */
(function (global) {
  'use strict';

  /** 动态读取原生桥：不用在加载时捕获，便于测试注入原生实现 */
  function native() { return global.NativeBridge || null; }

  var N = global.NativeBridge || null;   // 仅用于兼容旧引用，实际以 native() 为准
  var pending = {};
  var seq = 0;
  var platformInfo = null;

  /* 原生回调入口（Android 侧通过 evaluateJavascript 调用） */
  global.__nb = function (callId, json) {
    var p = pending[callId];
    if (!p) return;
    delete pending[callId];
    var data;
    try { data = typeof json === 'string' ? JSON.parse(json) : json; }
    catch (e) { data = { ok: false, error: T('回调数据解析失败') }; }
    p.resolve(data);
  };

  /**
   * 调用原生异步方法。
   * 约定：callId 固定为第一个参数（与 Bridge.java 中各方法的签名一致）。
   */
  function call(name, args, timeoutMs) {
    var N = native();
    return new Promise(function (resolve) {
      if (!N || typeof N[name] !== 'function') {
        resolve({ ok: false, error: 'unsupported' });
        return;
      }
      var id = 'c' + (++seq);
      pending[id] = { resolve: resolve };
      setTimeout(function () {
        if (pending[id]) {
          delete pending[id];
          resolve({ ok: false, error: 'timeout' });
        }
      }, timeoutMs || 60000);
      try {
        N[name].apply(N, [id].concat(args || []));
      } catch (e) {
        delete pending[id];
        resolve({ ok: false, error: String(e && e.message || e) });
      }
    });
  }

  function available() { return !!native(); }

  function platform() {
    if (platformInfo) return platformInfo;
    var N = native();
    if (N && typeof N.platform === 'function') {
      try { platformInfo = JSON.parse(N.platform()); }
      catch (e) { platformInfo = { name: 'unknown' }; }
    } else {
      platformInfo = { name: 'web', tts: typeof speechSynthesis !== 'undefined', ocr: false };
    }
    return platformInfo;
  }

  /* -------------------------------- 语音 -------------------------------- */

  var webVoice = null;
  function webSpeak(text, rate) {
    if (typeof speechSynthesis === 'undefined') return;
    try {
      if (!webVoice) {
        var vs = speechSynthesis.getVoices().filter(function (v) {
          return /^en(-|_)?/i.test(v.lang);
        });
        webVoice = vs[0] || null;
      }
      speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      u.rate = rate || 1;
      if (webVoice) u.voice = webVoice;
      speechSynthesis.speak(u);
    } catch (e) {}
  }

  var Bridge = {
    available: available,
    platform: platform,

    speak: function (text, rate) {
      if (!text) return;
      var N = native();
      rate = rate || (Store.settings.ttsRate || 1);
      if (N && typeof N.speak === 'function') {
        try { N.speak(String(text), rate); return; } catch (e) {}
      }
      webSpeak(String(text), rate);
    },

    stopSpeak: function () {
      var N = native();
      if (N && typeof N.stopSpeak === 'function') { try { N.stopSpeak(); return; } catch (e) {} }
      if (typeof speechSynthesis !== 'undefined') { try { speechSynthesis.cancel(); } catch (e) {} }
    },

    /* --------------------------- 系统深浅色 --------------------------- */

    /**
     * 系统当前是否深色。
     * 以原生 Configuration.uiMode 为准——有些 ROM 的 WebView 不会把系统深色
     * 透给 prefers-color-scheme，只看媒体查询会把界面永久锁在浅色。
     */
    isSystemDark: function () {
      var N = native();
      if (N && typeof N.isSystemDark === 'function') {
        try { return !!N.isSystemDark(); } catch (e) {}
      }
      try {
        return !!(global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches);
      } catch (e) { return false; }
    },

    /** 同步调用原生方法：拿不到（浏览器 / 旧版 APK）返回 null */
    sync: function (name, args) {
      var N = native();
      if (!N || typeof N[name] !== 'function') return null;
      try { return N[name].apply(N, args || []); } catch (e) { return null; }
    },

    /**
     * 发音引擎详细状态：{ available, engineReady, mode, engine, language, note, ... }
     * 旧版 APK 没有 ttsInfo，此时返回 null，调用方按「未知」处理。
     */
    ttsInfo: function () {
      var raw = Bridge.sync('ttsInfo');
      if (typeof raw !== 'string' || !raw) return null;
      try { return JSON.parse(raw); } catch (e) { return null; }
    },

    /** 发音引擎模式：'auto'（优先英语）| 'system'（系统默认语音） */
    setTtsMode: function (mode) {
      var N = native();
      if (N && typeof N.setTtsMode === 'function') {
        try { N.setTtsMode(String(mode)); } catch (e) {}
      }
    },

    /** 跳系统「文字转语音」设置，返回是否真的跳了 */
    openTtsSettings: function () {
      var N = native();
      if (N && typeof N.openTtsSettings === 'function') {
        try { N.openTtsSettings(); return true; } catch (e) {}
      }
      return false;
    },

    toast: function (msg) {
      var N = native();
      if (N && typeof N.toast === 'function') { try { N.toast(String(msg)); } catch (e) {} }
    },

    vibrate: function (ms) {
      var N = native();
      if (N && typeof N.vibrate === 'function') { try { N.vibrate(ms | 0); return; } catch (e) {} }
      if (navigator.vibrate) { try { navigator.vibrate(ms | 0); } catch (e) {} }
    },

    copy: function (text) {
      var N = native();
      if (N && typeof N.copy === 'function') { try { N.copy(String(text)); return true; } catch (e) {} }
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        return true;
      } catch (e) { return false; }
    },

    openExternal: function (url) {
      var N = native();
      if (N && typeof N.openExternal === 'function') { try { N.openExternal(url); return; } catch (e) {} }
      window.open(url, '_blank');
    },

    /* ------------------------------ 取图 ------------------------------ */

    pickImages: function (source) {
      var N = native();
      if (N && typeof N.pickImages === 'function') {
        return call('pickImages', [source], 180000);
      }
      return webPick();
    },

    /* ------------------------------ OCR ------------------------------ */

    ocr: function (dataUrl) {
      var N = native();
      if (N && typeof N.ocr === 'function') {
        return call('ocr', [dataUrl], 120000);
      }
      return Promise.resolve({
        ok: false,
        error: T('离线识别需要在手机上运行'),
        text: ''
      });
    },

    /* ------------------------------ 网络 ------------------------------ */

    /** 选择一个文本文件并读回内容（OPML 导入用） */
    pickTextFile: function (mime) {
      var N = native();
      if (N && typeof N.pickTextFile === 'function') {
        return call('pickTextFile', [mime || 'text/xml'], 180000);
      }
      return Promise.resolve({ ok: false, error: 'unsupported' });
    },

    /** 把文本保存成文件（OPML 导出用） */
    saveFile: function (name, text, mime) {
      var N = native();
      if (N && typeof N.saveFile === 'function') {
        return call('saveFile', [name, text, mime || 'text/plain'], 30000);
      }
      return Promise.resolve({ ok: false, error: 'unsupported' });
    },

    /** 是否存在 WebView 后备通道 */
    hasWebFetch: function () {
      var N = native();
      return !!(N && typeof N.webFetch === 'function');
    },

    /**
     * 走 WebView 自己的网络栈抓取（与浏览器完全同一套实现）。
     * 用于 HttpURLConnection 被站点 WAF 拦截（403 / 拦截页）时的重试。
     *
     * opt.timeoutMs：这次调用最多等多久（缺省 7000ms）。
     * 必须**大于**原生看门狗（Bridge.java FETCH_WATCHDOG_MS = 6000ms），
     * 否则原生还没来得及回「超时」这条错误，这边就先放弃、连错误原因都拿不到。
     */
    webFetch: function (url, opt) {
      opt = opt || {};
      var N = native();
      var ms = opt.timeoutMs > 0 ? opt.timeoutMs : 7000;
      if (N && typeof N.webFetch === 'function') {
        return call('webFetch', [url], ms);
      }
      return Promise.resolve({ ok: false, error: 'unsupported' });
    },

    /**
     * 原生直连（HttpURLConnection）。opt.timeoutMs 控制这次调用等多久
     * ——原生侧自己会在「连接 2.5s + 读取 2s」后返回，所以这里默认给 6s 就够，
     * 长于原生最坏值即可，不必像以前那样写死 25s。
     */
    http: function (url, opt) {
      opt = opt || {};
      var N = native();
      var ms = opt.timeoutMs > 0 ? opt.timeoutMs : 6000;
      if (N && typeof N.http === 'function') {
        return call('http', [
          opt.method || 'GET',
          url,
          opt.headers ? JSON.stringify(opt.headers) : '',
          opt.body || ''
        ], ms);
      }
      return fetch(url, {
        method: opt.method || 'GET',
        headers: opt.headers || {},
        body: opt.body
      }).then(function (r) {
        return r.text().then(function (t) {
          return { ok: r.ok, status: r.status, body: t };
        });
      }).catch(function (e) {
        return { ok: false, error: String(e && e.message || e) };
      });
    }
  };

  /* 浏览器调试用的取图实现 */
  function webPick() {
    return new Promise(function (resolve) {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.multiple = true;
      input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', function () {
        var files = Array.prototype.slice.call(input.files || []);
        if (!files.length) {
          document.body.removeChild(input);
          resolve({ ok: false, error: 'cancelled' });
          return;
        }
        Promise.all(files.map(readAsDataUrl)).then(function (urls) {
          var imgs = urls.map(function (u) { return { dataUrl: u }; });
          var out = Promise.resolve(imgs);
          if (window.__WP_COMPRESS) out = Promise.all(imgs.map(window.__WP_COMPRESS));
          out.then(function (list) {
            document.body.removeChild(input);
            resolve({ ok: true, images: list });
          });
        });
      });
      input.click();
    });
  }

  function readAsDataUrl(file) {
    return new Promise(function (resolve) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { resolve(''); };
      fr.readAsDataURL(file);
    });
  }

  global.Bridge = Bridge;
})(window);
