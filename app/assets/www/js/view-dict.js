/* 词书选择与词典搜索 */
(function (global) {
  'use strict';

  /* ---------------- 发音引擎状态（设置页用） ----------------
   * 引擎真实情况只有原生知道（是否可用 / 用的哪个语言 / 为什么没声音），
   * 这里通过 Bridge.ttsInfo() 取回并翻译成一句人话。
   */

  function ttsMode() {
    return Store.settings.ttsMode === 'system' ? 'system' : 'auto';
  }

  function ttsModeLabel() {
    return I18N.L(ttsMode() === 'system' ? 'ttsSystem' : 'ttsAuto');
  }

  function ttsStatusText() {
    var info = null;
    try { info = Bridge.ttsInfo(); } catch (e) { info = null; }
    if (!info) return I18N.L('ttsAuto');
    if (!info.available) return info.note || I18N.L('ttsHint');
    return (info.language || '') + (info.note ? ' · ' + info.note : '');
  }

  /* =============================== 词书 =============================== */

  function bookProgress(bookId) {
    return Promise.all([Store.listCards()]).then(function (r) {
      var cards = r[0] || [];
      var learned = 0, mastered = 0;
      cards.forEach(function (c) {
        var e = Dict.lemma(c.word);
        if (!e || !Dict.inBook(e, bookId)) return;
        learned++;
        if (c.interval >= 21) mastered++;
      });
      var total = Dict.bookCount(bookId);
      return { total: total, learned: learned, mastered: mastered };
    });
  }

  function renderBooks(el) {
    var cur = Dict.bookById(Store.settings.bookId);
    bookProgress(cur.id).then(function (p) {
      var pct = p.total ? Math.round(p.learned / p.total * 100) : 0;
      el.appendChild(U.dom(
        '<div class="card" style="background:linear-gradient(135deg,#3d5a80,#24384f);color:#fff">' +
          '<div class="row between">' +
            T('<div><div class="xsmall" style="opacity:.8">当前目标词书</div>') +
            '<div style="font-size:19px;font-weight:600;margin-top:2px">' + U.esc(cur.name) + '</div></div>' +
            '<div style="text-align:right"><div style="font-size:22px;font-weight:700">' + pct + '%</div>' +
            '<div class="xsmall" style="opacity:.8">' + p.learned + ' / ' + p.total + '</div></div>' +
          '</div>' +
          '<div class="progress mt12" style="background:rgba(255,255,255,.22)"><i style="width:' + pct + '%"></i></div>' +
          T('<div class="xsmall mt8" style="opacity:.85">已掌握 ') + p.mastered + T(' 词（复习间隔 ≥ 21 天视为掌握）</div>') +
        '</div>'));

      var box = U.dom('<div></div>');
      Dict.getBooks().forEach(function (b) {
        var card = U.dom(
          '<div class="card tight" data-b="' + b.id + '">' +
            '<div class="row between">' +
              '<div class="grow"><div class="row">' +
                '<span class="bold">' + U.esc(b.name) + '</span>' +
                (b.id === Store.settings.bookId ? T('<span class="chip brand" style="margin-left:8px">当前</span>') : '') +
                (b.custom ? '<span class="chip" style="margin-left:8px">' + U.esc(I18N.L('customBook')) + '</span>' : '') +
              '</div>' +
              '<div class="muted xsmall mt8">' + U.esc(b.desc) + '</div></div>' +
              (b.custom
                ? '<button class="btn sm ghost" data-del="' + U.attr(b.id) + '">' + U.esc(I18N.L('delBook')) + '</button>'
                : '<span class="li-arrow">›</span>') +
            '</div>' +
            '<div class="xsmall muted mt8" id="bp-' + b.id + T('">共 ') + b.count + T(' 词</div>') +
          '</div>');
        box.appendChild(card);
        bookProgress(b.id).then(function (p2) {
          var e = document.getElementById('bp-' + b.id);
          if (!e) return;
          var pp = p2.total ? Math.round(p2.learned / p2.total * 100) : 0;
          e.innerHTML = T('共 ') + p2.total + T(' 词 · 已学 ') + p2.learned + T(' · 掌握 ') + p2.mastered +
            '　<span class="bp-pct">' + pp + '%</span>';
        });
      });
      el.appendChild(box);
      box.addEventListener('click', function (e) {
        var del = e.target.closest('[data-del]');
        if (del) { doDeleteBook(del.getAttribute('data-del')); return; }
        var c = e.target.closest('[data-b]');
        if (c) openBook(c.getAttribute('data-b'));
      });

      /* 导入词书：词书数据不进 APK、不进仓库，只落在本机 IndexedDB。
         转换脚本见 tools/xlsx_to_book.ps1，输出的 JSON 直接在这里导入。 */
      var impBox = U.dom(
        '<button class="btn block ghost mt8" data-a="importbook">＋ ' + U.esc(I18N.L('importBook')) + '</button>' +
        '<div class="muted xsmall mt8">' + U.esc(I18N.L('importBookHint')) + '</div>');
      el.appendChild(impBox);
      impBox.addEventListener('click', function (e) {
        if (e.target.closest('[data-a="importbook"]')) doImportBook();
      });

      el.appendChild(U.dom(T('<div class="section-title">学习设置</div>')));
      var setBox = U.dom('<div class="card"></div>');
      setBox.innerHTML =
        row(T('自动朗读单词'), T('查词 / 复习时自动发音'), 'autoSpeak') +
        row(T('复习时显示图片线索'), T('用地点桩照片提示回忆'), 'showCue') +
        row(T('允许联网补充查询'), T('离线词库查不到时联网'), 'onlineDict') +
        row(T('外刊每日自动更新'), T('每天首次进入「阅读」时静默刷新'), 'autoFeed') +
        T('<div class="list-item"><div class="li-main"><div class="li-title">外刊缓存</div>') +
        '<div class="li-sub" id="set-feed">—</div></div>' +
        T('<button class="btn sm ghost" data-a="feedrefresh">更新</button></div>') +
        T('<div class="list-item"><div class="li-main"><div class="li-title">发音语速</div>') +
        T('<div class="li-sub">当前 ') + Store.settings.ttsRate.toFixed(1) + T(' 倍</div></div>') +
        '<input type="range" id="set-rate" min="0.6" max="1.4" step="0.1" value="' +
        Store.settings.ttsRate + '" style="width:120px"></div>' +
        /* 发音引擎：点按钮在「自动（优先英语）」和「系统默认引擎」之间切换。
         * 有些手机上系统只装了中文语音，此时自动模式会没声音，切到系统默认
         * 至少能发声；真正的引擎状态显示在副标题里。 */
        T('<div class="list-item"><div class="li-main"><div class="li-title">') +
          U.esc(I18N.L('ttsEngine')) + T('</div>') +
          T('<div class="li-sub" id="set-tts-note">') + U.esc(ttsStatusText()) + T('</div></div>') +
          T('<button class="btn sm ghost" data-a="ttsmode">') + U.esc(ttsModeLabel()) + T('</button></div>') +
        T('<div class="list-item"><div class="li-main"><div class="li-title">') +
          U.esc(I18N.L('ttsOpen')) + T('</div>') +
          T('<div class="li-sub">') + U.esc(I18N.L('ttsHint')) + T('</div></div>') +
          T('<button class="btn sm ghost" data-a="ttsopen">前往 ›</button></div>') +
        T('<div class="list-item"><div class="li-main"><div class="li-title">每日新词上限</div>') +
        T('<div class="li-sub">进入复习队列的新词数量</div></div>') +
        '<input type="number" id="set-new" value="' + Store.settings.dailyNew +
        '" style="width:76px;text-align:center"></div>' +
        '<div class="row mt12" style="gap:8px">' +
          T('<button class="btn sm ghost grow" data-a="export">导出数据</button>') +
          T('<button class="btn sm ghost grow" data-a="import">导入数据</button>') +
        '</div>' +
        T('<button class="btn sm line block mt8" data-a="reset">清空全部学习数据</button>');
      el.appendChild(setBox);

      // ---- 关于：版本号直接来自 APK 内的 version.json，和装的是哪个包严格一致 ----
      el.appendChild(U.dom(T('<div class="section-title">关于</div>')));
      var aboutBox = U.dom('<div class="card"></div>');
      aboutBox.innerHTML =
        '<div class="list-item"><div class="li-main">' +
          '<div class="li-title" id="about-ver">' + U.esc(App.versionText()) + '</div>' +
          T('<div class="li-sub">离线词库 ') + Dict.wordCount() +
            T(' 词 · 识别引擎 Tesseract · ') +
            U.esc(Bridge.platform().release || '') + '</div>' +
        '</div>' +
        T('<button class="btn sm ghost" data-a="changelog">更新日志</button></div>') +
        /* 诊断信息：白屏 / 转圈 / 订阅源拉不到时，让用户自己就能把现场拷出来 */
        T('<div class="list-item"><div class="li-main"><div class="li-title">') +
          U.esc(I18N.L('diagnostics')) + T('</div>') +
          T('<div class="li-sub">') + U.esc(I18N.L('diagHint')) + T('</div></div>') +
          T('<button class="btn sm ghost" data-a="diag">查看 ›</button></div>') +
        T('<div class="muted xsmall mt8">本次构建日期 ') +
          U.esc((App.version && App.version.buildDate) || '—') + '</div>';
      el.appendChild(aboutBox);
      aboutBox.addEventListener('click', function (e) {
        if (e.target.closest('[data-a="changelog"]')) App.changelogSheet();
        else if (e.target.closest('[data-a="diag"]')) {
          if (global.Diag) global.Diag.open();
        }
      });

      function row(title, sub, key) {
        return '<div class="list-item"><div class="li-main"><div class="li-title">' + title + '</div>' +
          '<div class="li-sub">' + sub + '</div></div>' +
          '<button class="switch' + (Store.settings[key] ? ' on' : '') + '" data-sw="' + key + '"><i></i></button></div>';
      }

      var feedRow = U.$('#set-feed', setBox);
      function paintFeed() {
        if (!feedRow || !global.Read) return;
        var st = Read.feedStats();
        feedRow.textContent = st.count
          ? st.count + T(' 条 · ') + (st.stale ? T('已过期，可更新') : (U.fmtAgo(st.fetchedAt) + T('更新')))
          : T('暂无缓存');
      }
      paintFeed();

      setBox.addEventListener('click', function (e) {
        var sw = e.target.closest('[data-sw]');
        if (sw) {
          var k = sw.getAttribute('data-sw');
          Store.settings[k] = !Store.settings[k];
          Store.saveSettings();
          sw.classList[Store.settings[k] ? 'add' : 'remove']('on');
          return;
        }
        var b = e.target.closest('[data-a]');
        if (!b) return;
        var a = b.getAttribute('data-a');
        if (a === 'export') doExport();
        else if (a === 'import') doImport();
        else if (a === 'ttsmode') {
          var nextMode = ttsMode() === 'auto' ? 'system' : 'auto';
          Store.settings.ttsMode = nextMode;
          Store.saveSettings();
          try { Bridge.setTtsMode(nextMode); } catch (e2) {}
          b.textContent = ttsModeLabel();
          var ttsNoteEl = U.$('#set-tts-note', setBox);
          if (ttsNoteEl) ttsNoteEl.textContent = ttsStatusText();
          U.toast(ttsModeLabel());
        }
        else if (a === 'ttsopen') {
          if (!Bridge.openTtsSettings()) U.toast(T('请在系统设置里找到「文字转语音」'));
        }
        else if (a === 'feedrefresh') {
          if (!global.Read) return;
          U.toast(T('正在更新外刊…'));
          Read.ensureFeeds(true).then(function () {
            paintFeed();
            U.toast(T('外刊已更新'));
          });
        }
        else if (a === 'reset') {
          U.confirmBox(T('清空学习数据'), T('单词卡片、图片、宫殿都会删除，且无法恢复。确定继续？'), T('清空'))
            .then(function (ok) {
              if (!ok) return;
              Store.clearAll().then(function () {
                U.toast(T('已清空'));
                App.updateDueDot();
                App.refresh();
              });
            });
        }
      });
      var rate = U.$('#set-rate', setBox);
      if (rate) rate.addEventListener('change', function () {
        Store.settings.ttsRate = parseFloat(rate.value) || 1;
        Store.saveSettings();
        U.toast(T('语速 ') + Store.settings.ttsRate.toFixed(1) + 'x');
      });
      var nw = U.$('#set-new', setBox);
      if (nw) nw.addEventListener('change', function () {
        Store.settings.dailyNew = Math.max(0, Math.min(200, parseInt(nw.value, 10) || 0));
        Store.saveSettings();
      });
    });
  }

  /* ---------------------- 导入 / 删除自定义词书 ---------------------- */

  var BOOK_COLORS = ['#3d5a80', '#4c956c', '#2a9d8f', '#5c6bc0', '#7b5ea7',
    '#c9803a', '#b5651d', '#8d5a5a', '#2f6f4e', '#6b7280'];

  function newBookId() {
    return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /** 容忍三种写法：{kind:'wp-books',books:[…]} / {kind:'wp-book',name,words:[…]} / 裸数组 */
  function normImportedBooks(o) {
    var raw = [];
    if (Array.isArray(o)) raw = o;
    else if (o && Array.isArray(o.books)) raw = o.books;
    else if (o && Array.isArray(o.words)) raw = [o];
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var b = raw[i] || {};
      var words = [];
      var src = b.words || b.list || [];
      for (var k = 0; k < src.length && words.length < 20000; k++) {
        var w = src[k];
        if (Array.isArray(w)) {
          var wd = String(w[0] || '').trim();
          if (!wd) continue;
          words.push([wd, String(w[1] || '').trim(), String(w[2] || '').trim()]);
        } else if (w && typeof w === 'object') {
          var wd2 = String(w.word || w.w || w.text || '').trim();
          if (!wd2) continue;
          words.push([wd2, String(w.phonetic || w.p || '').trim(),
            String(w.trans || w.def || w.definition || w.t || '').trim()]);
        }
      }
      if (!words.length) continue;
      var name = String(b.name || b.title || '').trim() || I18N.L('unnameBook');
      out.push({
        id: newBookId(),
        name: name.slice(0, 40),
        desc: String(b.desc || '').trim().slice(0, 80) ||
          (I18N.L('customDesc') + words.length + I18N.L('wordUnit')),
        color: b.color || BOOK_COLORS[out.length % BOOK_COLORS.length],
        words: words
      });
    }
    return out;
  }

  function doImportBook() {
    U.toast(I18N.L('importOpening'));
    Bridge.pickTextFile('*/*').then(function (r) {
      if (!r) { U.toast(I18N.L('readFailed')); return; }
      if (!r.ok) {
        if (r.error === 'cancelled') return;
        U.toast(I18N.L('importFailed') + (r.error || '?'));
        return;
      }
      var parsed;
      try { parsed = JSON.parse(r.text); }
      catch (e) { U.toast(I18N.L('importBadJson')); return; }
      var list = normImportedBooks(parsed);
      if (!list.length) { U.toast(I18N.L('importEmpty')); return; }

      Store.getMeta('cbooks').then(function (cur) {
        var books = (cur || []).slice();
        var n = 0;
        list.forEach(function (nb) {
          var at = -1;
          for (var i = 0; i < books.length; i++) if (books[i].name === nb.name) { at = i; break; }
          if (at >= 0) { nb.id = books[at].id; books[at] = nb; } else books.push(nb);
          n++;
        });
        return Store.putMeta('cbooks', books).then(function () {
          Dict.setCustomBooks(books);
          U.toast(I18N.L('importDone') + n + I18N.L('importDoneEnd'));
          App.refresh();
        });
      }, function () {
        U.toast(I18N.L('noStore'));
      });
    });
  }

  function doDeleteBook(id) {
    var b = Dict.bookById(id);
    U.confirmBox(I18N.L('delBookTitle'),
      I18N.L('delBookBody') + b.name + I18N.L('delBookBody2'), I18N.L('delBook'))
      .then(function (ok) {
        if (!ok) return;
        Store.getMeta('cbooks').then(function (cur) {
          var books = (cur || []).filter(function (x) { return x.id !== id; });
          return Store.putMeta('cbooks', books).then(function () {
            Dict.setCustomBooks(books);
            if (Store.settings.bookId === id) {
              Store.settings.bookId = 'core';
              Store.saveSettings();
            }
            U.toast(I18N.L('deletedOk'));
            App.refresh();
          });
        });
      });
  }

  function doExport() {
    Store.exportAll().then(function (json) {
      var name = 'wordpalace-backup-' + U.dayKey() + '.json';
      try {
        var blob = new Blob([json], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
        U.toast(T('已导出 ') + name);
      } catch (e) {
        Bridge.copy(json);
        U.toast(T('已复制备份数据到剪贴板'));
      }
    });
  }

  function doImport() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        try {
          Store.importAll(fr.result).then(function () {
            U.toast(T('导入完成'));
            App.updateDueDot();
            App.refresh();
          });
        } catch (e) {
          U.toast(T('导入失败：') + e.message);
        }
      };
      fr.readAsText(f);
    });
    input.click();
  }

  function openBook(bid) {
    var b = Dict.bookById(bid);
    App.push(function (el) {
      App.setBar(b.name, T('共 ') + b.count + T(' 词'), [
        { key: 'set', label: T('设为目标'), onClick: setTarget }
      ]);

      var entries = Dict.bookEntries(bid);
      var shown = 0;
      var pageSize = 40;

      bookProgress(bid).then(function (p) {
        var pct = p.total ? Math.round(p.learned / p.total * 100) : 0;
        var head = U.dom(
          '<div class="card">' +
            '<div class="small muted">' + U.esc(b.desc) + '</div>' +
            '<div class="progress mt12"><i style="width:' + pct + '%"></i></div>' +
            T('<div class="row between mt8"><span class="xsmall muted">已学 ') + p.learned +
            ' / ' + p.total + '（' + pct + '%）</span>' +
            T('<span class="xsmall muted">掌握 ') + p.mastered + '</span></div>' +
            '<div class="row mt12" style="gap:8px">' +
              T('<button class="btn grow" data-a="start">背这本词书</button>') +
              T('<button class="btn grow ghost" data-a="set">设为目标</button>') +
            '</div>' +
          '</div>');

        var listBox = U.dom('<div class="card" id="bk-list"></div>');
        var moreBtn = U.dom(T('<button class="btn block ghost" data-a="more">加载更多</button>'));

        function paint() {
          var slice = entries.slice(0, shown);
          listBox.innerHTML = T('<div class="muted small mb8">词表预览（按词频排序）</div>') +
            slice.map(function (e) {
              return '<div class="word-item" data-w="' + U.attr(e.word) + '">' +
                '<div class="grow" style="min-width:0"><div class="w">' + U.esc(e.word) +
                ' <span class="muted xsmall">' + U.esc(e.phonetic || '') + '</span></div>' +
                '<div class="tr ellipsis">' + U.esc(e.trans) + '</div></div>' +
                '<button class="btn sm ghost" data-say="' + U.attr(e.word) + '">🔊</button></div>';
            }).join('');
          if (shown >= entries.length) moreBtn.style.display = 'none';
          else moreBtn.textContent = T('加载更多（还有 ') + (entries.length - shown) + T(' 词）');
        }

        shown = Math.min(pageSize, entries.length);
        paint();

        el.appendChild(head);
        el.appendChild(listBox);
        el.appendChild(moreBtn);

        el.addEventListener('click', function (e) {
          var say = e.target.closest('[data-say]');
          if (say) { Bridge.speak(say.getAttribute('data-say')); return; }
          var b2 = e.target.closest('[data-a]');
          if (b2) {
            var a = b2.getAttribute('data-a');
            if (a === 'more') { shown += pageSize; paint(); }
            else if (a === 'start') startBook(bid, entries);
            else if (a === 'set') setTarget();
            return;
          }
          var wi = e.target.closest('[data-w]');
          if (wi) UIKit.wordSheet(wi.getAttribute('data-w'), { source: 'book' });
        });
      });

      function setTarget() {
        Store.settings.bookId = bid;
        Store.saveSettings();
        U.toast(T('已设为当前词书：') + b.name);
      }
    });
  }

  function startBook(bid, entries) {
    var cmapReady = Store.cardMap();
    cmapReady.then(function (cmap) {
      var todo = entries.filter(function (e) { return !cmap[e.word]; })
        .map(function (e) { return e.word; });
      if (!todo.length) { U.toast(T('这本词书已经全部进过生词本了')); return; }
      var n = Math.min(todo.length, Store.settings.dailyNew || 20);
      U.confirmBox(T('开始背词'), T('这本词书还有 ') + todo.length + T(' 个词未学习。') +
        T('本次将按词频取前 ') + n + T(' 个进入复习队列。'), T('开始')).then(function (ok) {
        if (!ok) return;
        var picked = todo.slice(0, n);
        Promise.all(picked.map(function (w) {
          return UIKit.addWord(w, { source: 'book' });
        })).then(function () {
          App.updateDueDot();
          Review.startSession({ words: picked, title: Dict.bookById(bid).name + T(' 新词') });
        });
      });
    });
  }

  /* =============================== 词典 =============================== */

  var dstate = { q: '', results: null, online: null, busy: false, remembered: [] };

  function renderDict(el) {
    var box = U.dom(
      '<div>' +
        T('<input type="text" id="d-q" placeholder="输入英文或中文，例如 abandon / 放弃" ') +
        'autocomplete="off" autocorrect="off" spellcheck="false">' +
        '<div class="row wrap mt8">' +
          T('<span class="chip">当前词书：') + U.esc(Dict.bookById(Store.settings.bookId).name) + '</span>' +
          T('<span class="chip">离线 ') + Dict.wordCount() + T(' 词</span>') +
        '</div>' +
        '<div id="d-out" class="mt12"></div>' +
      '</div>');
    el.appendChild(box);

    var input = U.$('#d-q', box);
    var out = U.$('#d-out', box);

    function paint() {
      var q = input.value.trim();
      dstate.q = q;
      if (!q) {
        out.innerHTML = '';
        if (Store.settings.remembered && Store.settings.remembered.length) {
          // 保留旧实现兼容，无数据时忽略
        }
        out.appendChild(U.dom(
          T('<div class="card"><div class="muted small mb8">试试这些词</div>') +
          '<div class="row wrap">' +
          ['abandon', 'ability', 'environment', 'purchase', 'schedule', 'imagine']
            .map(function (w) { return '<span class="chip tap brand" data-w="' + w + '">' + w + '</span>'; })
            .join('') + '</div></div>'));
        out.appendChild(U.dom(
          T('<div class="notice">词典为离线优先：先查内置 ') + Dict.wordCount() +
          T(' 词词库，未收录时再联网补充。点击结果可查看音标、释义、所属词书并加入生词本。</div>')));
        return;
      }
      var list = Dict.search(q, { limit: 50 });
      if (!list.length) {
        out.innerHTML = T('<div class="card"><div class="small">离线词库未收录「') + U.esc(q) + '」</div>' +
          T('<button class="btn block ghost mt12" data-online="1">联网查询这个词</button>') +
          T('<div class="muted xsmall mt8">联网查询会调用公开词典接口（有道 / dictionaryapi.dev）</div></div>');
        if (Store.settings.onlineDict && /^[a-zA-Z'\-]{2,}$/.test(q)) doOnline(q);
        return;
      }
      out.innerHTML = T('<div class="muted small mb8">找到 ') + list.length + T(' 条</div>') +
        list.map(function (e) {
          var tags = Dict.tagNames(e.tag);
          return '<div class="list-item" data-w="' + U.attr(e.word) + '">' +
            '<div class="li-main"><div class="li-title">' + U.highlight(e.word, q) +
            (e.phonetic ? ' <span class="muted xsmall">[' + U.esc(e.phonetic) + ']</span>' : '') + '</div>' +
            '<div class="li-sub ellipsis">' + U.esc(e.trans) + '</div>' +
            (tags.length ? '<div class="mt8">' + tags.map(function (t) {
              return '<span class="tag">' + t + '</span>';
            }).join('') + '</div>' : '') +
            '</div><span class="li-arrow">›</span></div>';
        }).join('');
    }

    function doOnline(q) {
      var holder = U.dom(T('<div class="loading-box"><span class="spinner"></span> 联网查询中…</div>'));
      out.appendChild(holder);
      Dict.online(q).then(function (r) {
        if (!holder.parentNode) return;
        if (!r.ok) {
          holder.innerHTML = '<div class="notice err">' + U.esc(r.error || T('未查到')) + '</div>';
          return;
        }
        holder.innerHTML = '<div class="card" style="border-left:3px solid var(--ok)">' +
          T('<div class="row between"><span class="muted xsmall">联网结果</span>') +
          (r.audio ? '<button class="btn sm ghost" data-audio="' + U.attr(r.audio) + T('">🔊 真人发音</button>') : '') +
          '</div>' +
          (r.via && r.via !== String(q || '').toLowerCase()
            ? '<div class="xsmall muted mt8">' + U.esc(I18N.L('onlineVia') + r.via) + '</div>' : '') +
          (r.phonetic ? '<div class="small muted mt8">[' + U.esc(r.phonetic) + ']</div>' : '') +
          (r.trans ? '<div class="mt8" style="font-size:15.5px">' + U.esc(r.trans) + '</div>' : '') +
          (r.meanings || []).map(function (m) {
            return '<div class="mt8"><span class="tag">' + U.esc(m.pos) + '</span> ' +
              '<span class="small" style="color:var(--text-2)">' + U.esc((m.defs || []).join(' / ')) + '</span></div>';
          }).join('') +
          '<button class="btn block ghost mt12" data-w="' + U.attr(q) + T('">加入生词本</button>') +
          '</div>';
      });
    }

    input.addEventListener('input', U.debounce(paint, 180));
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') paint();
    });

    out.addEventListener('click', function (e) {
      var au = e.target.closest('[data-audio]');
      if (au) { try { new Audio(au.getAttribute('data-audio')).play(); } catch (err) {} return; }
      var on = e.target.closest('[data-online]');
      if (on) { doOnline(input.value.trim()); return; }
      var w = e.target.closest('[data-w]');
      if (w) UIKit.wordSheet(w.getAttribute('data-w'), { source: 'dict' });
    });

    paint();
    if (dstate.q) {
      input.value = dstate.q;
      paint();
    }
    setTimeout(function () { try { input.focus(); } catch (e) {} }, 200);
  }

  App.register('books', {
    title: '词书',
    sub: '选择目标词汇范围',
    render: renderBooks
  });

  App.register('dict', {
    title: '词典',
    sub: '离线优先 · 联网补充',
    render: renderDict
  });
})(window);
