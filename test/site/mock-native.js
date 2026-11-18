/* 模拟原生桥：严格按 Bridge.java 里 @JavascriptInterface 的真实签名实现，
 * 用来在浏览器里跑通「JS → 原生 → 回调」这条链路。
 *
 * 关键点：如果 JS 侧的参数顺序和 Java 不一致（例如 callId 放在了末尾），
 * 这里收到的第一个参数就不是 callId，回调会打到不存在的 id 上，
 * 测试会直接暴露问题——这正是之前漏掉的那类 bug。 */
(function () {
  'use strict';

  window.__mockCalls = [];
  window.__mockResolve = {};   // 可覆盖默认回包

  function record(name, args) {
    window.__mockCalls.push({ name: name, args: Array.prototype.slice.call(args) });
  }

  function reply(callId, payload) {
    // 模拟原生层：异步回填到 window.__nb
    setTimeout(function () {
      window.__nb(callId, JSON.stringify(payload));
    }, 5);
  }

  window.NativeBridge = {
    platform: function () {
      return JSON.stringify({ name: 'android-mock', version: '1.0', tts: true, ocr: true });
    },
    toast: function (msg) { record('toast', arguments); },
    vibrate: function (ms) { record('vibrate', arguments); },
    copy: function (t) { record('copy', arguments); },
    openExternal: function (u) { record('openExternal', arguments); },
    exitApp: function () { record('exitApp', arguments); },
    speak: function (text, rate) { record('speak', arguments); },
    stopSpeak: function () { record('stopSpeak', arguments); },

    /* ---- 异步方法：第一个参数必须是 callId ---- */

    pickImages: function (callId, source) {
      record('pickImages', arguments);
      var p = window.__mockResolve.pickImages ||
        { ok: true, images: [{ dataUrl: 'data:image/jpeg;base64,AAAA' }] };
      reply(callId, p);
    },

    ocr: function (callId, dataUrl) {
      record('ocr', arguments);
      var p = window.__mockResolve.ocr ||
        { ok: true, text: 'The library became a quiet place to concentrate.' };
      reply(callId, p);
    },

    pickTextFile: function (callId, mime) {
      record('pickTextFile', arguments);
      reply(callId, window.__mockResolve.pickTextFile ||
        { ok: true, name: 'feeds.opml',
          text: '<?xml version="1.0"?><opml version="2.0"><body><outline type="rss" text="A" xmlUrl="https://example.org/a.xml"/></body></opml>' });
    },

    saveFile: function (callId, name, text, mime) {
      record('saveFile', arguments);
      reply(callId, window.__mockResolve.saveFile || { ok: true, name: name, path: '下载/' + name });
    },

    webFetch: function (callId, url) {
      record('webFetch', arguments);
      var p = window.__mockResolve.webFetch ||
        { ok: true, status: 200, via: 'webview', body: '<rss><channel><item><title>W</title></item></channel></rss>' };
      reply(callId, p);
    },

    http: function (callId, method, url, headersJson, body) {
      record('http', arguments);
      var p = window.__mockResolve.http ||
        { ok: true, status: 200, body: '<rss><channel><item><title>Mock</title></item></channel></rss>' };
      reply(callId, p);
    }
  };
})();
