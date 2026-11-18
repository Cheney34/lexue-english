/* 识图：拍照 / 相册 → 离线 OCR → 提取英文单词 → 挂词、入本、存图 */
(function (global) {
  'use strict';

  var state = {
    dataUrl: '',
    text: '',
    busy: false,
    savedImageId: '',
    error: ''
  };

  function actions() {
    if (!state.dataUrl) return [];
    return [{ key: 'reset', label: T('重来'), onClick: function () { reset(); } }];
  }

  function reset() {
    state.dataUrl = '';
    state.text = '';
    state.savedImageId = '';
    state.error = '';
    state.busy = false;
    App.refresh();
  }

  function render(el) {
    if (!state.dataUrl) return renderPicker(el);
    renderResult(el);
  }

  /* ============================== 取图入口 ============================== */

  function renderPicker(el) {
    el.appendChild(U.dom(
      '<div class="card">' +
        '<div class="row" style="gap:10px">' +
          '<button class="btn grow" data-a="camera" style="height:72px;flex-direction:column;font-size:13px">' +
            T('<span style="font-size:24px">📷</span><span>拍照识别</span></button>') +
          '<button class="btn grow ghost" data-a="gallery" style="height:72px;flex-direction:column;font-size:13px">' +
            T('<span style="font-size:24px">🖼</span><span>从相册选</span></button>') +
        '</div>' +
        T('<div class="muted xsmall center mt12">识别在手机本地完成，图片不会上传</div>') +
      '</div>'));

    el.appendChild(U.dom(
      '<div class="card">' +
        T('<div class="muted small mb8">也可以直接粘贴英文段落，提取其中的生词</div>') +
        '<textarea id="sc-paste" rows="4" placeholder="Paste any English text here…"></textarea>' +
        T('<button class="btn block ghost mt8" data-a="paste">提取单词</button>') +
      '</div>'));

    el.appendChild(U.dom(
      '<div class="card tight">' +
        T('<div class="bold small mb8">离线识别能力</div>') +
        T('<div class="muted xsmall">基于 Tesseract LSTM 英文模型，适合识别书本、试卷、菜单、路牌等印刷体英文。') +
        T('手写体与艺术字识别率有限。</div>') +
      '</div>'));

    if (state.error) {
      el.insertBefore(U.dom('<div class="notice err">' + U.esc(state.error) + '</div>'), el.firstChild);
      state.error = '';
    }

    if (state.busy) {
      el.insertBefore(U.dom(T('<div class="notice">正在识别，请稍候…</div>')), el.firstChild);
    }

    // 历史识别
    Store.listImages().then(function (list) {
      var withText = list.filter(function (im) { return im.ocrText; }).slice(0, 8);
      if (!withText.length) return;
      var card = U.dom(T('<div><div class="section-title">最近识别</div><div class="card tight"></div></div>'));
      var box = card.lastElementChild;
      box.innerHTML = withText.map(function (im) {
        var n = U.extractWords(im.ocrText).length;
        return '<div class="list-item" data-id="' + im.id + '">' +
          '<img src="' + im.dataUrl + '" style="width:40px;height:40px;object-fit:cover;border-radius:8px;margin-right:10px">' +
          '<div class="li-main"><div class="li-title ellipsis">' + U.esc(im.title || T('未命名图片')) + '</div>' +
          '<div class="li-sub">' + n + T(' 个英文词 · ') + U.fmtAgo(im.createdAt) + '</div></div>' +
          '<span class="li-arrow">›</span></div>';
      }).join('');
      el.appendChild(card);
      box.addEventListener('click', function (e) {
        var it = e.target.closest('[data-id]');
        if (!it) return;
        Store.getImage(it.getAttribute('data-id')).then(function (im) {
          if (!im) return;
          state.dataUrl = im.dataUrl;
          state.text = im.ocrText || '';
          state.savedImageId = im.id;
          App.refresh();
        });
      });
    });

    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-a]');
      if (!b) return;
      var a = b.getAttribute('data-a');
      if (a === 'camera') pick('camera');
      else if (a === 'gallery') pick('gallery');
      else if (a === 'paste') {
        var t = U.$('#sc-paste', el).value.trim();
        if (!t) { U.toast(T('先粘贴一些英文')); return; }
        state.dataUrl = 'text-only';
        state.text = t;
        App.refresh();
      }
    });
  }

  function pick(source) {
    state.busy = true;
    U.toast(source === 'camera' ? T('正在打开相机…') : T('正在打开相册…'), 1200);
    UIKit.pickImages(source).then(function (imgs) {
      state.busy = false;
      if (!imgs.length) { App.refresh(); return; }
      state.dataUrl = imgs[0].dataUrl;
      state.text = '';
      state.savedImageId = '';
      App.refresh();
      runOcr();
    });
  }

  function runOcr() {
    state.busy = true;
    App.refresh();
    Bridge.ocr(state.dataUrl).then(function (r) {
      state.busy = false;
      if (!r.ok) {
        state.error = T('识别失败：') + (r.error || T('未知错误'));
      } else {
        state.text = r.text || '';
        if (!state.text.trim()) state.error = T('没有识别到文字，换一张更清晰、光线更好的图片试试');
      }
      App.refresh();
    });
  }

  /* ============================== 识别结果 ============================== */

  function renderResult(el) {
    var words = U.extractWords(state.text);

    if (state.dataUrl !== 'text-only') {
      el.appendChild(U.dom('<img class="preview" src="' + state.dataUrl + '">'));
    }

    if (state.busy) {
      el.appendChild(U.dom('<div class="card center"><span class="spinner lg"></span>' +
        T('<div class="muted small mt8">离线识别中…（首次运行需要释放语言包，约 2 秒）</div></div>')));
      return;
    }

    if (state.error) {
      el.appendChild(U.dom('<div class="notice err">' + U.esc(state.error) + '</div>'));
      el.appendChild(U.dom(T('<button class="btn block ghost" data-a="retry">重新识别</button>')));
    }

    // 识别文本（可编辑）
    var textCard = U.dom(
      '<div class="card mt12">' +
      T('<div class="row between mb8"><span class="muted small">识别结果（可修正后重新提取）</span>') +
      '<span class="muted xsmall">' + words.length + T(' 个词</span></div>') +
      '<textarea id="sc-text" rows="5">' + U.esc(state.text) + '</textarea>' +
      '<div class="row mt8" style="gap:8px">' +
        T('<button class="btn sm ghost grow" data-a="reextract">重新提取</button>') +
        T('<button class="btn sm ghost grow" data-a="copy">复制文本</button>') +
      '</div></div>');
    el.appendChild(textCard);

    // 单词列表
    var wordCard = U.dom('<div class="card"><div class="row between mb8">' +
      T('<span class="muted small">提取到的英文单词</span>') +
      T('<span><button class="btn sm ghost" data-a="allcards">全部入生词本</button></span></div>') +
      '<div id="sc-words"></div></div>');
    el.appendChild(wordCard);

    var wbox = U.$('#sc-words', wordCard);
    if (!words.length) {
      wbox.innerHTML = T('<div class="muted small">没有提取到英文单词</div>');
    } else {
      wbox.innerHTML = words.slice(0, 120).map(function (w) {
        var e = Dict.lemma(w);
        return '<div class="word-item" data-w="' + U.attr(w) + '">' +
          '<div class="grow" style="min-width:0">' +
            '<div class="w">' + U.esc(w) +
              (e && e.word !== w ? ' <span class="muted xsmall">→ ' + U.esc(e.word) + '</span>' : '') + '</div>' +
            '<div class="tr ellipsis">' + (e ? U.esc(e.trans) : T('<span class="muted">词库未收录，可联网查询</span>')) + '</div>' +
          '</div>' +
          '<button class="btn sm ghost" data-say="' + U.attr(e ? e.word : w) + '">🔊</button>' +
          '<button class="btn sm" data-add="' + U.attr(e ? e.word : w) + '" style="margin-left:6px">＋</button>' +
        '</div>';
      }).join('');
    }

    // 保存 / 挂宫殿
    el.appendChild(U.dom(
      '<div class="card mt12">' +
        T('<div class="row between mb8"><span class="muted small">保存与归档</span></div>') +
        '<div class="row" style="gap:8px">' +
          (state.dataUrl !== 'text-only'
            ? '<button class="btn grow ghost" data-a="save">' + (state.savedImageId ? T('已存到图库') : T('保存图片到图库')) + '</button>'
            : '') +
          T('<button class="btn grow ghost" data-a="palace">挂到地点桩</button>') +
        '</div>' +
      '</div>'));

    el.addEventListener('click', function (e) {
      var say = e.target.closest('[data-say]');
      if (say) { Bridge.speak(say.getAttribute('data-say')); return; }
      var add = e.target.closest('[data-add]');
      if (add) {
        var w = add.getAttribute('data-add');
        UIKit.addWord(w, { imageId: state.savedImageId, source: 'ocr' }).then(function (r) {
          U.toast(r.isNew ? T('已加入：') + w : w + T(' 已在生词本'));
          U.haptic();
          App.updateDueDot();
        });
        return;
      }
      var wi = e.target.closest('[data-w]');
      if (wi) {
        UIKit.wordSheet(wi.getAttribute('data-w'), {
          imageId: state.savedImageId, source: 'ocr'
        });
        return;
      }
      var b = e.target.closest('[data-a]');
      if (!b) return;
      var a = b.getAttribute('data-a');
      if (a === 'retry') runOcr();
      else if (a === 'reextract') {
        state.text = U.$('#sc-text', el).value;
        App.refresh();
      } else if (a === 'copy') {
        Bridge.copy(state.text);
        U.toast(T('已复制'));
      } else if (a === 'allcards') {
        var list = words.slice(0, 120);
        if (!list.length) { U.toast(T('没有可添加的单词')); return; }
        b.disabled = true;
        var added = 0;
        Promise.all(list.map(function (w) {
          return UIKit.addWord(w, { imageId: state.savedImageId, source: 'ocr' })
            .then(function (r) { if (r.isNew) added++; });
        })).then(function () {
          b.disabled = false;
          U.toast(T('新增 ') + added + T(' 个生词'));
          U.haptic(20);
          App.updateDueDot();
        });
      } else if (a === 'save') {
        if (state.savedImageId) { U.toast(T('已保存在图库中')); return; }
        Store.addImage({
          dataUrl: state.dataUrl,
          ocrText: state.text,
          tags: [],
          words: []
        }).then(function (im) {
          state.savedImageId = im.id;
          U.toast(T('已保存到图库'));
          App.refresh();
        });
      } else if (a === 'palace') {
        openPalacePicker(words.slice(0, 40));
      }
    });
  }

  function openPalacePicker(words) {
    Store.listPalaces().then(function (ps) {
      var body = U.dom('<div>' +
        (ps.length ? '' : T('<div class="muted small mb8">还没有宫殿，先创建一个</div>')) +
        ps.map(function (p) {
          return '<div class="list-item" data-p="' + p.id + '">' +
            '<div class="li-main"><div class="li-title">' + U.esc(p.name) + '</div>' +
            '<div class="li-sub">' + (p.loci || []).length + T(' 个地点桩</div></div>') +
            '<span class="li-arrow">›</span></div>';
        }).join('') +
        T('<button class="btn block ghost mt12" data-new="1">＋ 新建宫殿并加入</button></div>'));
      var h = U.openSheet({ title: T('选择要挂词的宫殿'), body: body });
      body.addEventListener('click', function (e) {
        if (e.target.closest('[data-new]')) {
          h.close();
          U.promptBox(T('新建宫殿'), '', T('例如：我的家')).then(function (name) {
            if (name === null) return;
            Store.addPalace(name || T('未命名宫殿'), '').then(function (p) {
              addWordsToPalace(p.id, words);
            });
          });
          return;
        }
        var it = e.target.closest('[data-p]');
        if (!it) return;
        h.close();
        addWordsToPalace(it.getAttribute('data-p'), words);
      });
    });
  }

  function addWordsToPalace(pid, words) {
    var imageId = state.savedImageId;
    if (!imageId && state.dataUrl !== 'text-only') {
      // 先落库，才能作为地点桩
      Store.addImage({ dataUrl: state.dataUrl, ocrText: state.text, tags: [], words: [] })
        .then(function (im) {
          state.savedImageId = im.id;
          doAttach(pid, words, im.id);
        });
    } else {
      doAttach(pid, words, imageId);
    }
  }

  function doAttach(pid, words, imageId) {
    Store.getPalace(pid).then(function (p) {
      if (!p) return;
      p.loci = p.loci || [];
      var locus = null;
      for (var i = 0; i < p.loci.length; i++) {
        if (imageId && p.loci[i].imageId === imageId) { locus = p.loci[i]; break; }
      }
      if (!locus) {
        locus = {
          id: U.uid('loc'),
          title: (state.savedImageId === imageId ? T('地点 ') : T('文字地点 ')) + (p.loci.length + 1),
          imageId: imageId || '',
          words: [],
          note: ''
        };
        p.loci.push(locus);
      }
      words.forEach(function (w) {
        if (locus.words.indexOf(w) < 0) locus.words.push(w);
      });
      return Store.putPalace(p);
    }).then(function () {
      return Promise.all(words.map(function (w) {
        return UIKit.addWord(w, { imageId: imageId, palaceId: pid, source: 'ocr' });
      }));
    }).then(function () {
      U.toast(T('已把 ') + words.length + T(' 个词挂到宫殿'));
      U.haptic(20);
      App.updateDueDot();
    });
  }

  App.register('scan', {
    title: '识图取词',
    sub: '离线 OCR · 拍照即记',
    actions: actions,
    render: render
  });
})(window);
