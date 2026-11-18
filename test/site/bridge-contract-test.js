/* 桥接契约运行时测试：验证 JS 发起调用时的参数顺序与原生签名一致，
 * 且 callId 能正确回填 Promise。 */
(function () {
  'use strict';

  var results = [];
  var errors = [];

  window.addEventListener('error', function (e) {
    errors.push('ERROR ' + (e.message || '') + ' @' + (e.lineno || 0));
  });
  window.addEventListener('unhandledrejection', function (e) {
    errors.push('REJECT ' + ((e.reason && (e.reason.stack || e.reason.message)) || e.reason));
  });

  function isCallId(v) {
    return typeof v === 'string' && v.length > 0 && !/^[A-Z]+$/.test(v);
  }

  function lastCall(name) {
    for (var i = window.__mockCalls.length - 1; i >= 0; i--) {
      if (window.__mockCalls[i].name === name) return window.__mockCalls[i];
    }
    return null;
  }

  function check(name, fn) {
    return Promise.resolve().then(fn).then(function (d) {
      results.push({ ok: true, name: name, detail: d });
    }).catch(function (e) {
      results.push({ ok: false, name: name, detail: String((e && e.message) || e) });
    });
  }

  function assert(cond, msg) {
    if (!cond) throw new Error(msg);
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /** 给桥接调用加超时：如果 callId 错位导致回调打空，这里会快速失败而不是干等 */
  function guard(pr, label) {
    return Promise.race([pr, new Promise(function (_, rej) {
      setTimeout(function () {
        rej(new Error('超时未回填——callId 可能错位或被丢弃（' + label + '）'));
      }, 3000);
    })]);
  }

  function report() {
    var out = document.createElement('pre');
    out.id = 'TESTOUT';
    out.textContent = '@@RESULT@@' + JSON.stringify({ errors: errors, results: results });
    document.body.appendChild(out);
  }

  Promise.resolve()

    /* ---- http：callId 必须是第一个参数 ---- */
    .then(function () {
      return check('http 参数顺序：callId 在前', function () {
        window.__mockCalls.length = 0;
        return guard(Bridge.http('https://example.com/a.xml'), 'http').then(function (r) {
          var c = lastCall('http');
          assert(c, '原生侧没有收到 http 调用');
          var a = c.args;
          assert(a.length === 5, '参数个数应为 5，实际 ' + a.length);
          assert(isCallId(a[0]), '第 1 个参数应是 callId，实际收到 ' + JSON.stringify(a[0]));
          assert(a[1] === 'GET', '第 2 个参数应是 method=GET，实际 ' + JSON.stringify(a[1]));
          assert(a[2] === 'https://example.com/a.xml',
            '第 3 个参数应是 url，实际 ' + JSON.stringify(a[2]));
          assert(r.ok === true && r.status === 200, 'Promise 未被正确回填：' + JSON.stringify(r));
          return 'callId=' + a[0] + ' | GET ' + a[2].slice(0, 30) + ' | 回填 ok';
        });
      });
    })

    /* ---- http：method / headers / body 也要对位 ---- */
    .then(function () {
      return check('http 参数顺序：method/headers/body 对位', function () {
        window.__mockCalls.length = 0;
        return guard(Bridge.http('https://example.com/post', {
          method: 'POST', headers: { 'X-A': '1' }, body: 'hello'
        }), 'http-post').then(function () {
          var a = lastCall('http').args;
          assert(a[1] === 'POST', 'method 应为 POST，实际 ' + a[1]);
          assert(a[2] === 'https://example.com/post', 'url 错位，实际 ' + a[2]);
          assert(a[3] === '{"X-A":"1"}', 'headersJson 应为 JSON 串，实际 ' + a[3]);
          assert(a[4] === 'hello', 'body 错位，实际 ' + a[4]);
          return 'POST ' + a[2].slice(0, 26) + ' headers=' + a[3] + ' body=' + a[4];
        });
      });
    })

    /* ---- ocr ---- */
    .then(function () {
      return check('ocr 参数顺序：callId 在前', function () {
        window.__mockCalls.length = 0;
        return guard(Bridge.ocr('data:image/jpeg;base64,ZZZ'), 'ocr').then(function (r) {
          var a = lastCall('ocr').args;
          assert(a.length === 2, '参数个数应为 2');
          assert(isCallId(a[0]), '第 1 个参数应是 callId，实际 ' + JSON.stringify(a[0]));
          assert(a[1] === 'data:image/jpeg;base64,ZZZ', '图片数据错位，实际 ' + String(a[1]).slice(0, 24));
          assert(r.ok && /quiet place/.test(r.text), 'OCR 结果未回填');
          return 'callId=' + a[0] + ' | 识别文本已回填';
        });
      });
    })

    /* ---- pickImages ---- */
    .then(function () {
      return check('pickImages 参数顺序：callId 在前', function () {
        window.__mockCalls.length = 0;
        return guard(Bridge.pickImages('camera'), 'pickImages').then(function (r) {
          var a = lastCall('pickImages').args;
          assert(a.length === 2, '参数个数应为 2');
          assert(isCallId(a[0]), '第 1 个参数应是 callId，实际 ' + JSON.stringify(a[0]));
          assert(a[1] === 'camera', 'source 错位，实际 ' + JSON.stringify(a[1]));
          assert(r.ok && r.images.length === 1, '取图结果未回填');
          return 'callId=' + a[0] + ' | source=camera | 1 张图';
        });
      });
    })

    /* ---- pickTextFile / saveFile：OPML 导入导出 ---- */
    .then(function () {
      return check('pickTextFile 参数顺序：callId 在前', function () {
        window.__mockCalls.length = 0;
        return guard(Bridge.pickTextFile('text/xml'), 'pickTextFile').then(function (r) {
          var a = lastCall('pickTextFile').args;
          assert(a.length === 2, '参数个数应为 2');
          assert(isCallId(a[0]), '第 1 个参数应是 callId，实际 ' + JSON.stringify(a[0]));
          assert(a[1] === 'text/xml', 'mime 错位，实际 ' + JSON.stringify(a[1]));
          assert(r.ok === true && /opml/.test(r.text), '文件内容未回填');
          return 'callId=' + a[0] + ' | mime=' + a[1] + ' | bytes=' + r.text.length;
        });
      });
    })
    .then(function () {
      return check('saveFile 参数顺序：callId 在前', function () {
        window.__mockCalls.length = 0;
        return guard(Bridge.saveFile('x.opml', '<opml/>', 'text/xml'), 'saveFile').then(function (r) {
          var a = lastCall('saveFile').args;
          assert(a.length === 4, '参数个数应为 4');
          assert(isCallId(a[0]), '第 1 个参数应是 callId');
          assert(a[1] === 'x.opml', '文件名错位，实际 ' + JSON.stringify(a[1]));
          assert(a[2] === '<opml/>', '内容错位');
          assert(a[3] === 'text/xml', 'mime 错位');
          return 'callId=' + a[0] + ' | ' + a[1] + ' | ' + a[3] + ' | ok=' + r.ok;
        });
      });
    })

    /* ---- webFetch：浏览器引擎后备通道 ---- */
    .then(function () {
      return check('webFetch 参数顺序：callId 在前', function () {
        window.__mockCalls.length = 0;
        assert(Bridge.hasWebFetch() === true, 'hasWebFetch 应识别到原生实现');
        return guard(Bridge.webFetch('https://example.com/rss.xml'), 'webFetch').then(function (r) {
          var a = lastCall('webFetch').args;
          assert(a.length === 2, '参数个数应为 2');
          assert(isCallId(a[0]), '第 1 个参数应是 callId，实际 ' + JSON.stringify(a[0]));
          assert(a[1] === 'https://example.com/rss.xml', 'url 错位，实际 ' + JSON.stringify(a[1]));
          assert(r.ok === true && r.via === 'webview', 'webFetch 结果未回填');
          return 'callId=' + a[0] + ' | via=webview';
        });
      });
    })

    /* ---- 错误路径：原生返回失败也要能回填 ---- */
    .then(function () {
      return check('原生返回失败时能正确回填', function () {
        window.__mockResolve.http = { ok: false, error: '域名无法解析' };
        window.__mockCalls.length = 0;
        return guard(Bridge.http('https://bad.invalid/x'), 'http-fail').then(function (r) {
          delete window.__mockResolve.http;
          assert(r.ok === false && /域名无法解析/.test(r.error),
            '失败结果未回填：' + JSON.stringify(r));
          return '失败路径回填：' + r.error;
        });
      });
    })

    /* ---- 并发调用：callId 不会串台 ---- */
    .then(function () {
      return check('并发调用互不串台', function () {
        window.__mockCalls.length = 0;
        return guard(Promise.all([
          Bridge.ocr('data:img:1'),
          Bridge.pickImages('gallery'),
          Bridge.http('https://example.com/c')
        ]), 'concurrent').then(function (rs) {
          assert(rs[0].text && /quiet/.test(rs[0].text), 'ocr 结果错位');
          assert(rs[1].images && rs[1].images.length === 1, 'pickImages 结果错位');
          assert(rs[2].status === 200, 'http 结果错位');
          var ids = ['ocr', 'pickImages', 'http'].map(function (n) {
            return lastCall(n).args[0];
          });
          var uniq = {};
          ids.forEach(function (x) { uniq[x] = 1; });
          assert(Object.keys(uniq).length === 3, 'callId 出现重复：' + ids.join(','));
          return '三个并发请求 callId 唯一：' + ids.join(' / ');
        });
      });
    })

    .then(function () { return sleep(120); })
    .then(report)
    .catch(function (e) {
      errors.push('FATAL ' + (e && e.message));
      report();
    });
})();
