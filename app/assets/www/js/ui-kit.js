/* 复用组件：取图压缩、单词详情面板、标签编辑、加词 */
(function (global) {
  'use strict';

  /* ---------------------------- 图片压缩 ---------------------------- */

  function shrink(dataUrl, maxEdge, quality) {
    maxEdge = maxEdge || 1200;
    quality = quality || 0.82;
    return new Promise(function (resolve) {
      if (!dataUrl || dataUrl.indexOf('data:image') !== 0) { resolve(dataUrl); return; }
      var img = new Image();
      img.onload = function () {
        var w = img.width, h = img.height;
        var longer = Math.max(w, h);
        if (longer <= maxEdge && dataUrl.length < 420000) { resolve(dataUrl); return; }
        var r = longer > maxEdge ? maxEdge / longer : 1;
        var cw = Math.round(w * r), ch = Math.round(h * r);
        try {
          var cv = document.createElement('canvas');
          cv.width = cw; cv.height = ch;
          var ctx = cv.getContext('2d');
          ctx.drawImage(img, 0, 0, cw, ch);
          resolve(cv.toDataURL('image/jpeg', quality));
        } catch (e) { resolve(dataUrl); }
      };
      img.onerror = function () { resolve(dataUrl); };
      img.src = dataUrl;
    });
  }

  function pickImages(source, opt) {
    opt = opt || {};
    return Bridge.pickImages(source).then(function (r) {
      if (!r.ok || !r.images || !r.images.length) {
        if (r.error && r.error !== 'cancelled') U.toast(r.error);
        return [];
      }
      return Promise.all(r.images.map(function (im) {
        return shrink(im.dataUrl, opt.maxEdge || 1200, opt.quality || 0.82)
          .then(function (d) { return { dataUrl: d }; });
      }));
    });
  }

  /* ---------------------------- 标签编辑 ---------------------------- */

  function tagEditor(title, current) {
    return new Promise(function (resolve) {
      var pool = allTags();
      var chosen = (current || []).slice();
      var box = U.dom('<div><div class="row wrap" id="te-chips"></div>' +
        T('<div class="row mt12"><input type="text" id="te-new" placeholder="新建标签…">') +
        T('<button class="btn sm" id="te-add" style="margin-left:8px">添加</button></div></div>'));

      function paint() {
        var c = U.$('#te-chips', box);
        c.innerHTML = chosen.map(function (t) {
          return '<span class="chip on" data-t="' + U.attr(t) + '">' + U.esc(t) +
            '<span class="x">×</span></span>';
        }).join('') + pool.filter(function (t) { return chosen.indexOf(t) < 0; })
          .map(function (t) {
            return '<span class="chip tap" data-add="' + U.attr(t) + '">+ ' + U.esc(t) + '</span>';
          }).join('');
      }

      box.addEventListener('click', function (e) {
        var rm = e.target.closest('[data-t]');
        if (rm) {
          var t = rm.getAttribute('data-t');
          var i = chosen.indexOf(t);
          if (i >= 0) chosen.splice(i, 1);
          paint();
          return;
        }
        var add = e.target.closest('[data-add]');
        if (add) {
          chosen.push(add.getAttribute('data-add'));
          paint();
        }
      });

      function addNew() {
        var v = U.$('#te-new', box).value.trim();
        if (!v) return;
        if (chosen.indexOf(v) < 0) chosen.push(v);
        if (pool.indexOf(v) < 0) {
          Store.settings.tags = Store.settings.tags || [];
          Store.settings.tags.push(v);
          Store.saveSettings();
          pool = allTags();
        }
        U.$('#te-new', box).value = '';
        paint();
      }
      U.$('#te-add', box).addEventListener('click', addNew);
      U.$('#te-new', box).addEventListener('keydown', function (e) {
        if (e.key === 'Enter') addNew();
      });

      paint();
      var done = false;
      function finish(v) { if (!done) { done = true; resolve(v); } }
      var h = U.openSheet({
        title: title || T('编辑标签'),
        body: box,
        footer: T('<div class="sheet-foot"><button class="btn block" data-ok="1">完成</button></div>'),
        onClose: function () { finish(null); }
      });
      h.el.addEventListener('click', function (e) {
        if (e.target.closest('[data-ok]')) {
          finish(chosen);
          h.close();
        }
      });
    });
  }

  function allTags() {
    var s = (Store.settings.tags || []).slice();
    var out = [], seen = {};
    s.forEach(function (t) { if (t && !seen[t]) { seen[t] = 1; out.push(t); } });
    return out;
  }

  /* ---------------------------- 加词入本 ---------------------------- */

  function addWord(word, opt) {
    opt = opt || {};
    var e = Dict.lemma(word);
    var extra = {
      phonetic: (e && e.phonetic) || opt.phonetic || '',
      trans: (e && e.trans) || opt.trans || '',
      source: opt.source || 'manual',
      bookId: Store.settings.bookId,
      imageIds: opt.imageId ? [opt.imageId] : [],
      palaceId: opt.palaceId || ''
    };
    return Store.upsertCard(word, extra);
  }

  /* ---------------------------- 单词详情 ---------------------------- */

  /** opts: {imageId, palaceId, onChanged} */
  function wordSheet(word, opts) {
    opts = opts || {};
    var e = Dict.lemma(word);
    var card = null;
    var body = U.dom('<div></div>');

    function paint() {
      var tags = e ? Dict.tagNames(e.tag) : [];
      var html = '';
      html += '<div class="row between">' +
        '<div class="grow"><div style="font-size:26px;font-weight:700" class="ellipsis">' +
        U.esc(word) + '</div>' +
        '<div class="muted small mt8">' + (e && e.phonetic ? '[' + U.esc(e.phonetic) + '] ' : '') +
        (tags.length ? tags.join(' · ') : (e ? T('常用词') : T('离线词库未收录'))) + '</div></div>' +
        T('<button class="btn sm ghost" data-act="speak">🔊 发音</button></div>');
      html += '<div class="card tight mt12" style="box-shadow:none;background:var(--surface-2)">' +
        '<div style="font-size:16px;line-height:1.7">' +
        (e && e.trans ? U.esc(e.trans) : T('<span class="muted">离线词库中没有该词</span>')) +
        '</div></div>';

      if (card) {
        var st = card.state === 'new' ? T('新词') : (card.state === 'learning' ? T('巩固中') : T('复习中'));
        html += '<div class="row wrap small muted" style="margin-top:2px">' +
          '<span class="chip brand">' + st + '</span>' +
          (card.interval ? T('<span class="chip">间隔 ') + card.interval + T(' 天</span>') : '') +
          (card.reps ? T('<span class="chip">复习 ') + card.reps + T(' 次</span>') : '') +
          (card.lapses ? T('<span class="chip">遗忘 ') + card.lapses + T(' 次</span>') : '') +
          '</div>';
      }

      html += '<div id="ws-online" class="mt8"></div>';
      html += '<div class="row wrap mt8">' +
        T('<button class="btn sm line" data-act="online">联网查更多</button>') +
        '<button class="btn sm line" data-act="web" style="margin-left:8px">' + I18N.L('dictWeb') + '</button>' +
        T('<button class="btn sm line" data-act="copy" style="margin-left:8px">复制</button>') +
        '</div>';

      body.innerHTML = html;
    }

    function refresh() {
      return Store.getCard(word).then(function (c) {
        card = c;
        paint();
        // 离线词库里没有这个词：直接联网查一次，省掉一次点击（1.2.3）。
        // 查询结果有 5 分钟内的失败缓存，不会每开一次面板就重新打网络。
        if (!e) doOnline(null);
      });
    }

    body.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-act]');
      if (!b) return;
      var a = b.getAttribute('data-act');
      if (a === 'speak') Bridge.speak(word);
      else if (a === 'copy') { Bridge.copy(word); U.toast(T('已复制')); }
      else if (a === 'online') doOnline(b);
      else if (a === 'web') openInBrowser();
      else if (a === 'add') doAdd(b);
    });

    function doAdd(btn) {
      btn.disabled = true;
      addWord(word, { imageId: opts.imageId, palaceId: opts.palaceId, source: opts.source })
        .then(function (r) {
          btn.disabled = false;
          U.toast(r.isNew ? T('已加入生词本') : T('已在生词本中'));
          U.haptic();
          App.updateDueDot();
          if (opts.onChanged) opts.onChanged();
          return refresh();
        });
    }

    /** 所有在线接口都不认这个词时，交给系统浏览器上的词典页面 */
    function dictPage(w) {
      return 'https://dict.youdao.com/result?word=' + encodeURIComponent(String(w || '')) + '&lang=en';
    }

    function openInBrowser() {
      try {
        Bridge.openExternal(dictPage(word));
        U.toast(I18N.L('dictOpened'));
      } catch (err) {
        U.toast(I18N.L('dictOpenFail') + word);
      }
    }

    function doOnline(btn) {
      var box = U.$('#ws-online', body);
      if (!box) return;
      if (btn) btn.disabled = true;
      box.innerHTML = T('<div class="loading-box"><span class="spinner"></span> 正在联网查询…</div>');
      Dict.online(word).then(function (r) {
        if (btn) btn.disabled = false;
        if (!r.ok) {
          box.innerHTML = '<div class="notice err">' + U.esc(r.error || T('查询失败')) + '</div>' +
            (r.tried && r.tried.length > 1
              ? '<div class="xsmall muted mt8">' + I18N.L('onlineTried') + U.esc(r.tried.join(' / ')) + '</div>'
              : '') +
            '<div class="xsmall muted mt8">' + I18N.L('dictWebHint') + '</div>';
          return;
        }
        var html = '';
        if (r.via && r.via !== String(word).toLowerCase()) {
          html += '<div class="xsmall muted">' + I18N.L('onlineVia') + U.esc(r.via) + '</div>';
        }
        if (r.phonetic || r.audio) {
          html += '<div class="row between" style="margin-bottom:6px">' +
            '<span class="muted small">' + (r.phonetic ? '[' + U.esc(r.phonetic) + ']' : '') + '</span>' +
            (r.audio ? T('<button class="btn sm ghost" data-act="audio">🔊 真人发音</button>') : '') +
            '</div>';
        }
        if (r.trans) {
          html += '<div class="card tight" style="box-shadow:none;background:var(--ok-soft);color:var(--ok)">' +
            U.esc(r.trans) + '</div>';
        }
        (r.meanings || []).forEach(function (m) {
          html += '<div class="mt8"><span class="tag">' + U.esc(m.pos) + '</span></div>';
          html += '<ul style="margin:4px 0 0;padding-left:18px;font-size:13.5px;color:var(--text-2)">' +
            m.defs.map(function (d) { return '<li>' + U.esc(d) + '</li>'; }).join('') + '</ul>';
        });
        box.innerHTML = html;
        var ab = U.$('[data-act="audio"]', box);
        if (ab) {
          ab.addEventListener('click', function () {
            try { new Audio(r.audio).play(); } catch (e) { U.toast(T('无法播放')); }
          });
        }
      });
    }

    paint();
    var foot = U.dom('<div class="sheet-foot">' +
      (e ? T('<button class="btn ghost" data-act="add">加入生词本</button>') : '') +
      (e ? '' : T('<button class="btn ghost" data-act="add">仍然加入</button>')) +
      '</div>');
    var h = U.openSheet({ title: T('单词详情'), body: body, footer: foot });
    // footer 里的按钮也需要响应
    foot.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-act]');
      if (b && b.getAttribute('data-act') === 'add') doAdd(b);
    });
    refresh();
    return h;
  }

  /* ---------------------------- 若干部与卡片 ---------------------------- */

  /** 把卡片挂到某个地点桩/图片上 */
  function attachToLoci(words, palaceId, imageId, locusTitle) {
    return Store.getPalace(palaceId).then(function (p) {
      if (!p) return null;
      p.loci = p.loci || [];
      var locus = null;
      for (var i = 0; i < p.loci.length; i++) {
        if ((imageId && p.loci[i].imageId === imageId) ||
            (locusTitle && p.loci[i].title === locusTitle)) { locus = p.loci[i]; break; }
      }
      if (!locus) {
        locus = { id: U.uid('loc'), title: locusTitle || (T('地点 ') + (p.loci.length + 1)), imageId: imageId || '', words: [], note: '' };
        p.loci.push(locus);
      }
      words.forEach(function (w) {
        if (locus.words.indexOf(w) < 0) locus.words.push(w);
      });
      return Store.putPalace(p);
    });
  }

  /** 便捷：加词 + 同时挂到宫殿 */
  function addWordWithLocus(word, palaceId, imageId, locusTitle) {
    return addWord(word, { palaceId: palaceId, imageId: imageId }).then(function (r) {
      if (!palaceId) return r;
      return attachToLoci([String(word).toLowerCase()], palaceId, imageId, locusTitle)
        .then(function () { return r; });
    });
  }

  global.UIKit = {
    shrink: shrink, pickImages: pickImages,
    tagEditor: tagEditor, allTags: allTags,
    addWord: addWord, wordSheet: wordSheet,
    attachToLoci: attachToLoci, addWordWithLocus: addWordWithLocus
  };
})(window);
