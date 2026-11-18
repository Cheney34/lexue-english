/* 复习：SM-2 间隔重复 + 今日队列 + 统计 + 生词本 */
(function (global) {
  'use strict';

  var GRADE = [
    { g: 0, label: '忘记了', cls: 'danger' },
    { g: 1, label: '模糊', cls: 'line' },
    { g: 2, label: '记得', cls: 'ghost' },
    { g: 3, label: '太简单', cls: 'ok' }
  ];

  /* ============================== 主界面 ============================== */

  function render(el) {
    Promise.all([Store.cardStats(), Store.recentDaily(7), Store.streak(), Store.listPalaces()])
      .then(function (r) {
        var s = r[0], daily = r[1], streak = r[2], palaces = r[3];

        el.appendChild(U.dom(
          '<div class="card" style="background:linear-gradient(135deg,#3d5a80,#24384f);color:#fff">' +
            '<div class="row between">' +
              T('<div><div class="xsmall" style="opacity:.82">今天待复习</div>') +
              '<div style="font-size:32px;font-weight:700;line-height:1.2">' + s.due + '</div></div>' +
              '<div style="text-align:right">' +
                T('<div class="xsmall" style="opacity:.82">已连续打卡</div>') +
                '<div style="font-size:22px;font-weight:600">' + streak + T(' 天</div>') +
              '</div>' +
            '</div>' +
            '<div class="row mt12" style="gap:8px">' +
              T('<button class="btn grow" data-a="start" style="background:#fff;color:#24384f">开始复习</button>') +
              T('<button class="btn grow" data-a="newwords" style="background:rgba(255,255,255,.18)">学新词</button>') +
            '</div>' +
            (s.due ? '' : T('<div class="xsmall mt8" style="opacity:.85">暂无到期卡片，可以学几个新词</div>')) +
          '</div>'));

        var grid = U.dom('<div class="stat-grid mt12"></div>');
        grid.innerHTML =
          stat(s.total, T('生词本')) +
          stat(s.mastered, T('已掌握')) +
          stat(s.learning + s.new, T('巩固中'));
        el.appendChild(grid);

        // 近 7 日
        var maxN = 1;
        daily.forEach(function (d) { maxN = Math.max(maxN, d.reviewed); });
        el.appendChild(U.dom(
          '<div class="card mt12"><div class="row between mb8">' +
          T('<span class="muted small">近 7 天复习量</span>') +
          T('<span class="muted xsmall">共 ') + daily.reduce(function (a, b) { return a + b.reviewed; }, 0) + T(' 次</span>') +
          '</div><div class="bars">' +
          daily.map(function (d) {
            var h = Math.round(d.reviewed / maxN * 74);
            return '<div class="b"><i style="height:' + Math.max(h, d.reviewed ? 4 : 2) + 'px"></i>' +
              '<span>' + d.label + '</span></div>';
          }).join('') +
          '</div></div>'));

        // 宫殿复习
        var withWords = palaces.filter(function (p) {
          return (p.loci || []).some(function (l) { return (l.words || []).length; });
        });
        if (withWords.length) {
          el.appendChild(U.dom(T('<div class="section-title">按宫殿复习</div>')));
          var pbox = U.dom('<div class="card"></div>');
          pbox.innerHTML = withWords.map(function (p) {
            var n = 0;
            (p.loci || []).forEach(function (l) { n += (l.words || []).length; });
            return '<div class="list-item" data-p="' + p.id + '">' +
              '<div class="li-main"><div class="li-title">' + U.esc(p.name) + '</div>' +
              '<div class="li-sub">' + (p.loci || []).length + T(' 个地点桩 · ') + n + T(' 个单词</div></div>') +
              '<span class="li-arrow">›</span></div>';
          }).join('');
          el.appendChild(pbox);
          pbox.addEventListener('click', function (e) {
            var it = e.target.closest('[data-p]');
            if (!it) return;
            var pid = it.getAttribute('data-p');
            var palace = null;
            palaces.forEach(function (p) { if (p.id === pid) palace = p; });
            if (!palace) return;
            var words = [];
            (palace.loci || []).forEach(function (l) {
              (l.words || []).forEach(function (w) { if (words.indexOf(w) < 0) words.push(w); });
            });
            if (!words.length) { U.toast(T('这座宫殿还没有单词')); return; }
            startSession({ words: words, palaceId: pid, title: palace.name });
          });
        }

        // 生词本
        el.appendChild(U.dom(T('<div class="section-title">生词本</div>')));
        var notebook = U.dom(T('<button class="btn block ghost" data-a="notebook">查看全部 ') + s.total + T(' 个生词</button>'));
        el.appendChild(notebook);

        el.addEventListener('click', function (e) {
          var b = e.target.closest('[data-a]');
          if (!b) return;
          var a = b.getAttribute('data-a');
          if (a === 'start') startSession({});
          else if (a === 'newwords') startNew();
          else if (a === 'notebook') openNotebook();
        });
      });
  }

  function stat(n, label) {
    return '<div class="stat"><b>' + n + '</b><span>' + label + '</span></div>';
  }

  function startNew() {
    Store.cardMap().then(function (cmap) {
      var all = Dict.bookEntries(Store.settings.bookId);
      var todo = all.filter(function (e) { return !cmap[e.word]; })
        .map(function (e) { return e.word; });
      if (!todo.length) { U.toast(T('当前词书已经全部学过了，去「词书」里换一本')); return; }
      var n = Math.min(todo.length, Store.settings.dailyNew || 20);
      var picked = todo.slice(0, n);
      Promise.all(picked.map(function (w) { return UIKit.addWord(w, { source: 'book' }); }))
        .then(function () {
          App.updateDueDot();
          startSession({ words: picked, title: T('新词 ') + n + T(' 个') });
        });
    });
  }

  /* ============================== 复习会话 ============================== */

  function startSession(opts) {
    opts = opts || {};
    var ctx = { queue: [], idx: 0, flipped: false, done: 0, again: 0, title: opts.title || T('复习') };

    buildQueue(opts).then(function (queue) {
      if (!queue.length) {
        U.toast(T('没有需要复习的内容'));
        return;
      }
      ctx.queue = queue;
      App.push(function (el) {
        renderSession(el, ctx);
      }, { title: ctx.title, sub: '0 / ' + queue.length });
    });
  }

  function buildQueue(opts) {
    if (opts.words && opts.words.length) {
      return Promise.all(opts.words.map(function (w) {
        return UIKit.addWord(w, { source: opts.palaceId ? 'palace' : 'manual' })
          .then(function (r) { return r.card; });
      }));
    }
    return Store.dueCards().then(function (due) {
      return Store.cardMap().then(function () {
        return Store.newCards(Math.min(Store.settings.dailyNew || 20, 30))
          .then(function (news) {
            var seen = {};
            var out = [];
            due.forEach(function (c) { if (!seen[c.id]) { seen[c.id] = 1; out.push(c); } });
            if (due.length < 12) {
              news.forEach(function (c) { if (!seen[c.id]) { seen[c.id] = 1; out.push(c); } });
            }
            return out.slice(0, Store.settings.dailyLimit || 120);
          });
      });
    });
  }

  function renderSession(el, ctx) {
    function card() { return ctx.queue[ctx.idx]; }

    function paint() {
      var c = card();
      if (!c) return renderSummary();
      App.setBar(ctx.title, (ctx.idx + 1) + ' / ' + ctx.queue.length, [
        { key: 'quit', label: T('结束'), onClick: function () { App.pop(); App.updateDueDot(); } }
      ]);

      el.innerHTML = '';
      el.appendChild(U.dom('<div class="progress mb8"><i style="width:' +
        Math.round(ctx.idx / ctx.queue.length * 100) + '%"></i></div>'));

      var cue = '';
      var flash = U.dom('<div class="card flash" id="rv-flash"></div>');
      el.appendChild(flash);
      el.appendChild(U.dom('<div id="rv-cue" class="center"></div>'));

      function drawFront() {
        flash.innerHTML =
          '<div class="front">' + U.esc(c.word) + '</div>' +
          (c.phonetic ? '<div class="phon">[' + U.esc(c.phonetic) + ']</div>' : '') +
          T('<button class="btn sm ghost mt12" data-a="say">🔊 听发音</button>') +
          T('<div class="hint">点击卡片查看释义</div>');
        var cueBox = U.$('#rv-cue', el);
        cueBox.innerHTML = '';
        if (Store.settings.showCue && c.imageIds && c.imageIds.length) {
          Store.getImage(c.imageIds[0]).then(function (im) {
            if (!im || !cueBox.parentNode) return;
            cueBox.innerHTML = '<img class="cue" style="width:120px;height:120px;object-fit:cover;' +
              'border-radius:12px;box-shadow:var(--shadow)" src="' + im.dataUrl + '">' +
              T('<div class="muted xsmall mt8">地点桩线索</div>');
          });
        }
      }

      function drawBack() {
        var e = Dict.lookup(c.word);
        flash.innerHTML =
          '<div class="front" style="font-size:26px">' + U.esc(c.word) + '</div>' +
          (c.phonetic ? '<div class="phon">[' + U.esc(c.phonetic) + ']</div>' : '') +
          '<div class="back">' + U.esc(c.trans || (e && e.trans) || T('（暂无释义）')) + '</div>' +
          T('<button class="btn sm ghost mt12" data-a="say">🔊 听发音</button>') +
          T('<div class="muted xsmall mt12">复习次数 ') + (c.reps || 0) +
          (c.interval ? T(' · 当前间隔 ') + c.interval + T(' 天') : '') +
          (c.lapses ? T(' · 遗忘 ') + c.lapses + T(' 次') : '') + '</div>';

        var row = U.dom('<div class="rate-row"></div>');
        GRADE.forEach(function (g) {
          var b = U.dom('<button class="btn ' + g.cls + '" data-g="' + g.g + '">' + T(g.label) + '</button>');
          row.appendChild(b);
        });
        flash.appendChild(row);
      }

      if (ctx.flipped) drawBack(); else drawFront();

      flash.addEventListener('click', function (e) {
        var say = e.target.closest('[data-a="say"]');
        if (say) { Bridge.speak(c.word); return; }
        var gbtn = e.target.closest('[data-g]');
        if (gbtn) {
          var grade = parseInt(gbtn.getAttribute('data-g'), 10);
          answer(c, grade);
          return;
        }
        if (!ctx.flipped) {
          ctx.flipped = true;
          if (Store.settings.autoSpeak) Bridge.speak(c.word);
          drawBack();
        }
      });

      if (!ctx.flipped && Store.settings.autoSpeak) Bridge.speak(c.word);
    }

    function answer(c, grade) {
      var wasNew = c.state === 'new';
      Store.applyReview(c, grade).then(function (updated) {
        ctx.done++;
        if (grade === 0) ctx.again++;
        Store.bumpDaily('reviewed', 1);
        if (wasNew) Store.bumpDaily('learned', 1);
        if (grade === 0) {
          // 忘记的卡片重新排到队尾，本次会话内再出现一次
          ctx.queue.push(updated);
        }
        ctx.idx++;
        ctx.flipped = false;
        U.haptic(grade === 0 ? 24 : 10);
        App.updateDueDot();
        if (ctx.idx >= ctx.queue.length) renderSummary();
        else paint();
      });
    }

    function renderSummary() {
      App.setBar(ctx.title, T('完成'), []);
      el.innerHTML = '';
      el.appendChild(U.dom(
        '<div class="card center" style="padding:34px 18px">' +
          '<div style="font-size:40px">🎉</div>' +
          T('<div style="font-size:18px;font-weight:600;margin-top:10px">本组复习完成</div>') +
          T('<div class="muted small mt8">共作答 ') + ctx.done + T(' 次 · 需要加强 ') + ctx.again + T(' 次</div>') +
        '</div>'));
      el.appendChild(U.dom(T('<button class="btn block mt12" data-a="again">再来一组</button>')));
      el.appendChild(U.dom(T('<button class="btn block ghost mt8" data-a="back">返回</button>')));
      el.addEventListener('click', function (e) {
        var b = e.target.closest('[data-a]');
        if (!b) return;
        if (b.getAttribute('data-a') === 'again') {
          App.pop();
          setTimeout(function () { startSession({}); }, 60);
        } else {
          App.pop();
          App.updateDueDot();
        }
      });
    }

    paint();
  }

  /* ============================== 生词本 ============================== */

  var nbFilter = 'all';

  function openNotebook() {
    App.push(function (el) {
      App.setBar(T('生词本'), T('全部学习记录'), []);
      var listBox = U.dom('<div></div>');
      el.appendChild(U.dom(
        '<div class="segmented" id="nb-seg">' +
        [['all', T('全部')], ['new', T('新词')], ['learning', T('巩固中')], ['review', T('复习中')], ['mastered', T('已掌握')]]
          .map(function (p) {
            return '<button data-f="' + p[0] + '" class="' + (nbFilter === p[0] ? 'on' : '') + '">' + p[1] + '</button>';
          }).join('') + '</div>'));
      el.appendChild(listBox);

      function paint() {
        Store.listCards().then(function (cards) {
          var list = cards.filter(function (c) {
            if (nbFilter === 'all') return true;
            if (nbFilter === 'mastered') return c.interval >= 21;
            if (nbFilter === 'review') return c.state === 'review' && c.interval < 21;
            return c.state === nbFilter;
          });
          list.sort(function (a, b) { return b.createdAt - a.createdAt; });
          if (!list.length) {
            listBox.innerHTML = T('<div class="muted small center" style="padding:30px 0">这里还没有单词</div>');
            return;
          }
          listBox.innerHTML = T('<div class="muted small mb8">共 ') + list.length + T(' 个</div>') + list.slice(0, 300).map(function (c) {
            return '<div class="word-item" data-w="' + U.attr(c.word) + '">' +
              '<div class="grow" style="min-width:0"><div class="w">' + U.esc(c.word) +
              (c.phonetic ? ' <span class="muted xsmall">[' + U.esc(c.phonetic) + ']</span>' : '') + '</div>' +
              '<div class="tr ellipsis">' + U.esc(c.trans || '') + '</div></div>' +
              '<div style="text-align:right;flex:none">' +
                '<div class="xsmall muted">' + stateLabel(c) + '</div>' +
              '</div>' +
              '<button class="btn sm ghost" data-say="' + U.attr(c.word) + '" style="margin-left:6px">🔊</button>' +
              '<button class="btn sm line" data-del="' + U.attr(c.word) + T('" style="margin-left:6px">删</button>') +
              '</div>';
          }).join('') + (list.length > 300 ? T('<div class="muted xsmall center mt12">仅显示最近 300 条</div>') : '');
        });
      }

      function stateLabel(c) {
        if (c.interval >= 21) return T('已掌握');
        if (c.state === 'new') return T('新词');
        if (c.state === 'learning') return T('巩固中');
        return T('间隔 ') + c.interval + T(' 天');
      }

      paint();

      el.addEventListener('click', function (e) {
        var f = e.target.closest('[data-f]');
        if (f) {
          nbFilter = f.getAttribute('data-f');
          App.pop();
          openNotebook();
          return;
        }
        var say = e.target.closest('[data-say]');
        if (say) { Bridge.speak(say.getAttribute('data-say')); return; }
        var del = e.target.closest('[data-del]');
        if (del) {
          var w = del.getAttribute('data-del');
          U.confirmBox(T('删除生词'), T('将从生词本移除「') + w + T('」，复习记录一并清除。'), T('删除'))
            .then(function (ok) {
              if (!ok) return;
              Store.deleteCard(w).then(function () {
                U.toast(T('已删除'));
                App.updateDueDot();
                paint();
              });
            });
          return;
        }
        var wi = e.target.closest('[data-w]');
        if (wi) UIKit.wordSheet(wi.getAttribute('data-w'), { source: 'notebook', onChanged: paint });
      });
    });
  }

  global.Review = { startSession: startSession, openNotebook: openNotebook };

  App.register('review', {
    title: '背单词',
    sub: '今日复习 · 间隔重复',
    render: render
  });
})(window);
