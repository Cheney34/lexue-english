/* 通用工具：DOM、弹层、提示、时间、文本处理 */
(function (global) {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  /** 由 HTML 字符串创建元素（取第一个元素节点） */
  function dom(html) {
    var t = document.createElement('template');
    t.innerHTML = String(html).trim();
    return t.content.firstElementChild;
  }

  function frag(html) {
    var t = document.createElement('template');
    t.innerHTML = String(html);
    return t.content;
  }

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function attr(s) { return esc(s); }

  var toastTimer = null;
  function toast(msg, ms) {
    var old = $('.toast');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var node = dom('<div class="toast">' + esc(msg) + '</div>');
    document.getElementById('layers').appendChild(node);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      if (node.parentNode) node.parentNode.removeChild(node);
    }, ms || 1800);
  }

  function haptic(ms) {
    try { if (Bridge.available()) Bridge.vibrate(ms || 12); } catch (e) {}
  }

  /* ------------------------------ 底部弹层 ------------------------------ */

  var sheetStack = [];

  function openSheet(opt) {
    opt = opt || {};
    var mask = dom('<div class="sheet-mask"></div>');
    var sheet = dom(
      '<div class="sheet">' +
        '<div class="sheet-head"><h3>' + esc(opt.title || '') + '</h3>' +
        '<button class="close" type="button">✕</button></div>' +
        '<div class="sheet-body"></div>' +
      '</div>');

    var body = $('.sheet-body', sheet);
    if (opt.body instanceof Node) body.appendChild(opt.body);
    else if (typeof opt.body === 'string') body.appendChild(frag(opt.body));

    if (opt.footer) {
      var f = opt.footer;
      if (typeof f === 'string') {
        sheet.appendChild(frag(f));          // 调用方自带 .sheet-foot 容器
      } else if (f instanceof Node) {
        sheet.appendChild(f);
      } else if (f && typeof f.length === 'number') {
        var foot = dom('<div class="sheet-foot"></div>');
        Array.prototype.slice.call(f).forEach(function (n) { foot.appendChild(n); });
        sheet.appendChild(foot);
      }
    }

    mask.appendChild(sheet);
    document.getElementById('layers').appendChild(mask);

    var handle = {
      el: sheet,
      body: body,
      setTitle: function (t) { $('.sheet-head h3', sheet).textContent = t || ''; },
      close: function () {
        if (mask.parentNode) mask.parentNode.removeChild(mask);
        var i = sheetStack.indexOf(handle);
        if (i >= 0) sheetStack.splice(i, 1);
        if (opt.onClose) opt.onClose();
      }
    };
    sheetStack.push(handle);

    $('.close', sheet).addEventListener('click', function () { handle.close(); });
    mask.addEventListener('click', function (e) {
      if (e.target === mask && opt.dismissable !== false) handle.close();
    });
    return handle;
  }

  function closeTopSheet() {
    if (!sheetStack.length) return false;
    sheetStack[sheetStack.length - 1].close();
    return true;
  }

  function confirmBox(title, msg, okText) {
    return new Promise(function (resolve) {
      var done = false;
      function finish(v) { if (!done) { done = true; resolve(v); } }
      var foot = '<div class="sheet-foot">' +
        T('<button class="btn line" data-r="0">取消</button>') +
        '<button class="btn danger" data-r="1">' + esc(okText || T('确定')) + '</button></div>';
      var h = openSheet({
        title: title,
        body: '<p style="margin:4px 0 8px;color:var(--text-2)">' + esc(msg || '') + '</p>',
        footer: foot,
        dismissable: false,
        onClose: function () { finish(false); }
      });
      h.el.addEventListener('click', function (e) {
        var b = e.target.closest('[data-r]');
        if (!b) return;
        finish(b.getAttribute('data-r') === '1');   // 先定型，再关闭
        h.close();
      });
    });
  }

  function promptBox(title, value, placeholder) {
    return new Promise(function (resolve) {
      var done = false;
      function finish(v) { if (!done) { done = true; resolve(v); } }

      var box = dom('<div><input type="text" id="pb-input" value="' + attr(value || '') +
        '" placeholder="' + attr(placeholder || '') + '"></div>');
      var h = openSheet({
        title: title,
        body: box,
        footer: T('<div class="sheet-foot"><button class="btn line" data-r="0">取消</button>') +
                T('<button class="btn" data-r="1">确定</button></div>'),
        onClose: function () { finish(null); }
      });
      var input = $('#pb-input', h.el);
      setTimeout(function () { try { input.focus(); } catch (e) {} }, 120);

      h.el.addEventListener('click', function (e) {
        var b = e.target.closest('[data-r]');
        if (!b) return;
        var ok = b.getAttribute('data-r') === '1';
        finish(ok ? input.value.trim() : null);
        h.close();
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          finish(input.value.trim());
          h.close();
        }
      });
    });
  }

  /* -------------------------------- 时间 -------------------------------- */

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function dayKey(d) {
    d = d ? new Date(d) : new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function daysBetween(a, b) {
    var d1 = new Date(a), d2 = new Date(b);
    d1.setHours(0, 0, 0, 0); d2.setHours(0, 0, 0, 0);
    return Math.round((d2 - d1) / 86400000);
  }

  function fmtAgo(ts) {
    if (!ts) return '';
    var diff = Date.now() - ts;
    if (diff < 60000) return T('刚刚');
    if (diff < 3600000) return Math.floor(diff / 60000) + T(' 分钟前');
    if (diff < 86400000) return Math.floor(diff / 3600000) + T(' 小时前');
    var d = Math.floor(diff / 86400000);
    if (d < 30) return d + T(' 天前');
    var dt = new Date(ts);
    return (dt.getMonth() + 1) + T('月') + dt.getDate() + T('日');
  }

  function uid(prefix) {
    return (prefix || 'i') + '_' + Date.now().toString(36) +
      Math.random().toString(36).slice(2, 7);
  }

  function debounce(fn, ms) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms || 220);
    };
  }

  /* ------------------------------ 文本处理 ------------------------------ */

  var WORD_RE = /[A-Za-z][A-Za-z'’\-]*/g;

  /** 从任意文本中抽取英文单词（去重、去停用词、保留原始大小写顺序） */
  function extractWords(text, opt) {
    opt = opt || {};
    if (!text) return [];
    var out = [], seen = {};
    var m;
    WORD_RE.lastIndex = 0;
    while ((m = WORD_RE.exec(text)) !== null) {
      var raw = m[0].replace(/[’]/g, "'");
      var w = raw.replace(/^['\-]+|['\-]+$/g, '');
      if (!w) continue;
      var low = w.toLowerCase();
      if (low.length < (opt.minLen || 2) && !(opt.allowSingle)) continue;
      if (opt.skipStop !== false && STOP[low] === 1) continue;
      if (seen[low]) continue;
      seen[low] = 1;
      out.push(low);
    }
    return out;
  }

  /** 词频极高、对学习无价值的词，避免污染 OCR 结果 */
  var STOP = {};
  ('the a an and or but if of to in on at by for with from as is are was were be been being ' +
   'am do does did done have has had having will would shall should can could may might must ' +
   'i you he she it we they me him her us them my your his its our their this that these those ' +
   'there here what which who whom whose when where why how not no nor so than then too very ' +
   'just also only own same such more most other some any each few both all one two three ' +
   'about into over after before between under above again further once out up down off ' +
   's t re ve ll d m n y o')
    .split(' ').forEach(function (w) { if (w) STOP[w] = 1; });

  function highlight(text, q) {
    if (!q) return esc(text);
    var idx = String(text).toLowerCase().indexOf(String(q).toLowerCase());
    if (idx < 0) return esc(text);
    return esc(text.slice(0, idx)) + '<b>' + esc(text.slice(idx, idx + q.length)) + '</b>' +
      esc(text.slice(idx + q.length));
  }

  function bytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function raf() {
    return new Promise(function (r) { requestAnimationFrame(function () { r(); }); });
  }

  /** 生成随机 id（用于 IndexedDB 主键） */
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  global.U = {
    $: $, $$: $$, dom: dom, frag: frag, esc: esc, attr: attr,
    toast: toast, haptic: haptic,
    openSheet: openSheet, closeTopSheet: closeTopSheet,
    confirmBox: confirmBox, promptBox: promptBox,
    dayKey: dayKey, daysBetween: daysBetween, fmtAgo: fmtAgo,
    uid: uid, debounce: debounce,
    extractWords: extractWords, STOP: STOP, highlight: highlight,
    bytes: bytes, sleep: sleep, raf: raf, clone: clone
  };
})(window);
