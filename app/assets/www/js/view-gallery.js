/* 图库：图片整理（标签/搜索/批量）+ 记忆宫殿（地点桩管理） */
(function (global) {
  'use strict';

  var state = {
    tab: 'images',
    q: '',
    tag: '',
    sort: 'new',
    select: false,
    sel: {},
    images: null,
    palaces: null
  };

  /* ============================== 主渲染 ============================== */

  function render(el) {
    el.appendChild(U.dom(
      '<div class="segmented" id="g-seg">' +
      '<button data-tab="images" class="' + (state.tab === 'images' ? 'on' : '') + T('">图片</button>') +
      '<button data-tab="palaces" class="' + (state.tab === 'palaces' ? 'on' : '') + T('">我的宫殿</button>') +
      '</div>'));

    var body = U.dom('<div></div>');
    el.appendChild(body);

    U.$('#g-seg', el).addEventListener('click', function (e) {
      var b = e.target.closest('[data-tab]');
      if (!b) return;
      state.tab = b.getAttribute('data-tab');
      state.select = false;
      state.sel = {};
      App.refresh();
    });

    if (state.tab === 'images') renderImages(body);
    else renderPalaces(body);
  }

  function actions() {
    if (state.tab === 'images') {
      return [
        { key: 'cam', label: T('📷 拍照'), onClick: function () { importImages('camera'); } },
        { key: 'add', label: T('＋ 导入'), onClick: function () { importImages('gallery'); } }
      ];
    }
    return [{ key: 'new', label: T('＋ 宫殿'), onClick: newPalace }];
  }

  /* ============================== 图片列表 ============================== */

  function renderImages(body) {
    Store.listImages().then(function (list) {
      state.images = list;
      var tags = collectTags(list);

      var bar = U.dom(
        '<div>' +
        '<div class="row" style="gap:4px">' +
          T('<input type="text" id="g-q" placeholder="搜索标题 / 标签 / 单词 / 识别文字">') +
          T('<button class="btn sm ghost" id="g-sel">选择</button>') +
        '</div>' +
        '<div class="row wrap mt8" id="g-tags">' +
          '<span class="chip' + (state.tag ? '' : ' on') + T('" data-tag="">全部 ') + list.length + '</span>' +
          tags.map(function (t) {
            return '<span class="chip' + (state.tag === t ? ' on' : '') + '" data-tag="' +
              U.attr(t) + '">' + U.esc(t) + '</span>';
          }).join('') +
        '</div>' +
        '</div>');
      body.appendChild(bar);

      var qi = U.$('#g-q', bar);
      qi.value = state.q;
      qi.addEventListener('input', U.debounce(function () {
        state.q = qi.value.trim();
        paintGrid(gridBox);
      }, 200));

      U.$('#g-sel', bar).addEventListener('click', function () {
        state.select = !state.select;
        state.sel = {};
        U.$('#g-sel', bar).textContent = state.select ? T('取消') : T('选择');
        U.$('#g-sel', bar).className = 'btn sm' + (state.select ? '' : ' ghost');
        paintGrid(gridBox);
      });

      U.$('#g-tags', bar).addEventListener('click', function (e) {
        var c = e.target.closest('[data-tag]');
        if (!c) return;
        state.tag = c.getAttribute('data-tag');
        App.refresh();
      });

      var selBar = U.dom('<div id="g-selbar" class="card tight row wrap" style="display:none"></div>');
      body.appendChild(selBar);

      var gridBox = U.dom('<div id="g-grid"></div>');
      body.appendChild(gridBox);

      var fab = U.dom(
        '<div class="row mt12" style="gap:8px">' +
        T('<button class="btn ghost grow" data-a="cam2">📷 拍照识别</button>') +
        T('<button class="btn grow" data-a="add2">＋ 从相册导入</button></div>'));
      body.appendChild(fab);
      fab.addEventListener('click', function (e) {
        var b = e.target.closest('[data-a]');
        if (!b) return;
        importImages(b.getAttribute('data-a') === 'cam2' ? 'camera' : 'gallery');
      });

      function paintGrid(box) {
        box.innerHTML = '';
        var list2 = filter(list);
        if (!list2.length) {
          box.appendChild(U.dom(
            '<div class="empty"><div class="big">🖼</div><h3>' +
            (list.length ? T('没有匹配的图片') : T('还没有图片')) + '</h3>' +
            '<p>' + (list.length
              ? T('换个关键词或标签试试')
              : T('给家里的每个房间、桌上的每件物品拍张照，<br>让它们在记忆宫殿里变成你的「地点桩」。')) +
            '</p></div>'));
          paintSelBar();
          return;
        }
        var grid = U.dom('<div class="grid"></div>');
        list2.forEach(function (im) {
          var t = U.dom(
            '<div class="tile' + (state.sel[im.id] ? ' sel' : '') + '" data-id="' + im.id + '">' +
            '<img loading="lazy" src="' + im.dataUrl + '" alt="">' +
            (state.select ? '<span class="check"></span>' : '') +
            ((im.words && im.words.length)
              ? '<span class="badge">' + im.words.length + T(' 词</span>') : '') +
            '<span class="cap">' + U.esc(im.title || (im.tags || []).join(' · ') || T('未命名')) + '</span>' +
            '</div>');
          grid.appendChild(t);
        });
        box.appendChild(grid);
        paintSelBar();

        grid.addEventListener('click', function (e) {
          var t = e.target.closest('.tile');
          if (!t) return;
          var id = t.getAttribute('data-id');
          if (state.select) {
            state.sel[id] = !state.sel[id];
            t.classList[state.sel[id] ? 'add' : 'remove']('sel');
            paintSelBar();
          } else {
            openImage(id);
          }
        });
      }

      function paintSelBar() {
        var ids = Object.keys(state.sel).filter(function (k) { return state.sel[k]; });
        if (!state.select || !ids.length) { selBar.style.display = 'none'; return; }
        selBar.style.display = 'flex';
        selBar.innerHTML =
          T('<span class="grow small">已选 ') + ids.length + T(' 张</span>') +
          T('<button class="btn sm line" data-a="tag">加标签</button>') +
          T('<button class="btn sm line" data-a="palace" style="margin-left:6px">进宫殿</button>') +
          T('<button class="btn sm danger" data-a="del" style="margin-left:6px">删除</button>');
      }

      selBar.addEventListener('click', function (e) {
        var b = e.target.closest('[data-a]');
        if (!b) return;
        var ids = Object.keys(state.sel).filter(function (k) { return state.sel[k]; });
        if (!ids.length) return;
        var a = b.getAttribute('data-a');
        if (a === 'tag') {
          UIKit.tagEditor(T('给 ') + ids.length + T(' 张图片加标签'), []).then(function (tags) {
            if (!tags || !tags.length) return;
            return Promise.all(ids.map(function (id) {
              return Store.getImage(id).then(function (im) {
                if (!im) return null;
                var s = {};
                (im.tags || []).concat(tags).forEach(function (t) { s[t] = 1; });
                im.tags = Object.keys(s);
                return Store.putImage(im);
              });
            })).then(function () { U.toast(T('标签已更新')); App.refresh(); });
          });
        } else if (a === 'palace') {
          choosePalace(ids);
        } else if (a === 'del') {
          U.confirmBox(T('删除图片'), T('将同时解除与卡片、地点桩的关联（单词卡片不会被删除）。'), T('删除'))
            .then(function (ok) {
              if (!ok) return;
              return Promise.all(ids.map(function (id) { return removeImage(id); }))
                .then(function () {
                  state.sel = {};
                  state.select = false;
                  U.toast(T('已删除'));
                  App.refresh();
                });
            });
        }
      });

      paintGrid(gridBox);
    });
  }

  function collectTags(list) {
    var seen = {}, out = [];
    (Store.settings.tags || []).forEach(function (t) { if (t && !seen[t]) { seen[t] = 1; out.push(t); } });
    list.forEach(function (im) {
      (im.tags || []).forEach(function (t) { if (t && !seen[t]) { seen[t] = 1; out.push(t); } });
    });
    return out;
  }

  function filter(list) {
    var q = state.q.toLowerCase();
    return list.filter(function (im) {
      if (state.tag && (im.tags || []).indexOf(state.tag) < 0) return false;
      if (!q) return true;
      var hay = [im.title, im.note, im.ocrText, (im.tags || []).join(' '),
        (im.words || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  function removeImage(id) {
    return Store.delImage(id).then(function () {
      return Store.listPalaces().then(function (ps) {
        return Promise.all(ps.map(function (p) {
          var changed = false;
          (p.loci || []).forEach(function (l) {
            if (l.imageId === id) { l.imageId = ''; changed = true; }
          });
          return changed ? Store.putPalace(p) : null;
        }));
      });
    });
  }

  /* ============================== 导入图片 ============================== */

  function importImages(source) {
    U.toast(source === 'camera' ? T('正在打开相机…') : T('正在打开相册…'), 1200);
    UIKit.pickImages(source).then(function (imgs) {
      if (!imgs.length) return;
      var tags = state.tag ? [state.tag] : [];
      return Promise.all(imgs.map(function (im) {
        return Store.addImage({ dataUrl: im.dataUrl, tags: tags });
      })).then(function (added) {
        U.toast(T('已导入 ') + added.length + T(' 张'));
        U.haptic();
        App.refresh();
        // 单张时直接进入详情，方便立刻打标签 / 识别
        if (added.length === 1) openImage(added[0].id);
      });
    });
  }

  /* ============================== 图片详情 ============================== */

  function openImage(id) {
    Promise.all([Store.getImage(id), Store.cardMap()]).then(function (r) {
      var im = r[0], cmap = r[1];
      if (!im) { U.toast(T('图片不存在')); return; }

      App.push(function (el, opts) {
        App.setBar(T('图片详情'), U.fmtAgo(im.createdAt), [
          { key: 'del', label: T('删除'), onClick: del }
        ]);

        var wrap = U.dom('<div></div>');
        wrap.appendChild(U.dom('<img class="preview" src="' + im.dataUrl + '" alt="">'));

        // 标题
        var titleCard = U.dom(
          '<div class="card tight mt12">' +
          T('<div class="row between"><span class="muted small">标题</span>') +
          T('<button class="btn sm ghost" data-a="title">编辑</button></div>') +
          '<div id="im-title" style="font-size:16px;font-weight:600">' +
          U.esc(im.title || T('（未命名）')) + '</div></div>');
        wrap.appendChild(titleCard);

        // 标签
        var tagCard = U.dom('<div class="card tight mt12"></div>');
        function paintTags() {
          tagCard.innerHTML = T('<div class="row between"><span class="muted small">标签</span>') +
            T('<button class="btn sm ghost" data-a="tags">编辑</button></div>') +
            '<div class="row wrap mt8" id="im-tags"></div>';
          var box = U.$('#im-tags', tagCard);
          box.innerHTML = (im.tags && im.tags.length)
            ? im.tags.map(function (t) { return '<span class="chip brand">' + U.esc(t) + '</span>'; }).join('')
            : T('<span class="muted small">还没有标签，加上「客厅 / 桌面」这类地点标签更好找</span>');
        }
        paintTags();
        wrap.appendChild(tagCard);

        // 关联单词
        var wordCard = U.dom('<div class="card tight mt12"></div>');
        function paintWords() {
          var list = (im.words || []).map(function (w) { return { w: w, c: cmap[w] }; });
          wordCard.innerHTML =
            T('<div class="row between"><span class="muted small">关联单词 (') + list.length + ')</span>' +
            T('<span><button class="btn sm ghost" data-a="addword">＋ 加词</button>') +
            T('<button class="btn sm ghost" data-a="scan" style="margin-left:6px">识图取词</button></span></div>') +
            (list.length
              ? '<div class="row wrap mt8">' + list.map(function (o) {
                  return '<span class="chip tap' + (o.c ? ' brand' : '') + '" data-w="' + U.attr(o.w) + '">' +
                    U.esc(o.w) + (o.c ? ' · ' + (o.c.state === 'new' ? T('新') : o.c.interval + 'd') : '') + '</span>';
                }).join('') + '</div>'
              : T('<div class="muted small mt8">还没有挂单词。挂上单词后，复习时这张图就会成为回忆的线索。</div>'));
        }
        paintWords();
        wrap.appendChild(wordCard);

        // OCR 文本
        var ocrCard = U.dom(
          '<div class="card tight mt12">' +
          T('<div class="row between"><span class="muted small">识别文字</span>') +
          T('<button class="btn sm ghost" data-a="ocr">重新识别</button></div>') +
          '<div id="im-ocr" class="small mt8" style="white-space:pre-wrap;max-height:170px;overflow:auto;color:var(--text-2)">' +
          U.esc(im.ocrText || T('（暂无，点「重新识别」提取图中英文）')) + '</div>' +
          '<div id="im-ocr-words" class="row wrap mt8"></div>' +
          '</div>');
        wrap.appendChild(ocrCard);

        // 宫殿
        var palCard = U.dom(
          '<div class="card tight mt12">' +
          T('<div class="row between"><span class="muted small">记忆宫殿</span>') +
          T('<button class="btn sm ghost" data-a="palace">加入地点桩</button></div>') +
          '<div id="im-pal" class="small mt8 muted">' +
          (im.palaceId ? T('已加入宫殿') : T('把图片设为地点桩，让单词挂在熟悉的位置上')) + '</div></div>');
        wrap.appendChild(palCard);

        var ops = U.dom('<div class="row mt12" style="gap:8px">' +
          T('<button class="btn grow ghost" data-a="speakAll">🔊 朗读全部单词</button>') +
          '</div>');
        wrap.appendChild(ops);

        el.appendChild(wrap);

        el.addEventListener('click', function (e) {
          var b = e.target.closest('[data-a],[data-w]');
          if (!b) return;
          var w = b.getAttribute('data-w');
          if (w) { UIKit.wordSheet(w, { imageId: im.id, source: 'image', onChanged: refreshAll }); return; }
          var a = b.getAttribute('data-a');
          if (a === 'title') editTitle();
          else if (a === 'tags') editTags();
          else if (a === 'addword') addWords();
          else if (a === 'scan') scanThis();
          else if (a === 'ocr') doOcr();
          else if (a === 'palace') choosePalace([im.id]);
          else if (a === 'speakAll') speakAll();
        });

        function refreshAll() {
          Promise.all([Store.getImage(id), Store.cardMap(true)]).then(function (r2) {
            im = r2[0]; cmap = r2[1];
            paintTags(); paintWords();
          });
        }

        function editTitle() {
          U.promptBox(T('图片标题'), im.title, T('例如：书桌上的马克杯')).then(function (v) {
            if (v === null) return;
            im.title = v;
            return Store.putImage(im).then(function () {
              U.$('#im-title', wrap).textContent = v || T('（未命名）');
            });
          });
        }

        function editTags() {
          UIKit.tagEditor(T('编辑标签'), im.tags || []).then(function (tags) {
            if (!tags) return;
            im.tags = tags;
            Store.putImage(im).then(paintTags);
          });
        }

        function doOcr() {
          var box = U.$('#im-ocr', ocrCard);
          box.innerHTML = T('<span class="spinner"></span> 正在离线识别…');
          Bridge.ocr(im.dataUrl).then(function (r) {
            if (!r.ok) {
              box.innerHTML = T('<span style="color:#a33248">识别失败：') + U.esc(r.error || T('未知错误')) + '</span>';
              return;
            }
            im.ocrText = r.text || '';
            Store.putImage(im);
            box.textContent = im.ocrText || T('（没有识别到文字）');
            paintOcrWords();
          });
        }

        function paintOcrWords() {
          var box = U.$('#im-ocr-words', ocrCard);
          var words = U.extractWords(im.ocrText || '');
          if (!words.length) { box.innerHTML = ''; return; }
          box.innerHTML = T('<span class="muted small" style="width:100%">识别到 ') + words.length +
            T(' 个英文词（点击查看释义）：</span>') +
            words.slice(0, 40).map(function (w) {
              var e = Dict.lemma(w);
              return '<span class="chip tap' + (e ? ' brand' : '') + '" data-ow="' + U.attr(w) + '">' +
                U.esc(w) + '</span>';
            }).join('') +
            T('<button class="btn sm ghost" data-ocrall="1" style="margin-left:6px">全部挂到本图</button>');
          box.addEventListener('click', function (e) {
            var c = e.target.closest('[data-ow]');
            if (c) {
              UIKit.wordSheet(c.getAttribute('data-ow'), { imageId: im.id, source: 'ocr', onChanged: refreshAll });
              return;
            }
            if (e.target.closest('[data-ocrall]')) {
              var list = words.slice(0, 40);
              Promise.all(list.map(function (w) {
                return UIKit.addWord(w, { imageId: im.id, source: 'ocr' });
              })).then(function () {
                im.words = unionArr(im.words, list);
                return Store.putImage(im);
              }).then(function () {
                U.toast(T('已挂 ') + list.length + T(' 个词'));
                App.updateDueDot();
                refreshAll();
              });
            }
          });
        }

        function addWords() {
          var box = U.dom(T('<div><input type="text" id="aw-q" placeholder="输入英文或中文搜索词库">') +
            '<div id="aw-res" class="mt8"></div></div>');
          var h = U.openSheet({ title: T('添加单词到本图'), body: box });
          var input = U.$('#aw-q', box);
          var res = U.$('#aw-res', box);
          var run = U.debounce(function () {
            var q = input.value.trim();
            if (!q) { res.innerHTML = ''; return; }
            var list = Dict.search(q, { limit: 20 });
            res.innerHTML = list.length ? list.map(function (e) {
              return '<div class="list-item" data-w="' + U.attr(e.word) + '">' +
                '<div class="li-main"><div class="li-title">' + U.esc(e.word) + '</div>' +
                '<div class="li-sub ellipsis">' + U.esc(e.trans) + '</div></div>' +
                '<span class="li-arrow">＋</span></div>';
            }).join('') : T('<div class="muted small">词库中没有匹配项</div>');
          }, 180);
          input.addEventListener('input', run);
          setTimeout(function () { try { input.focus(); } catch (e) {} }, 150);
          res.addEventListener('click', function (e) {
            var it = e.target.closest('[data-w]');
            if (!it) return;
            var w = it.getAttribute('data-w');
            UIKit.addWord(w, { imageId: im.id, source: 'manual' }).then(function () {
              im.words = unionArr(im.words, [w]);
              return Store.putImage(im);
            }).then(function () {
              U.toast(T('已添加 ') + w);
              App.updateDueDot();
              refreshAll();
            });
          });
        }

        function scanThis() {
          var h = U.openSheet({
            title: T('识别图片中的英文'),
            body: T('<div class="loading-box"><span class="spinner lg"></span><div class="mt8">离线 OCR 解析中…</div></div>')
          });
          Bridge.ocr(im.dataUrl).then(function (r) {
            h.close();
            if (!r.ok) { U.toast(T('识别失败：') + (r.error || '')); return; }
            im.ocrText = r.text || '';
            Store.putImage(im).then(function () {
              U.$('#im-ocr', ocrCard).textContent = im.ocrText || T('（没有识别到文字）');
              paintOcrWords();
              U.toast(T('识别完成'));
            });
          });
        }

        function speakAll() {
          var ws = (im.words || []).slice(0, 20);
          if (!ws.length) { U.toast(T('还没有关联单词')); return; }
          ws.forEach(function (w, i) {
            setTimeout(function () { Bridge.speak(w); }, i * 1100);
          });
        }

        function choosePalace(imageIds) {
          Store.listPalaces().then(function (ps) {
            var body = U.dom('<div>' +
              (ps.length ? '' : T('<div class="muted small mb8">还没有宫殿，先创建一个吧</div>')) +
              ps.map(function (p) {
                return '<div class="list-item" data-p="' + p.id + '">' +
                  '<div class="li-main"><div class="li-title">' + U.esc(p.name) + '</div>' +
                  '<div class="li-sub">' + (p.loci || []).length + T(' 个地点桩</div></div>') +
                  '<span class="li-arrow">›</span></div>';
              }).join('') +
              T('<button class="btn block ghost mt12" data-new="1">＋ 新建宫殿</button></div>'));
            var h = U.openSheet({ title: T('选择宫殿'), body: body });
            body.addEventListener('click', function (e) {
              if (e.target.closest('[data-new]')) {
                h.close();
                newPalace().then(function (p) { if (p) addToPalace(p.id, imageIds); });
                return;
              }
              var it = e.target.closest('[data-p]');
              if (!it) return;
              var pid = it.getAttribute('data-p');
              h.close();
              addToPalace(pid, imageIds);
            });
          });
        }

        function addToPalace(pid, ids) {
          Store.getPalace(pid).then(function (p) {
            if (!p) return;
            p.loci = p.loci || [];
            ids.forEach(function (iid) {
              var exists = p.loci.some(function (l) { return l.imageId === iid; });
              if (!exists) {
                p.loci.push({ id: U.uid('loc'), title: T('地点 ') + (p.loci.length + 1), imageId: iid, words: [], note: '' });
              }
            });
            return Store.putPalace(p).then(function () {
              return Promise.all(ids.map(function (iid) {
                return Store.getImage(iid).then(function (x) {
                  if (!x) return null;
                  x.palaceId = pid;
                  return Store.putImage(x);
                });
              }));
            });
          }).then(function () {
            U.toast(T('已加入宫殿'));
            U.haptic();
            refreshAll();
          });
        }

        // 初始：自动提取 OCR 词
        if (im.ocrText) paintOcrWords();
      });   // end App.push

      function del() {
        U.confirmBox(T('删除图片'), T('将同时解除与卡片、地点桩的关联。'), T('删除')).then(function (ok) {
          if (!ok) return;
          removeImage(id).then(function () {
            U.toast(T('已删除'));
            App.pop();
            App.refresh();
          });
        });
      }
    });
  }

  function unionArr(a, b) {
    var out = (a || []).slice();
    (b || []).forEach(function (x) { if (out.indexOf(x) < 0) out.push(x); });
    return out;
  }

  /* ============================== 宫殿 ============================== */

  function renderPalaces(body) {
    Store.listPalaces().then(function (ps) {
      if (!ps.length) {
        body.appendChild(U.dom(
          T('<div class="empty"><div class="big">🏛</div><h3>还没有宫殿</h3>') +
          T('<p>记忆宫殿的原理：把要记的单词挂在你熟悉的路线上的固定位置。<br>') +
          T('先建一座「我的家」，把客厅、书桌、床头依次变成地点桩。</p>') +
          T('<button class="btn" id="p-new">创建第一座宫殿</button></div>')));
        U.$('#p-new', body).addEventListener('click', newPalace);
        return;
      }
      var box = U.dom('<div></div>');
      ps.forEach(function (p) {
        var words = 0;
        (p.loci || []).forEach(function (l) { words += (l.words || []).length; });
        var card = U.dom(
          '<div class="card" data-p="' + p.id + '">' +
          '<div class="row between">' +
            '<div class="grow"><div class="bold" style="font-size:16px">' + U.esc(p.name) + '</div>' +
            '<div class="muted small mt8">' + (p.loci || []).length + T(' 个地点桩 · ') + words + T(' 个单词</div></div>') +
            '<span class="li-arrow">›</span>' +
          '</div>' +
          (p.desc ? '<div class="small muted mt8">' + U.esc(p.desc) + '</div>' : '') +
          '</div>');
        box.appendChild(card);
      });
      body.appendChild(box);
      box.addEventListener('click', function (e) {
        var c = e.target.closest('[data-p]');
        if (c) openPalace(c.getAttribute('data-p'));
      });
    });
  }

  function newPalace() {
    return U.promptBox(T('新建宫殿'), '', T('例如：我的家 / 公司 / 校园路线')).then(function (name) {
      if (name === null) return null;
      if (!name) name = T('未命名宫殿');
      return Store.addPalace(name, '').then(function (p) {
        U.toast(T('已创建'));
        App.refresh();
        return p;
      });
    });
  }

  function openPalace(pid) {
    Store.getPalace(pid).then(function (p) {
      if (!p) return;
      App.push(function (el, opts) {
        Promise.all([Store.getPalace(pid), Store.listImages()]).then(function (r) {
          var palace = r[0], images = r[1];
          var imgMap = {};
          images.forEach(function (im) { imgMap[im.id] = im; });

          App.setBar(palace.name, (palace.loci || []).length + T(' 个地点桩'), [
            { key: 'review', label: T('复习'), onClick: startReview },
            { key: 'more', label: '⋯', onClick: moreMenu }
          ]);

          var wrap = U.dom('<div></div>');
          wrap.appendChild(U.dom(
            T('<div class="card tight"><div class="muted small">宫殿说明</div>') +
            '<div id="pl-desc" class="mt8 small">' + U.esc(palace.desc || T('（点击「⋯」编辑，建议写下这条记忆路线的顺序）')) + '</div></div>'));

          var listBox = U.dom('<div class="card"></div>');
          function paint() {
            var loci = palace.loci || [];
            listBox.innerHTML = T('<div class="muted small mb8">按顺序走过这些地点，回忆每个位置上挂的单词</div>') +
              (loci.length
                ? loci.map(function (l, i) {
                    var im = imgMap[l.imageId];
                    return '<div class="loci" data-l="' + l.id + '">' +
                      '<span class="idx">' + (i + 1) + '</span>' +
                      (im ? '<img src="' + im.dataUrl + '" alt="">' : '<span class="idx" style="background:#cbd6e2">＋</span>') +
                      '<div class="grow" style="min-width:0">' +
                        '<div class="ellipsis" style="font-size:14.5px;font-weight:500">' + U.esc(l.title) + '</div>' +
                        '<div class="muted xsmall ellipsis">' +
                          ((l.words && l.words.length) ? l.words.join(', ') : T('还没有挂单词')) + '</div>' +
                      '</div>' +
                      '<div class="ops">' +
                        '<button data-mv="-1" data-lid="' + l.id + '">↑</button>' +
                        '<button data-mv="1" data-lid="' + l.id + '">↓</button>' +
                      '</div>' +
                    '</div>';
                  }).join('')
                : T('<div class="muted small">还没有地点桩。点下面的按钮，把客厅、书桌、床头的照片依次加进来。</div>'));
          }
          paint();
          wrap.appendChild(listBox);

          wrap.appendChild(U.dom(
            '<div class="row mt12" style="gap:8px">' +
            T('<button class="btn grow ghost" data-a="pickfrom">从图库选地点</button>') +
            T('<button class="btn grow" data-a="shoot">📷 拍一个新地点</button>') +
            '</div>'));
          wrap.appendChild(U.dom(
            T('<button class="btn block ok mt12" data-a="start">开始宫殿复习</button>')));

          el.appendChild(wrap);

          el.addEventListener('click', function (e) {
            var mv = e.target.closest('[data-mv]');
            if (mv) {
              var lid = mv.getAttribute('data-lid');
              var dir = parseInt(mv.getAttribute('data-mv'), 10);
              var idx = -1;
              palace.loci.forEach(function (l, i) { if (l.id === lid) idx = i; });
              var to = idx + dir;
              if (idx < 0 || to < 0 || to >= palace.loci.length) return;
              var tmp = palace.loci[idx];
              palace.loci[idx] = palace.loci[to];
              palace.loci[to] = tmp;
              Store.putPalace(palace).then(paint);
              return;
            }
            var lc = e.target.closest('[data-l]');
            if (lc) { openLocus(lc.getAttribute('data-l')); return; }
            var b = e.target.closest('[data-a]');
            if (!b) return;
            var a = b.getAttribute('data-a');
            if (a === 'pickfrom') pickFromGallery();
            else if (a === 'shoot') shoot();
            else if (a === 'start') startReview();
          });

          function reload() {
            return Store.getPalace(pid).then(function (pp) {
              palace = pp;
              paint();
            });
          }

          function shoot() {
            UIKit.pickImages('camera').then(function (imgs) {
              if (!imgs.length) return;
              var im = imgs[0];
              Store.addImage({ dataUrl: im.dataUrl, tags: [palace.name] }).then(function (added) {
                palace.loci = palace.loci || [];
                palace.loci.push({
                  id: U.uid('loc'), title: T('地点 ') + (palace.loci.length + 1),
                  imageId: added.id, words: [], note: ''
                });
                return Store.putPalace(palace);
              }).then(function () {
                U.toast(T('已添加地点桩'));
                return Promise.all([Store.getPalace(pid), Store.listImages()]);
              }).then(function (r2) {
                palace = r2[0];
                imgMap = {};
                r2[1].forEach(function (x) { imgMap[x.id] = x; });
                paint();
              });
            });
          }

          function pickFromGallery() {
            var chosen = {};
            var body = U.dom('<div><div id="pf-grid" class="grid"></div></div>');
            function paintGrid() {
              U.$('#pf-grid', body).innerHTML = images.map(function (im) {
                var inPalace = (palace.loci || []).some(function (l) { return l.imageId === im.id; });
                return '<div class="tile' + (chosen[im.id] ? ' sel' : '') + '" data-id="' + im.id + '">' +
                  '<img loading="lazy" src="' + im.dataUrl + '">' +
                  '<span class="check"></span>' +
                  (inPalace ? T('<span class="badge">已在宫殿</span>') : '') +
                  '<span class="cap">' + U.esc(im.title || T('未命名')) + '</span></div>';
              }).join('') || T('<div class="muted small">图库还是空的，先去「图库」导入照片</div>');
            }
            paintGrid();
            var h = U.openSheet({
              title: T('选择地点桩图片'),
              body: body,
              footer: T('<div class="sheet-foot"><button class="btn block" data-ok="1">加入宫殿</button></div>')
            });
            body.addEventListener('click', function (e) {
              var t = e.target.closest('.tile');
              if (!t) return;
              var id = t.getAttribute('data-id');
              chosen[id] = !chosen[id];
              t.classList[chosen[id] ? 'add' : 'remove']('sel');
            });
            h.el.addEventListener('click', function (e) {
              if (!e.target.closest('[data-ok]')) return;
              var ids = Object.keys(chosen).filter(function (k) { return chosen[k]; });
              if (!ids.length) { h.close(); return; }
              palace.loci = palace.loci || [];
              ids.forEach(function (iid) {
                if (palace.loci.some(function (l) { return l.imageId === iid; })) return;
                palace.loci.push({ id: U.uid('loc'), title: T('地点 ') + (palace.loci.length + 1), imageId: iid, words: [], note: '' });
              });
              Store.putPalace(palace).then(function () {
                ids.forEach(function (iid) {
                  Store.getImage(iid).then(function (x) {
                    if (x) { x.palaceId = pid; Store.putImage(x); }
                  });
                });
                h.close();
                U.toast(T('已加入 ') + ids.length + T(' 个地点桩'));
                reload();
              });
            });
          }

          function openLocus(lid) {
            var locus = null;
            (palace.loci || []).forEach(function (l) { if (l.id === lid) locus = l; });
            if (!locus) return;
            App.push(function (el2) {
              App.setBar(locus.title, T('地点桩'), [
                { key: 'del', label: T('删除'), onClick: function () {
                  U.confirmBox(T('删除地点桩'), T('只会删除这个位置，单词卡片会保留。'), T('删除')).then(function (ok) {
                    if (!ok) return;
                    palace.loci = (palace.loci || []).filter(function (l) { return l.id !== lid; });
                    Store.putPalace(palace).then(function () { App.pop(); reload(); });
                  });
                } }
              ]);

              var im = imgMap[locus.imageId];
              var wrap = U.dom('<div></div>');
              if (im) wrap.appendChild(U.dom('<img class="preview" src="' + im.dataUrl + '">'));
              wrap.appendChild(U.dom('<button class="btn block ghost mt12" data-a="img">' +
                (im ? T('更换图片') : T('选择图片')) + '</button>'));
              wrap.appendChild(U.dom(T('<button class="btn block line mt12" data-a="rename">重命名地点</button>')));

              var wbox = U.dom('<div class="card mt12"></div>');
              function paintW() {
                var ws = locus.words || [];
                wbox.innerHTML = T('<div class="row between"><span class="muted small">挂在这个位置的单词</span>') +
                  T('<button class="btn sm ghost" data-a="addw">＋ 加词</button></div>') +
                  (ws.length
                    ? '<div class="row wrap mt8">' + ws.map(function (w) {
                        return '<span class="chip tap brand" data-w="' + U.attr(w) + '">' + U.esc(w) + '</span>';
                      }).join('') + '</div>'
                    : T('<div class="muted small mt8">还没有单词。用「识图」从照片里取词，或在词典里搜索后挂到这里。</div>')) +
                  T('<button class="btn block ok mt12" data-a="clearlink">解除该地点的全部单词</button>');
              }
              paintW();
              wrap.appendChild(wbox);

              var ocrBox = U.dom('<div class="card mt12"><div class="row between">' +
                T('<span class="muted small">从图片识别单词</span>') +
                T('<button class="btn sm ghost" data-a="ocr">识别并挂词</button></div>') +
                '<div id="lc-ocr" class="small muted mt8">' +
                (im && im.ocrText ? U.esc(im.ocrText.slice(0, 160)) : T('（未识别）')) + '</div></div>');
              wrap.appendChild(ocrBox);

              el2.appendChild(wrap);

              el2.addEventListener('click', function (e) {
                var wc = e.target.closest('[data-w]');
                if (wc) {
                  UIKit.wordSheet(wc.getAttribute('data-w'), {
                    imageId: locus.imageId, palaceId: pid, source: 'palace', onChanged: paintW
                  });
                  return;
                }
                var b = e.target.closest('[data-a]');
                if (!b) return;
                var a = b.getAttribute('data-a');
                if (a === 'rename') {
                  U.promptBox(T('地点名称'), locus.title, T('例如：书桌 / 床头 / 厨房冰箱')).then(function (v) {
                    if (v === null) return;
                    locus.title = v || locus.title;
                    Store.putPalace(palace).then(function () {
                      App.setBar(locus.title, T('地点桩'));
                      App.pop();
                      openPalace(pid);
                    });
                  });
                } else if (a === 'img') {
                  var chosen = null;
                  var body = U.dom('<div class="grid"></div>');
                  body.innerHTML = images.map(function (x) {
                    return '<div class="tile' + (x.id === locus.imageId ? ' sel' : '') + '" data-id="' + x.id + '">' +
                      '<img loading="lazy" src="' + x.dataUrl + '"><span class="cap">' + U.esc(x.title || T('未命名')) + '</span></div>';
                  }).join('');
                  var h = U.openSheet({ title: T('选择图片'), body: body });
                  body.addEventListener('click', function (e) {
                    var t = e.target.closest('.tile');
                    if (!t) return;
                    locus.imageId = t.getAttribute('data-id');
                    Store.putPalace(palace).then(function () {
                      h.close();
                      App.pop();
                      openPalace(pid);
                    });
                  });
                } else if (a === 'addw') {
                  var box = U.dom(T('<div><input type="text" id="lw-q" placeholder="搜索词库，点击添加">') +
                    '<div id="lw-res" class="mt8"></div></div>');
                  var hh = U.openSheet({ title: T('挂单词到「') + locus.title + '」', body: box });
                  var input = U.$('#lw-q', box), res = U.$('#lw-res', box);
                  var run = U.debounce(function () {
                    var q = input.value.trim();
                    if (!q) { res.innerHTML = ''; return; }
                    var list = Dict.search(q, { limit: 18 });
                    res.innerHTML = list.map(function (x) {
                      return '<div class="list-item" data-w="' + U.attr(x.word) + '">' +
                        '<div class="li-main"><div class="li-title">' + U.esc(x.word) + '</div>' +
                        '<div class="li-sub ellipsis">' + U.esc(x.trans) + '</div></div>' +
                        '<span class="li-arrow">＋</span></div>';
                    }).join('') || T('<div class="muted small">没有匹配项</div>');
                  }, 180);
                  input.addEventListener('input', run);
                  res.addEventListener('click', function (e) {
                    var it = e.target.closest('[data-w]');
                    if (!it) return;
                    var w = it.getAttribute('data-w');
                    UIKit.addWordWithLocus(w, pid, locus.imageId, locus.title).then(function () {
                      locus.words = locus.words || [];
                      if (locus.words.indexOf(w) < 0) locus.words.push(w);
                      return Store.putPalace(palace);
                    }).then(function () {
                      U.toast(T('已挂上 ') + w);
                      App.updateDueDot();
                      paintW();
                    });
                  });
                } else if (a === 'clearlink') {
                  locus.words = [];
                  Store.putPalace(palace).then(function () {
                    U.toast(T('已解除'));
                    paintW();
                  });
                } else if (a === 'ocr') {
                  if (!im) { U.toast(T('先选择一张图片')); return; }
                  U.$('#lc-ocr', ocrBox).innerHTML = T('<span class="spinner"></span> 识别中…');
                  Bridge.ocr(im.dataUrl).then(function (r) {
                    if (!r.ok) { U.$('#lc-ocr', ocrBox).textContent = T('识别失败：') + (r.error || ''); return; }
                    im.ocrText = r.text || '';
                    Store.putImage(im);
                    var words = U.extractWords(r.text || '').slice(0, 30);
                    if (!words.length) { U.$('#lc-ocr', ocrBox).textContent = T('没有识别到英文单词'); return; }
                    Promise.all(words.map(function (w) {
                      return UIKit.addWord(w, { imageId: im.id, palaceId: pid, source: 'ocr' });
                    })).then(function () {
                      locus.words = unionArr(locus.words, words);
                      return Store.putPalace(palace);
                    }).then(function () {
                      U.$('#lc-ocr', ocrBox).textContent = T('已识别并挂上 ') + words.length + T(' 个词');
                      App.updateDueDot();
                      paintW();
                    });
                  });
                }
              });
            });
          }

          function startReview() {
            var words = [];
            (palace.loci || []).forEach(function (l) {
              (l.words || []).forEach(function (w) { if (words.indexOf(w) < 0) words.push(w); });
            });
            if (!words.length) { U.toast(T('这座宫殿还没有单词')); return; }
            Review.startSession({ palaceId: pid, words: words, title: palace.name });
          }

          function moreMenu() {
            var body = U.dom('<div>' +
              T('<button class="btn block ghost mb8" data-a="rename">重命名宫殿</button>') +
              T('<button class="btn block ghost mb8" data-a="desc">编辑说明</button>') +
              T('<button class="btn block danger" data-a="del">删除这座宫殿</button></div>'));
            var h = U.openSheet({ title: T('宫殿设置'), body: body });
            body.addEventListener('click', function (e) {
              var b = e.target.closest('[data-a]');
              if (!b) return;
              var a = b.getAttribute('data-a');
              h.close();
              if (a === 'rename') {
                U.promptBox(T('宫殿名称'), palace.name, '').then(function (v) {
                  if (v === null) return;
                  palace.name = v || palace.name;
                  Store.putPalace(palace).then(function () { App.setBar(palace.name, (palace.loci || []).length + T(' 个地点桩')); });
                });
              } else if (a === 'desc') {
                U.promptBox(T('宫殿说明'), palace.desc, T('写下这条记忆路线的顺序')).then(function (v) {
                  if (v === null) return;
                  palace.desc = v;
                  Store.putPalace(palace).then(function () {
                    U.$('#pl-desc', wrap).textContent = v || T('（无）');
                  });
                });
              } else if (a === 'del') {
                U.confirmBox(T('删除宫殿'), T('地点桩与关联会一起删除，单词卡片会保留。'), T('删除')).then(function (ok) {
                  if (!ok) return;
                  Store.delPalace(pid).then(function () {
                    App.pop();
                    U.toast(T('已删除'));
                  });
                });
              }
            });
          }
        });
      });
    });
  }

  /* ============================== 注册 ============================== */

  App.register('gallery', {
    title: '图库',
    sub: '拍下地点，挂上单词',
    actions: actions,
    render: render,
    onEnter: function () { }
  });
})(window);
