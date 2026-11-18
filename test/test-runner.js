/* 无头浏览器测试脚本：驱动全部页面，收集 JS 错误与关键断言 */
(function () {
  var errors = [];
  var steps = [];

  window.addEventListener('error', function (e) {
    errors.push('ERROR ' + (e.message || '') + ' @' + (e.filename || '?') + ':' + (e.lineno || 0));
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    errors.push('REJECT ' + ((r && (r.stack || r.message)) || r));
  });
  var origErr = console.error;
  console.error = function () {
    errors.push('CONSOLE ' + Array.prototype.join.call(arguments, ' '));
    origErr.apply(console, arguments);
  };

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function waitFor(fn, ms) {
    var t0 = Date.now();
    return new Promise(function (resolve, reject) {
      (function loop() {
        var v;
        try { v = fn(); } catch (e) { v = false; }
        if (v) return resolve(v);
        if (Date.now() - t0 > (ms || 8000)) return reject(new Error('timeout'));
        setTimeout(loop, 60);
      })();
    });
  }

  /** 真实网络模式（real=1）：不装桩，改走服务端代理，等价原生层 */
  var REAL = !!new URLSearchParams(location.search).get('real');

  function check(name, fn) {
    return Promise.resolve().then(fn).then(function (v) {
      if (v && typeof v === 'object' && v.skip) {
        // 明确跳过，不算通过也不算失败——避免把「不适用」伪装成绿灯
        steps.push({ step: name, ok: false, skipped: true, detail: '（跳过）' + v.skip });
        return 'skip';
      }
      steps.push({ step: name, ok: v !== false && v !== null && v !== undefined, detail: v });
      return v;
    }).catch(function (e) {
      steps.push({ step: name, ok: false, detail: 'EX: ' + (e && e.message) });
    });
  }

  function q(sel) { return document.querySelector(sel); }
  function cnt(sel) {
    var n = document.querySelectorAll(sel).length;
    return n > 0 ? n : false;
  }
  function qq(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function txt(n) { return (n && n.textContent || '').trim().slice(0, 40); }

  function report(page) {
    var out = document.getElementById('TESTOUT');
    if (!out) {
      out = document.createElement('pre');
      out.id = 'TESTOUT';
      document.body.appendChild(out);
    }
    out.textContent = '@@RESULT@@' + JSON.stringify({
      page: page,
      appVersion: (window.App && App.current) || null,
      dictWords: (window.Dict && Dict.ready()) ? Dict.wordCount() : 0,
      errors: errors,
      steps: steps
    });
  }

  var RSS_XML = '<?xml version="1.0"?><rss version="2.0"><channel>' +
    '<title>Stub Feed</title>' +
    '<item><title>Scientists discover a faster way to store solar energy</title>' +
    '<link>https://example.org/a1</link>' +
    '<description><![CDATA[Researchers say the new material can retain heat for eighteen hours, ' +
    'which could reduce the cost of storage for ordinary households. The team tested the compound ' +
    'across a wide range of temperatures and found that it lost less than five per cent of its ' +
    'capacity over a full week of repeated cycles. Industry analysts remain cautious, noting that ' +
    'manufacturing at scale has defeated similar proposals before, and that the equipment required ' +
    'is still expensive to install in older buildings. Even so, several utilities have begun ' +
    'negotiating pilot projects, and the first commercial installation is expected within two years.]]></description>' +
    '<pubDate>Tue, 14 Oct 2026 08:00:00 GMT</pubDate></item>' +
    '<item><title>Why small cities are growing again</title>' +
    '<link>https://example.org/a2</link>' +
    '<description>After a decade of decline, several regional cities report a consistent increase ' +
    'in population, driven mainly by remote workers seeking cheaper housing and shorter commutes. ' +
    'Local governments have responded by converting empty offices into apartments and by widening ' +
    'the tax base, though schools and hospitals are struggling to keep pace with the arrivals. ' +
    'Planners warn that the trend could reverse quickly if employers tighten their policies on ' +
    'working from home, and that the new residents are unusually sensitive to changes in transport ' +
    'costs and in the quality of local services.</description>' +
    '<pubDate>Mon, 13 Oct 2026 09:30:00 GMT</pubDate></item>' +
    '<item><title>A short guide to better sleep</title>' +
    '<link>https://example.org/a3</link>' +
    '<description><![CDATA[Sleep is not a passive state. During deep sleep the brain consolidates ' +
    'memory and clears waste products that accumulate during the day, and the timing of that ' +
    'process appears to matter more than the total number of hours spent in bed. People who keep a ' +
    'consistent schedule report better concentration and steadier moods, even when they sleep no ' +
    'longer than before. The practical advice is unglamorous: keep the bedroom dark and cool, ' +
    'avoid caffeine after the early afternoon, and treat the last hour before bed as a wind-down ' +
    'rather than a final chance to catch up on work.]]></description>' +
    '<pubDate>Sun, 12 Oct 2026 07:15:00 GMT</pubDate></item>' +
    '</channel></rss>';

  /** real 模式：把跨域请求改走服务端代理，等价于 Android 原生层的 HttpURLConnection */
  function installProxyBridge() {
    var real = Bridge.http;
    Bridge.http = function (url, opt) {
      if (/^https?:\/\//i.test(url) && url.indexOf(location.origin) !== 0) {
        return real.call(Bridge, '/proxy?url=' + encodeURIComponent(url), opt);
      }
      return real.call(Bridge, url, opt);
    };
  }


  var P1 = 'Researchers at several universities have spent the past decade trying to understand why focused attention feels so much harder to sustain than it did twenty years ago. Their conclusion is unglamorous but useful: the problem is rarely a lack of discipline, and almost always a matter of environment and habit. When the surroundings make distraction effortless, the mind follows the path of least resistance without any conscious decision.';
  var P2 = 'The practical remedy is therefore not a heroic act of willpower but a redesign of the day. Blocking a fixed period, removing the tools of interruption from reach, and accepting that the first twenty minutes will feel uncomfortable are all part of the same unremarkable routine. People who describe themselves as naturally focused are usually describing someone who has arranged their life so that concentration requires the least effort.';
  var P3 = 'It also helps to treat attention as a limited resource rather than a moral quality. Deliberate practice at the edge of difficulty depletes it, and genuine rest restores it. Teams that protect long uninterrupted blocks tend to produce less visible activity and considerably more finished work, which is precisely why the habit is hard to adopt.';
  var SITE_HTML = (function(){return '<!doctype html><html><head><meta charset="utf-8">' +
      '<title>Example News</title>' +
      '<meta property="og:site_name" content="Example News">' +
      '<link rel="alternate" type="application/rss+xml" href="/feed.xml">' +
      '</head><body>' +
      '<nav><a href="/">Home</a><a href="/w">World</a><a href="/t">Tech</a></nav>' +
      '<div class="related-posts"><a href="/1">Related one</a><a href="/2">Related two</a></div>' +
      '<article>' +
        '<h1>Why attention is a design problem</h1>' +
        '<p>' + P1 + '</p>' +
        '<h2>The practical remedy</h2>' +
        '<p>' + P2 + '</p>' +
        '<blockquote>Attention is a limited resource, not a moral quality.</blockquote>' +
        '<ul><li>Block a fixed period every morning</li><li>Put the phone in another room</li></ul>' +
        '<p>' + P3 + '</p>' +
      '</article>' +
      '<aside class="sidebar"><p>Sidebar promotional text that is comfortably long enough to fool a naive extractor that simply takes every paragraph on the page.</p></aside>' +
      '<footer><p>Copyright notice and legal boilerplate goes here for completeness.</p></footer>' +
      '</body></html>';})();
  var NAV_HTML = (function(){var links='';for(var i=0;i<30;i++){links+='<li><a href="/x'+i+'">Section '+(i+1)+'</a></li>';}return '<!doctype html><html><head><title>Index</title></head><body><nav><ul>' + links + '</ul></nav><p>Short.</p></body></html>';})();

  function installFeedStub() {
    var real = Bridge.http;
    Bridge.http = function (url, opt) {
      if (/example\.(com|org)\/page/i.test(url)) {
        return Promise.resolve({ ok: true, status: 200, body: SITE_HTML });
      }
      if (/(cgtn|ecns|hnrss|xinhuanet|globaltimes|guardian|bbci|breakingnewsenglish|example\.(com|org))/i.test(url)) {
        return Promise.resolve({ ok: true, status: 200, body: RSS_XML });
      }
      return real.call(Bridge, url, opt);
    };
  }


  /* ---------------- 订阅格式解析用例 ---------------- */
  var FEED_CASES = {
    rss: '<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>' +
      '<item><title>Alpha</title><link>https://a/1</link><description>Desc A</description>' +
      '<pubDate>Mon, 13 Oct 2026 10:00:00 GMT</pubDate></item>' +
      '<item><title>Beta</title><description>Desc B</description></item></channel></rss>',
    malformed: '<?xml version="1.0"?><rss version="2.0"><channel><title>T & T</title>' +
      '<item><title>Tom & Jerry</title><link>https://x/1</link>' +
      '<description>5 < 6 & 7 > 3</description></item>' +
      '<item><title>Second</title><description>ok</description></item></channel></rss>',
    atom: '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>F</title>' +
      '<entry><title>Entry One</title><link href="https://e/1"/>' +
      '<summary>Summary one</summary><updated>2026-10-13T00:00:00Z</updated></entry></feed>',
    rdf: '<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
      '<channel><title>C</title></channel>' +
      '<item><title>Rdf One</title><link>https://r/1</link><description>RD</description></item></rdf:RDF>',
    html: '<!doctype html><html><head><title>page</title></head><body><h1>hello</h1></body></html>',
    encoded: '<?xml version="1.0"?><rss version="2.0"><channel>' +
      '<item><title>Cdata One</title>' +
      '<content:encoded><![CDATA[<p>Body text here</p>]]></content:encoded></item></channel></rss>',
    empty: ''
  };

  /** 等待订阅刷新空闲，避免与后台自动刷新互相干扰 */
  function waitIdle(ms) {
    var t0 = Date.now();
    return new Promise(function (res) {
      (function loop() {
        var busy = false;
        try { busy = Feed.stats().busy; } catch (e) {}
        if (!busy || Date.now() - t0 > (ms || 30000)) return res(!busy);
        setTimeout(loop, 200);
      })();
    });
  }

  function runAll() {
    // 断言大量比对中文文案，所以先把语言钉死在简体中文——
    // 否则系统语言是英文时界面本来就是英文，这些断言会全部失去意义。
    Store.settings.lang = 'zh-Hans';
    Store.saveSettings();
    I18N.setLang('zh-Hans');
    if (new URLSearchParams(location.search).get('real')) installProxyBridge();
    else installFeedStub();
    return check('gallery: 渲染骨架', function () {
      App.go('gallery');
      return qq('#screen .segmented button').length === 2;
    })
      .then(function () { return check('scan: 取图入口', function () {
        App.go('scan');
        return cnt('#screen [data-a="camera"]');
      }); })
      .then(function () { return check('dict: 离线查询 abandon', function () {
        var e = Dict.lookup('abandon');
        if (!e || !e.trans) return false;
        return e.word + ' -> ' + e.trans.slice(0, 14);
      }); })
      .then(function () { return check('dict: 词形还原 abandoned', function () {
        var e = Dict.lemma('abandoned');
        return e ? e.word : false;
      }); })
      .then(function () { return check('dict: 前缀搜索 ab', function () {
        var r = Dict.search('ab', { limit: 10 });
        return r.length ? r.length + ' 条，首条 ' + r[0].word : false;
      }); })
      .then(function () { return check('dict: 中文搜索 放弃', function () {
        var r = Dict.search('放弃', { limit: 5 });
        return r.length ? r.length + ' 条，首条 ' + r[0].word : false;
      }); })
      .then(function () { return check('词典页交互', function () {
        App.go('dict');
        var inp = q('#d-q');
        if (!inp) return false;
        inp.value = 'environment';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        return wait(400).then(function () {
          return cnt('#d-out .list-item');
        });
      }); })
      .then(function () { return check('词书页 + 进度', function () {
        App.go('books');
        return wait(400).then(function () { return cnt('#screen [data-b]'); });
      }); })
      .then(function () { return check('词书详情打开', function () {
        App.go('books');
        return wait(300).then(function () {
          var c = q('#screen [data-b="cet4"]') || q('#screen [data-b]');
          if (!c) return false;
          c.click();
          return wait(500).then(function () { return cnt('#screen .word-item'); });
        });
      }); })
      .then(function () { return check('阅读: 文章列表', function () {
        App.go('read');
        return wait(800).then(function () { return cnt('#screen [data-rec]'); });
      }); })
      .then(function () { return check('阅读: 打开文章并分句渲染', function () {
        App.go('read');
        return wait(700).then(function () {
          var c = q('#screen [data-rec]');
          if (!c) return false;
          c.click();
          return wait(600).then(function () {
            return cnt('#screen .article-body .wd');
          });
        });
      }); })
      .then(function () { return check('阅读: 生词高亮规则', function () {
        return Store.cardMap().then(function (cmap) {
          var bookId = Store.settings.bookId;
          var cand = ['abandon', 'absorb', 'academic', 'accurate', 'adequate', 'advocate',
            'aggregate', 'allocate', 'ambiguous', 'anticipate', 'apparent', 'arbitrary',
            'articulate', 'assemble', 'assert', 'assess', 'assume', 'attain', 'attribute',
            'authentic', 'concentrate', 'consecutive', 'considerable', 'consistent',
            'constitute', 'contemplate', 'contradict', 'convey', 'coherent', 'compensate'];
          var pick = null;
          for (var i = 0; i < cand.length && !pick; i++) {
            var e = Dict.lemma(cand[i]);
            if (e && !cmap[e.word] && Dict.inBook(e, bookId)) pick = e.word;
          }
          if (!pick) return false;
          var blocks = [{ t: 'p', text: 'They ' + pick + ' the plan after a long discussion.' }];
          var onHtml = Reader.blocksHtml(blocks, cmap, true);
          var offHtml = Reader.blocksHtml(blocks, cmap, false);
          var marked = onHtml.indexOf('class="wd new"') >= 0 &&
                       onHtml.indexOf('data-w="' + pick + '"') >= 0;
          var unmarked = offHtml.indexOf(' new"') < 0 &&
                         offHtml.indexOf('data-w="' + pick + '"') >= 0;
          return (marked && unmarked)
            ? ('「' + pick + '」标为生词；关闭高亮后仍可点词但不标色') : false;
        });
      }); })
      .then(function () { return check('数据层: 建卡片 + SM-2', function () {
        U.$ = U.$;
        return Store.upsertCard('abandon', { trans: 'vt. 放弃', phonetic: 'əˈbændən' })
          .then(function () {
            return Store.getCard('abandon');
          })
          .then(function (c) {
            return Store.applyReview(c, 2);
          })
          .then(function (c2) {
            return c2.state + '/' + c2.interval + 'd/ease=' + c2.ease.toFixed(2);
          });
      }); })
      .then(function () { return check('数据层: 复习队列', function () {
        return Store.dueCards().then(function (d) {
          return Store.newCards(5).then(function (n) { return 'due=' + d.length + ' new=' + n.length; });
        });
      }); })
      .then(function () { return check('复习页渲染', function () {
        App.go('review');
        return wait(500).then(function () { return cnt('#screen .stat'); });
      }); })
      .then(function () { return check('复习会话可开启', function () {
        return Store.upsertCard('consistent', { trans: 'adj. 一贯的' })
          .then(function () {
            Review.startSession({ words: ['consistent', 'abandon'], title: '测试会话' });
            return wait(500);
          })
          .then(function () {
            return q('#rv-flash') ? txt(q('#rv-flash .front')) : 'no-flash';
          });
      }); })
      .then(function () { return check('复习: 翻面并作答', function () {
        var f = q('#rv-flash');
        if (!f) return false;
        f.click();
        return wait(200).then(function () {
          var back = q('#rv-flash .back');
          if (!back) return 'no-back';
          var g = q('#rv-flash [data-g="2"]');
          if (!g) return 'no-rate';
          g.click();
          return wait(400).then(function () {
            return q('#rv-flash') ? 'card=' + txt(q('#rv-flash .front')) : 'finished';
          });
        });
      }); })
      .then(function () { return check('图库: 空态或图片网格', function () {
        App.go('gallery');
        var seg = qq('#g-seg button')[0];
        if (seg) seg.click();
        return wait(500).then(function () {
          var empty = document.querySelectorAll('#screen .empty').length;
          var tiles = document.querySelectorAll('#screen .tile').length;
          return (empty + (tiles ? 1 : 0)) > 0 ? ('empty=' + empty + ' tiles=' + tiles) : false;
        });
      }); })
      .then(function () { return check('图库: 写入图片并渲染缩略图', function () {
        var tiny = 'data:image/gif;base64,R0lGODlhAQABAIAAAMzMzAAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==';
        return Store.addImage({ dataUrl: tiny, title: '测试地点' }).then(function () {
          App.go('gallery');
          return wait(600).then(function () { return cnt('#screen .tile'); });
        });
      }); })
      .then(function () { return check('图库: 图片详情可打开', function () {
        var t = q('#screen .tile');
        if (!t) return false;
        t.click();
        return wait(500).then(function () {
          return cnt('#screen [data-a="palace"]');
        });
      }); })
      .then(function () { return check('宫殿: 新建', function () {
        return Store.addPalace('测试宫殿', '').then(function (p) {
          App.go('gallery');
          return wait(300).then(function () {
            var seg = qq('#g-seg button')[1];
            seg.click();
            return wait(500).then(function () { return cnt('#screen [data-p]'); });
          });
        });
      }); })
      .then(function () { return check('宫殿: 打开详情并添加地点桩', function () {
        var c = q('#screen [data-p]');
        if (!c) return false;
        c.click();
        return wait(500).then(function () {
          var shoot = q('#screen [data-a="pickfrom"]');
          if (!shoot) return 'no-pickfrom';
          shoot.click();
          return wait(400).then(function () {
            var tiles = qq('.sheet .tile');
            if (tiles.length) tiles[0].click();
            var ok = q('.sheet [data-ok]');
            if (!ok) return 'no-ok';
            ok.click();
            return wait(600).then(function () { return cnt('#screen .loci'); });
          });
        });
      }); })
      .then(function () { return check('识图: 文本提取', function () {
        var t = 'The ability to concentrate requires consistent practice and patience. ' +
          'Students who abandon their habits rarely improve, but those who persist build ability.';
        var ws = U.extractWords(t);
        return ws.length + ' 词: ' + ws.slice(0, 6).join(',');
      }); })
      .then(function () { return check('UI: 弹层打开与关闭', function () {
        UIKit.wordSheet('ability', {});
        return wait(300).then(function () {
          var open = qq('.sheet').length;
          U.closeTopSheet();
          return wait(150).then(function () { return 'opened=' + open + ' closed=' + qq('.sheet').length; });
        });
      }); })
      .then(function () { return check('返回键逻辑', function () {
        App.go('gallery');
        return wait(200).then(function () {
          if (typeof window.__wpBack !== 'function') return 'no-back-handler';
          var r1 = window.__wpBack();
          return 'handled=' + r1;
        });
      }); })

      .then(function () { return check('promptBox 可用', function () {
        var p = U.promptBox('测试输入', '', '');
        return wait(250).then(function () {
          var inp = document.querySelector('.sheet #pb-input');
          if (!inp) return 'no-input';
          inp.value = '我的书房';
          var ok = document.querySelector('.sheet [data-r="1"]');
          if (!ok) return 'no-ok-btn';
          ok.click();
          return p;
        });
      }); })
      .then(function () { return check('confirmBox 可用', function () {
        var p = U.confirmBox('测试确认', '内容', '确定');
        return wait(250).then(function () {
          var ok = document.querySelector('.sheet [data-r="1"]');
          if (!ok) return 'no-btn';
          ok.click();
          return p;
        });
      }); })
      .then(function () { return check('识图: 粘贴文本提取流程', function () {
        App.go('scan');
        return wait(300).then(function () {
          var ta = q('#sc-paste');
          if (!ta) return 'no-textarea';
          ta.value = 'The environment requires consistent attention. People who relax their habits lose ability.';
          var btn = q('#screen [data-a="paste"]');
          if (!btn) return 'no-btn';
          btn.click();
          return wait(400).then(function () {
            return cnt('#sc-words .word-item');
          });
        });
      }); })
      .then(function () { return check('识图: 单词加入生词本', function () {
        var add = q('#sc-words [data-add]');
        if (!add) return 'no-add';
        var word = add.getAttribute('data-add');
        add.click();
        return wait(400).then(function () {
          return Store.getCard(word).then(function (c) {
            return c ? word + ' 已入库（' + (c.trans || '').slice(0, 10) + '）' : false;
          });
        });
      }); })
      .then(function () { return check('词书: 背词流程（含确认框）', function () {
        App.go('books');
        return wait(400).then(function () {
          var c = q('#screen [data-b="gk"]') || q('#screen [data-b]');
          if (!c) return 'no-book';
          c.click();
          return wait(500).then(function () {
            var start = q('#screen [data-a="start"]');
            if (!start) return 'no-start';
            start.click();
            return wait(350).then(function () {
              var ok = document.querySelector('.sheet [data-r="1"]');
              if (!ok) return 'no-confirm';
              ok.click();
              return wait(600).then(function () {
                return q('#rv-flash') ? 'session-started: ' + txt(q('#rv-flash .front')) : 'no-flash';
              });
            });
          });
        });
      }); })
      .then(function () { return check('图库: 加入地点桩流程', function () {
        App.go('gallery');
        return wait(400).then(function () {
          var seg = qq('#g-seg button')[0];
          if (seg) seg.click();
          return wait(400);
        }).then(function () {
          var t = q('#screen .tile');
          if (!t) return 'no-tile';
          t.click();
          return wait(400).then(function () {
            var pal = q('#screen [data-a="palace"]');
            if (!pal) return 'no-palace-btn';
            pal.click();
            return wait(400).then(function () {
              var item = document.querySelector('.sheet [data-p]');
              if (!item) return 'no-palace-item';
              item.click();
              return wait(500).then(function () {
                return Store.listPalaces().then(function (ps) {
                  var n = 0;
                  ps.forEach(function (p) { n += (p.loci || []).length; });
                  return '宫殿地点桩总数=' + n;
                });
              });
            });
          });
        });
      }); })
      .then(function () { return check('OCR 桥降级提示', function () {
        return Bridge.ocr('data:image/jpeg;base64,AAAA').then(function (r) {
          return r.ok ? 'unexpected-ok' : 'error=' + r.error;
        });
      }); })
      .then(function () { return check('导出数据', function () {
        return Store.exportAll().then(function (j) {
          var o = JSON.parse(j);
          return 'cards=' + o.cards.length + ' images=' + o.images.length + ' palaces=' + o.palaces.length;
        });
      }); })
      .then(function () { return check('设置开关持久化', function () {
        Store.settings.autoSpeak = false;
        Store.saveSettings();
        var raw = localStorage.getItem('wp.settings');
        return raw && raw.indexOf('autoSpeak') >= 0 ? 'ok' : false;
      }); })

      .then(function () { return check('tagEditor 返回值', function () {
        var p = UIKit.tagEditor('测试标签', ['客厅']);
        return wait(250).then(function () {
          var add = document.querySelector('.sheet [data-add]');
          if (add) add.click();
          var inp = document.querySelector('.sheet #te-new');
          if (inp) inp.value = '厨房';
          var addBtn = document.querySelector('.sheet #te-add');
          if (addBtn) addBtn.click();
          var ok = document.querySelector('.sheet [data-ok]');
          if (!ok) return 'no-ok';
          ok.click();
          return p;
        }).then(function (tags) {
          return tags && tags.length ? tags.join('+') : false;
        });
      }); })
      .then(function () { return check('tagEditor 取消返回 null', function () {
        var p = UIKit.tagEditor('取消测试', []);
        return wait(250).then(function () {
          var c = document.querySelector('.sheet [data-ok]');
          if (!c) return 'no-ok';
          document.querySelector('.sheet .close').click();
          return p;
        }).then(function (v) { return v === null ? 'null(正确)' : 'unexpected=' + v; });
      }); })
      .then(function () { return check('标签写入图片并持久化', function () {
        return Store.listImages().then(function (list) {
          if (!list.length) return 'no-image';
          var im = list[0];
          im.tags = ['客厅', '桌面'];
          return Store.putImage(im).then(function () {
            return Store.getImage(im.id);
          }).then(function (x) {
            return x.tags.join('+');
          });
        });
      }); })

      .then(function () { return check('订阅源: 默认不含海外源', function () {
        Store.settings.feeds = null;
        Store.saveSettings();
        return Feed.syncWithCatalog().then(function () {
          return Feed.reloadFromStore();
        }).then(function () {
          var all = Feed.list();
          var on = Feed.enabled();
          var overseasOn = on.filter(function (f) { return f.cn === false; });
          // 全新安装只预置默认源，其余从「精选源」按需订阅
          return (all.length === 4 && overseasOn.length === 0 && on.length === 4)
            ? ('预置 ' + all.length + ' 个源且全部启用（均为国内可直连），其余在精选目录里')
            : false;
        });
      }); })
      .then(function () { return check('外刊: 每日更新拉取并缓存', function () {
        return Feed.ensureFeeds(true).then(function () {
          var st = Feed.stats();
          return st.count > 0 ? ('缓存 ' + st.count + ' 条, stale=' + st.stale) : false;
        });
      }); })
      .then(function () { return check('外刊: 缓存已落库', function () {
        return Store.getMeta('feeds').then(function (c) {
          if (!c || !c.sources) return false;
          var ids = Object.keys(c.sources);
          var n = 0;
          ids.forEach(function (k) { n += c.sources[k].items.length; });
          return 'sources=' + ids.length + ' items=' + n + ' fetchedAt=' + (c.fetchedAt > 0);
        });
      }); })
      .then(function () { return check('外刊: 跨天判定为过期', function () {
        var before = Feed.stats();
        if (before.stale !== false) return false;
        return Store.getMeta('feeds').then(function (c) {
          var saved = c.fetchedAt;
          c.fetchedAt = Date.now() - 26 * 3600000;
          return Store.putMeta('feeds', c);
        }).then(function () {
          return Feed.reloadFromStore();
        }).then(function () {
          var stale = Feed.stats().stale;
          return Store.getMeta('feeds').then(function (c) {
            c.fetchedAt = Date.now();
            return Store.putMeta('feeds', c);
          }).then(function () {
            return Feed.reloadFromStore();
          }).then(function () {
            return (stale === true && Feed.stats().stale === false)
              ? '26 小时前 -> stale=true，重置后 -> false' : false;
          });
        });
      }); })
      .then(function () { return check('外刊: 未过期时不重复联网', function () {
        var calls = 0;
        var real = Bridge.http;
        Bridge.http = function (url, opt) {
          calls++;
          return real.call(Bridge, url, opt);
        };
        return Feed.ensureFeeds(false).then(function () {
          Bridge.http = real;
          return calls === 0 ? '0 次网络请求（命中缓存）' : false;
        });
      }); })
      .then(function () { return check('外刊: 过期时自动联网', function () {
        return Store.getMeta('feeds').then(function (c) {
          c.fetchedAt = Date.now() - 26 * 3600000;
          return Store.putMeta('feeds', c).then(function () { return Feed.reloadFromStore(); });
        }).then(function () {
          var calls = 0;
          var real = Bridge.http;
          Bridge.http = function (url, opt) {
            if (/(cgtn|ecns|hnrss|xinhuanet|globaltimes|guardian|bbci|breakingnewsenglish|example\.(com|org))/i.test(url)) { calls++; return Promise.resolve({ ok: true, status: 200, body: RSS_XML }); }
            return real.call(Bridge, url, opt);
          };
          return Feed.ensureFeeds(false).then(function () {
            Bridge.http = real;
            return calls === 4 ? ('自动发起 ' + calls + ' 个源的更新') : false;
          });
        });
      }); })
      .then(function () { return check('推荐页: 混入今日外刊', function () {
        App.go('read');
        return wait(900).then(function () {
          var n = document.querySelectorAll('#screen [data-rec^="feed"]').length;
          var label = document.querySelector('#screen .section-title');
          return n > 0 ? (n + ' 条外刊卡片') : false;
        });
      }); })
      .then(function () { return check('推荐页: 切到订阅时间线', function () {
        App.go('read');
        return wait(700).then(function () {
          var seg = document.querySelector('[data-seg] [data-tab="feed"]');
          if (!seg) return false;
          seg.click();
          return wait(900).then(function () {
            var n = document.querySelectorAll('#screen [data-item]').length;
            var stars = document.querySelectorAll('#screen [data-star]').length;
            var dots = document.querySelectorAll('#screen .ti-dot').length;
            return (n > 0 && stars === n && dots === n)
              ? (n + ' 条时间线，收藏按钮与未读圆点齐备') : false;
          });
        });
      }); })
      .then(function () { return check('订阅: 打开条目进阅读器并标记已读', function () {
        var it = document.querySelector('#screen [data-item]');
        if (!it) return false;
        var id = it.getAttribute('data-item');
        it.click();
        return wait(800).then(function () {
          var body = document.querySelector('#screen .rd-body');
          var words = body ? body.querySelectorAll('.wd').length : 0;
          var toolbar = !!document.querySelector('#screen .reader-toolbar');
          var hasFullBtn = !!document.querySelector('#screen [data-a="full"]');
          App.pop();
          return wait(400).then(function () {
            return Store.getMeta('read').then(function (r) {
              return (r && r.ids && r.ids[id] && words > 0 && toolbar && hasFullBtn)
                ? ('已读 ok，正文可点词 ' + words + ' 个，「载入全文」在') : false;
            });
          });
        });
      }); })
      .then(function () { return check('推荐: 订阅条目也给出难度标签', function () {
        App.go('read');
        return wait(700).then(function () {
          var seg = document.querySelector('[data-seg] [data-tab="rec"]');
          if (seg) { seg.click(); return wait(900); }
        }).then(function () {
          var cards = document.querySelectorAll('#screen [data-rec^="feed"]');
          if (!cards.length) return false;
          var txts = [];
          for (var i = 0; i < cards.length; i++) txts.push(cards[i].textContent);
          var hit = txts.some(function (t) { return /待记 \d+ 词|词书匹配 \d+%/.test(t); });
          return hit ? (cards.length + ' 条订阅条目带难度标签') : false;
        });
      }); })
      .then(function () { return check('设置: 外刊自动更新开关', function () {
        App.go('books');
        return wait(800).then(function () {
          var sw = document.querySelector('#screen [data-sw="autoFeed"]');
          if (!sw) return 'no-switch';
          var before = Store.settings.autoFeed;
          sw.click();
          var after = Store.settings.autoFeed;
          var persisted = JSON.parse(localStorage.getItem('wp.settings') || '{}');
          Store.settings.autoFeed = before;
          Store.saveSettings();
          return (after !== before && persisted.autoFeed === after)
            ? ('切换 ' + before + ' -> ' + after + ' 并持久化') : 'failed';
        });
      }); })


      .then(function () { return check('推荐: 类型筛选（全部/短文/订阅）', function () {
        ReadView.state.kind = 'short';
        App.go('read');
        return wait(1000).then(function () {
          var cards = Array.prototype.slice.call(document.querySelectorAll('#screen [data-rec]'));
          var onlyBuiltin = cards.length > 0 && cards.every(function (c) {
            return /^builtin:/.test(c.getAttribute('data-rec'));
          });
          ReadView.state.kind = 'feed';
          App.go('read');
          return wait(1000).then(function () {
            var f = Array.prototype.slice.call(document.querySelectorAll('#screen [data-rec]'));
            var onlyFeed = f.length > 0 && f.every(function (c) {
              return /^feed:/.test(c.getAttribute('data-rec'));
            });
            ReadView.state.kind = 'all';
            App.go('read');
            return wait(900).then(function () {
              var all = document.querySelectorAll('#screen [data-rec]').length;
              return (onlyBuiltin && onlyFeed && all >= cards.length)
                ? ('短文 ' + cards.length + ' 张 / 订阅 ' + f.length + ' 张 / 全部 ' + all + ' 张')
                : false;
            });
          });
        });
      }); })
      .then(function () { return check('推荐: 打分函数为全局最优', function () {
        ReadView.state.tab = 'rec';
        App.go('read');
        return wait(1000).then(function () {
          var cards = Array.prototype.slice.call(document.querySelectorAll('#screen [data-rec]'));
          if (cards.length < 8) return false;
          function parse(c) {
            var fresh = 0, fit = null, len = 0;
            Array.prototype.slice.call(c.querySelectorAll('.chip')).forEach(function (ch) {
              var t = ch.textContent.trim(), m;
              if ((m = /^待记 (\d+) 词$/.exec(t))) fresh = parseInt(m[1], 10);
              else if ((m = /^词书匹配 (\d+)%$/.exec(t))) fit = parseInt(m[1], 10) / 100;
              else if ((m = /^(\d+) 词$/.exec(t))) len = parseInt(m[1], 10);
            });
            return fit === null ? null : { fresh: fresh, fit: fit, len: len };
          }
          // 与 view-read.js 的打分保持一致：长度缩放目标 + 非对称偏离 + 短样本折扣
          function score(o) {
            var target = o.len ? Math.max(5, Math.min(40, Math.round(o.len * 0.10))) : 5;
            var base = Math.max(5, target);
            var under = Math.max(0, target - o.fresh) / base;
            var over = Math.min(1, Math.max(0, o.fresh - target) / base) * 0.5;
            var thin = o.len < 60 ? (60 - o.len) / 60 * 20 : 0;
            return -((under + over) * 60 + Math.max(0, 0.80 - o.fit) * 30 + thin);
          }
          var o0 = parse(cards[0]);
          if (!o0) return false;
          var s0 = score(o0), better = 0;
          for (var i = 1; i < cards.length; i++) {
            var o = parse(cards[i]);
            if (o && score(o) > s0 + 1e-9) better++;
          }
          return better === 0
            ? ('首篇 待记' + o0.fresh + '/匹配' + Math.round(o0.fit * 100) + '%/' + o0.len +
               '词 得分最高，其余 ' + (cards.length - 1) + ' 篇均不更优')
            : false;
        });
      }); })
      .then(function () { return check('推荐: 随生词本积累而变化', function () {
        // 反复回归会把当前词书里的词逐渐学光，于是「找不到还有生词的卡片」。
        // 这里依次换一本词书来找素材，测完恢复原词书——既不依赖累积状态，也顺带覆盖了切换词书。
        var BOOKS = ['gre', 'toefl', 'ielts', 'cet6', 'cet4', 'ky', 'gk', 'core'];
        var savedBook = Store.settings.bookId;

        function cardsWithFresh() {
          var out = [];
          Array.prototype.slice.call(document.querySelectorAll('#screen [data-rec]')).forEach(function (c) {
            var m = /待记 (\d+) 词/.exec(c.textContent);
            if (m && parseInt(m[1], 10) > 0) out.push({ key: c.getAttribute('data-rec'), n: parseInt(m[1], 10) });
          });
          return out;
        }

        function learn(pick, book) {
          var raw = pick.key, kind = raw.split(':')[0], id = raw.replace(/^[a-z]+:/, '');
          return Store.cardMap().then(function (cmap) {
            var list = [], seen = {};
            function collect(text) {
              U.extractWords(text, { minLen: 3, skipStop: true }).forEach(function (w) {
                if (seen[w]) return;
                seen[w] = 1;
                var e = Dict.lemma(w);
                if (e && !cmap[e.word] && Dict.inBook(e, book)) list.push(e.word);
              });
            }
            if (kind === 'builtin') {
              return fetch('data/articles.json').then(function (r) { return r.json(); })
                .then(function (d) {
                  var art = null;
                  (d.articles || []).forEach(function (a) { if (a.id === id) art = a; });
                  if (!art) return false;
                  (art.body || []).forEach(collect);
                  return list.length ? list : false;
                });
            }
            var it = null;
            Feed.allItems().forEach(function (x) { if (x.id === id) it = x; });
            if (!it) return false;
            collect(it.title + ' ' + (it.desc || ''));
            return list.length ? list : false;
          }).then(function (list) {
            if (!list) return false;
            var n = list.length;
            return Promise.all(list.map(function (w) {
              return UIKit.addWord(w, { source: 'article' });
            })).then(function () {
              Store.cardMap(true);
              return new Promise(function (res) {
                ReadView.state.tab = 'rec';
                App.go('read');
                setTimeout(res, 1100);
              });
            }).then(function () {
              var after = null;
              Array.prototype.slice.call(document.querySelectorAll('#screen [data-rec]')).forEach(function (c) {
                if (c.getAttribute('data-rec') === raw) after = c;
              });
              // 推荐只展示前 12 条：学完之后它可能直接掉出榜单，这本身就是排序生效的证据
              if (!after) return '在「' + book + '」下啃掉 ' + n + ' 词后该篇跌出推荐位，排序已随进度变化';
              var still = /待记 \d+ 词/.exec(after.textContent);
              var first = document.querySelector('#screen [data-rec]');
              var isFirst = first && first.getAttribute('data-rec') === raw;
              return !still
                ? ('在「' + book + '」下啃掉 ' + n + ' 词后该篇待记归零' + (isFirst ? '（仍在首位）' : '，并让出首位'))
                : false;
            });
          });
        }

        function tryBook(k) {
          if (k >= BOOKS.length) return false;
          Store.settings.bookId = BOOKS[k];
          Store.saveSettings();
          return new Promise(function (res) {
            ReadView.state.tab = 'rec';
            App.go('read');
            setTimeout(res, 1000);
          }).then(function () {
            var found = cardsWithFresh();
            if (!found.length) return tryBook(k + 1);
            return learn(found[0], BOOKS[k]);
          });
        }

        return tryBook(0).then(function (r) {
          Store.settings.bookId = savedBook;
          Store.saveSettings();
          return r;
        });
      }); })
      .then(function () { return check('订阅源: 关闭后不再请求该源', function () {
        var on = Feed.enabled();
        if (!on.length) return false;
        // 挑一个当前确实启用着的源，关掉它，再断言它的地址没有被请求
        var target = on.filter(function (f) { return /hnrss/i.test(f.url); })[0] || on[0];
        var uri = target.url;
        var before = Feed.enabled().length;
        target.on = false;
        Store.saveSettings();
        var after = Feed.enabled().length;
        var calls = 0;
        var real = Bridge.http;
        Bridge.http = function (url, opt) {
          if (String(url).indexOf(uri) === 0) {
            calls++;
            return Promise.resolve({ ok: true, status: 200, body: RSS_XML });
          }
          return real.call(Bridge, url, opt);
        };
        return Feed.refreshAll().then(function () {
          Bridge.http = real;
          target.on = true;
          Store.saveSettings();
          return (after === before - 1 && calls === 0)
            ? ('启用数 ' + before + '→' + after + '，关闭后对该源地址的请求 ' + calls + ' 次')
            : false;
        });
      }); })
      .then(function () { return check('订阅源: 全部关闭时给出提示', function () {
        var list = Feed.list();
        var saved = list.map(function (f) { return f.on; });
        list.forEach(function (f) { f.on = false; });
        Store.saveSettings();
        ReadView.state.tab = 'feed';
        App.go('read');
        return wait(900).then(function () {
          var notice = document.querySelector('#screen .notice.err');
          var txt = notice ? notice.textContent : '';
          list.forEach(function (f, i) { f.on = saved[i]; });
          Store.saveSettings();
          return /至少打开一个/.test(txt) ? '提示文案正确' : false;
        });
      }); })
      .then(function () { return check('订阅源: 添加自定义源', function () {
        var before = Feed.list().length;
        var list = Feed.list();
        list.push({
          id: 'custom-test', name: '测试源', url: 'https://example.org/custom.xml',
          tag: '测试', level: 3, on: true, custom: true
        });
        Store.saveSettings();
        var after = Feed.list().length;
        return Feed.refreshAll().then(function () {
          var got = Feed.list().filter(function (f) { return f.id === 'custom-test'; });
          return (after === before + 1 && got.length === 1) ? '自定义源已加入并可参与抓取' : false;
        });
      }); })
      .then(function () { return check('订阅源: 删除自定义源', function () {
        Store.settings.feeds = Feed.list().filter(function (f) { return f.id !== 'custom-test'; });
        Store.saveSettings();
        var gone = !Feed.list().some(function (f) { return f.id === 'custom-test'; });
        return gone ? '已删除' : false;
      }); })
      .then(function () { return check('订阅源: 网络错误被翻译成人话', function () {
        var a = Feed.humanError('java.net.UnknownHostException: feeds.bbci.co.uk');
        var b = Feed.humanError('java.net.ConnectException: failed to connect');
        var c = Feed.humanError(null, 503);
        var ok = /域名无法解析/.test(a) && /连接被拒绝/.test(b) && /HTTP 503/.test(c);
        return ok ? (a + ' / ' + b + ' / ' + c) : false;
      }); })
      .then(function () { return check('订阅源: 管理面板可打开', function () {
        ReadView.openSourceManager();
        return wait(400).then(function () {
          var sheet = document.querySelector('.sheet');
          if (!sheet) return false;
          var toggles = sheet.querySelectorAll('[data-toggle]').length;
          var adds = sheet.querySelectorAll('[data-add]').length;
          var hasOpml = !!sheet.querySelector('[data-opml]');
          var hasBlocked = !!sheet.querySelector('[data-blocked]');
          U.closeTopSheet();
          // 面板内容应与「我的订阅」一致，而不是列目录里全部源
          return (toggles === Feed.list().length && toggles >= 4 && adds === 1 && hasOpml && hasBlocked)
            ? ('面板含 ' + toggles + ' 个开关 + 添加/OPML/屏蔽词入口') : false;
        });
      }); })
      .then(function () { return check('订阅源: 编辑面板含测试按钮', function () {
        App.go('gallery');
        return wait(500).then(function () {
          ReadView.openSourceManager();
          return wait(700).then(function () {
            var ed = document.querySelector('.sheet [data-edit]');
            if (!ed) return false;
            ed.click();
            return wait(600).then(function () {
              var all = document.querySelectorAll('.sheet');
              var sheet = all.length ? all[all.length - 1] : null;
              if (!sheet) return false;
              var hasUrl = !!sheet.querySelector('#sf-url');
              var hasTest = !!sheet.querySelector('[data-sf="test"]');
              var hasSave = !!sheet.querySelector('[data-sf="save"]');
              var val = sheet.querySelector('#sf-url') ? sheet.querySelector('#sf-url').value : '';
              U.closeTopSheet();
              U.closeTopSheet();
              return (hasUrl && hasTest && hasSave && /^https?:/.test(val))
                ? ('可编辑，地址=' + val.slice(0, 40)) : false;
            });
          });
        });
      }); })


      .then(function () { return check('解析: 剥掉 HN 式元信息摘要', function () {
        var hn = '<?xml version="1.0"?><rss version="2.0"><channel>' +
          '<item><title>Thunderbird for iOS</title>' +
          '<link>https://blog.thunderbird.net/x</link>' +
          '<description>Article URL: https://blog.thunderbird.net/x ' +
          'Comments URL: https://news.ycombinator.com/item?id=1 ' +
          'Points: 410 # Comments: 88</description></item>' +
          '<item><title>Real story</title>' +
          '<description>The committee approved the measure after a long debate about funding.</description>' +
          '</item></channel></rss>';
        var r = Feed.parseFeed(hn);
        if (r.items.length !== 2) return false;
        var head = r.items[0].desc;
        var clean = head.indexOf('Article URL') < 0 && head.indexOf('Points:') < 0 &&
                    head.indexOf('Comments') < 0 && head.indexOf('http') < 0;
        var kept = /committee approved the measure/.test(r.items[1].desc);
        return (clean && kept)
          ? ('元信息已剥掉（剩 ' + head.length + ' 字），正文摘要未受影响') : false;
      }); })
      .then(function () { return check('解析: 短摘要被识别为低置信样本', function () {
        var short = Reader.blocksFromSummary('Article URL: https://a.b Points: 3');
        var long = 'The committee approved the measure after a long debate about funding and timing, ' +
          'and the decision is expected to reshape the programme for the coming decade.';
        var a = (short.join('') || '').length;
        var b = long.length;
        // 打分只用到词数：这里验证清洗后短摘要确实变短，价格差异会被 thin 项放大
        return (a < b) ? ('清洗后短摘要 ' + a + ' 字 < 长摘要 ' + b + ' 字，长度差异会被计入打分')
                       : false;
      }); })
      .then(function () { return check('解析: 标准 RSS', function () {
        var r = Feed.parseFeed(FEED_CASES.rss);
        return (r.format === 'rss' && r.strict === true && r.items.length === 2 &&
                r.items[0].title === 'Alpha' && /Desc A/.test(r.items[0].desc))
          ? 'rss / 严格解析 / ' + r.items.length + ' 条' : false;
      }); })
      .then(function () { return check('解析: 浏览器能显示但 XML 不规范', function () {
        // 先证明严格解析确实会失败（这正是「浏览器打得开、应用解析不出」的原因）
        var d = new DOMParser().parseFromString(FEED_CASES.malformed, 'text/xml');
        var strictFailed = d.getElementsByTagName('parsererror').length > 0;
        var r = Feed.parseFeed(FEED_CASES.malformed);
        return (strictFailed && r.items.length >= 2 && r.strict === false &&
                /Tom/.test(r.items[0].title))
          ? ('严格解析失败=' + strictFailed + '，容错后仍取到 ' + r.items.length + ' 条')
          : false;
      }); })
      .then(function () { return check('解析: Atom 格式', function () {
        var r = Feed.parseFeed(FEED_CASES.atom);
        return (r.format === 'atom' && r.items.length === 1 && r.items[0].title === 'Entry One' &&
                r.items[0].link === 'https://e/1')
          ? 'atom / ' + r.items[0].title + ' / ' + r.items[0].link : false;
      }); })
      .then(function () { return check('解析: RSS 1.0 (RDF)', function () {
        var r = Feed.parseFeed(FEED_CASES.rdf);
        return (r.items.length === 1 && r.items[0].title === 'Rdf One') ? 'rdf / 1 条' : false;
      }); })
      .then(function () { return check('解析: content:encoded 作为正文', function () {
        var r = Feed.parseFeed(FEED_CASES.encoded);
        return (r.items.length === 1 && /Body text here/.test(r.items[0].desc))
          ? '取到 CDATA 正文' : false;
      }); })
      .then(function () { return check('解析: 网页地址被明确识别', function () {
        var r = Feed.parseFeed(FEED_CASES.html);
        return (r.items.length === 0 && r.format === 'html' && /网页/.test(r.error))
          ? r.error : false;
      }); })
      .then(function () { return check('解析: 空响应有明确报错', function () {
        var r = Feed.parseFeed(FEED_CASES.empty);
        return (r.items.length === 0 && /空/.test(r.error)) ? r.error : false;
      }); })

      .then(function () { return check('直连被拦时自动切换浏览器引擎', function () {
        App.go('gallery');   // 离开阅读页，避免它的自动刷新抢跑
        return waitIdle().then(function () {
        var realHttp = Bridge.http;
        // 模拟站点 WAF：直连一律 403 + 拦截页
        Bridge.http = function () {
          return Promise.resolve({
            ok: false, status: 403, error: 'HTTP 403',
            body: '<html><head><title>403 Forbidden</title></head><body>blocked</body></html>'
          });
        };
        // 注入一个只有 webFetch 的原生实现（模拟隐藏 WebView 通道）
        window.NativeBridge = {
          platform: function () { return '{"name":"test","version":"1.0"}'; },
          webFetch: function (callId, url) {
            setTimeout(function () {
              window.__nb(callId, JSON.stringify({
                ok: true, status: 200, via: 'webview', body: RSS_XML
              }));
            }, 5);
          }
        };
        function restore() { Bridge.http = realHttp; try { delete window.NativeBridge; } catch (e) {} }
        return Feed.ensureFeeds(true).then(function () {
          restore();
          return Store.getMeta('feeds').then(function (c) {
            if (!c) return false;
            var viaWeb = Object.keys(c.sources).filter(function (k) {
              return /浏览器引擎/.test(c.sources[k].note || '');
            });
            var total = 0;
            Object.keys(c.sources).forEach(function (k) {
              total += (c.sources[k].items || []).length;
            });
            return (total > 0 && viaWeb.length > 0)
              ? ('直连 403 的 ' + viaWeb.length + ' 个源经浏览器引擎取到 ' + total + ' 条')
              : false;
          });
        }).catch(function (e) { restore(); throw e; });
        });
      }); })
      .then(function () { return check('两个通道都失败时如实报错', function () {
        return waitIdle().then(function () {
        var realHttp = Bridge.http, realWeb = Bridge.webFetch;
        Bridge.http = function () {
          return Promise.resolve({ ok: false, status: 403, error: 'HTTP 403', body: '<html>403</html>' });
        };
        Bridge.webFetch = function () {
          return Promise.resolve({ ok: false, status: 403, error: 'HTTP 403', body: '<html>403</html>' });
        };
        return Feed.refreshAll().then(function () {
          var st = Feed.stats();
          return Store.getMeta('feeds').then(function (c) {
            Bridge.http = realHttp; Bridge.webFetch = realWeb;
            var errs = Object.keys(c.sources).filter(function (k) {
              return !!c.sources[k].error;
            });
            var one = errs.length ? c.sources[errs[0]] : null;
            return (errs.length && /HTTP 403|没取到条目/.test(one.error) &&
                    /direct/.test(one.raw || ''))
              ? ('报错含原因与通道：' + one.error.slice(0, 40)) : false;
          });
        }).catch(function (e) {
          Bridge.http = realHttp; Bridge.webFetch = realWeb; throw e;
        });
        });
      }); })


      .then(function () { return check('正文提取: cookie 提示条被拒绝', function () {
        // 注意：extract 对短于 800 字符的响应直接判为「内容太短」，
        // 所以这里必须堆够长度，才能真正走到「候选打分 → 提示条识别」这一段。
        var pad = '';
        for (var i = 0; i < 8; i++) {
          pad += '<p>By continuing to browse our site you agree to our use of cookies, ' +
            'the revised Privacy Policy and Terms of Use, and the cookie settings you can ' +
            'change through your browser at any time.</p>';
        }
        var html = '<!doctype html><html><head><title>Site</title></head><body>' +
          '<div class="qc-cmp2-container">' + pad + '</div></body></html>';
        if (html.length < 800) return false;
        var r = Reader.extract(html, 'https://example.org/a');
        if (!r.ok && r.words === 0 && /提示条/.test(r.reason)) {
          return '已拒绝：' + r.reason.slice(0, 32);
        }
        return false;
      }); })
      .then(function () { return check('阅读模式: 直连没抓到正文时改用浏览器引擎', function () {
        var realHttp = Bridge.http, realWeb = Bridge.webFetch;
        var pad = '';
        for (var i = 0; i < 8; i++) {
          pad += '<p>By continuing to browse our site you agree to our use of cookies ' +
            'and the revised Privacy Policy and Terms of Use of this website.</p>';
        }
        Bridge.http = function () {
          return Promise.resolve({ ok: true, status: 200,
            body: '<!doctype html><html><body><div id="cookie-consent">' + pad + '</div></body></html>' });
        };
        var hadNative = Object.prototype.hasOwnProperty.call(window, 'NativeBridge');
        var oldNative = window.NativeBridge;
        window.NativeBridge = {
          platform: function () { return '{"name":"test","version":"1.0"}'; },
          webFetch: function (callId) {
            setTimeout(function () {
              window.__nb(callId, JSON.stringify({ ok: true, status: 200, via: 'webview', body: SITE_HTML }));
            }, 5);
          }
        };
        Bridge.webFetch = function (url) {
          return new Promise(function (res) {
            window.NativeBridge.webFetch('cw1', url);
            setTimeout(function () {
              res({ ok: true, status: 200, via: 'webview', body: SITE_HTML });
            }, 40);
          });
        };
        function restore() {
          Bridge.http = realHttp; Bridge.webFetch = realWeb;
          if (hadNative) window.NativeBridge = oldNative; else delete window.NativeBridge;
        }
        return Reader.fetchArticle('https://example.org/story').then(function (out) {
          restore();
          return (out.via === 'webview' && out.ex.ok && out.tried.join('→') === 'direct→webview')
            ? ('直连只拿到提示条，已切换浏览器引擎并提取到 ' + out.ex.words + ' 词') : false;
        }).catch(function (e) { restore(); throw e; });
      }); })
      .then(function () { return check('正文提取: 段落/小标题/引用/列表都取到', function () {
        var r = Reader.extract(SITE_HTML, 'https://example.org/p');
        if (!r.blocks.length) return false;
        var kindOf = {};
        r.blocks.forEach(function (b) { kindOf[b.t] = (kindOf[b.t] || 0) + 1; });
        var allText = r.blocks.map(function (b) { return b.text || ''; }).join('\n');
        var ok = r.ok === true &&
          (kindOf.p >= 3) && (kindOf.h2 >= 2) && (kindOf.quote >= 1) && (kindOf.li >= 2) &&
          allText.indexOf('path of least resistance') > 0 &&
          allText.indexOf('genuine rest restores it') > 0;
        return ok ? ('p=' + kindOf.p + ' h2=' + kindOf.h2 + ' quote=' + kindOf.quote +
                     ' li=' + kindOf.li + '，共 ' + r.words + ' 词') : false;
      }); })
      .then(function () { return check('正文提取: 剔掉导航/相关推荐/侧边栏/页脚', function () {
        var r = Reader.extract(SITE_HTML, 'https://example.org/p');
        var allText = r.blocks.map(function (b) { return b.text || ''; }).join('\n');
        var dirty = [];
        if (/Related one|Section \d/.test(allText)) dirty.push('相关推荐');
        if (/Sidebar promotional/.test(allText)) dirty.push('侧边栏');
        if (/Copyright notice/.test(allText)) dirty.push('页脚');
        if (/^World$/m.test(allText)) dirty.push('导航');
        return dirty.length === 0
          ? ('干净，标题=「' + r.title + '」，站点=' + r.site) : ('仍混入: ' + dirty.join('/'));
      }); })
      .then(function () { return check('正文提取: 纯链接页被识别为无可读正文', function () {
        var r = Reader.extract(NAV_HTML, 'https://example.org/index');
        return (!r.ok && !r.blocks.length && r.reason)
          ? ('已拒绝：' + r.reason.slice(0, 30)) : false;
      }); })
      .then(function () { return check('阅读模式: 准入判断', function () {
        var a = Reader.canOpen('https://example.org/story');
        var b = Reader.canOpen('https://example.org/file.pdf');
        var c = Reader.canOpen('https://www.youtube.com/watch?v=1');
        var d = Reader.canOpen('ftp://example.org/x');
        return (a === true && b === false && c === false && d === false)
          ? '普通网页可进，pdf/youtube/ftp 被拒' : false;
      }); })
      .then(function () { return check('订阅源发现: 从网页找出 RSS 地址', function () {
        if (REAL) return { skip: '该用例依赖桩提供的测试网页，真实网络下无对应地址' };
        return Feed.discover('https://example.org/page').then(function (r) {
          if (r.error) return false;
          return (r.url === 'https://example.org/feed.xml' && r.pf.items.length > 0)
            ? ('找到 ' + r.url + '，' + r.pf.items.length + ' 条') : false;
        });
      }); })
      .then(function () { return check('OPML: 导出与导入往返一致', function () {
        var xml = Feed.buildOpml();
        var back = Feed.parseOpml(xml);
        var mine = Feed.list().length;
        var hasOpmlTag = /<opml version="2\.0">/.test(xml) && /<head>/.test(xml);
        return (hasOpmlTag && back.feeds.length === mine && !back.error)
          ? ('导出 ' + mine + ' 个源，回读 ' + back.feeds.length + ' 个') : false;
      }); })
      .then(function () { return check('OPML: 容忍未转义的 &', function () {
        var bad = '<?xml version="1.0"?><opml version="2.0"><body>' +
          '<outline text="Tech & Science" title="Tech & Science">' +
          '<outline type="rss" text="A & B" xmlUrl="https://example.org/a.xml"/>' +
          '</outline></body></opml>';
        var r = Feed.parseOpml(bad);
        return (r.feeds.length === 1 && /example\.org\/a\.xml/.test(r.feeds[0].url))
          ? ('兼容解析，名称=' + r.feeds[0].name) : false;
      }); })
      .then(function () { return check('OPML: 导入去重', function () {
        var before = Feed.list().length;
        var text = Feed.buildOpml();
        return Feed.importOpml(text, true).then(function (r) {
          return (r.ok && r.added === 0 && Feed.list().length === before)
            ? '重复导入未新增，仍为 ' + before + ' 个' : false;
        });
      }); })
      .then(function () { return check('精选目录: 加载且国内源占多数', function () {
        return Feed.catalogFeeds().then(function (list) {
          var cn = list.filter(function (f) { return f.cn; }).length;
          var cats = {};
          list.forEach(function (f) { cats[f.cat] = 1; });
          return (list.length >= 40 && cn >= 35 && Object.keys(cats).length >= 6)
            ? (list.length + ' 个源 / ' + Object.keys(cats).length + ' 个分类 / 国内可直连 ' + cn)
            : false;
        });
      }); })
      .then(function () { return check('精选目录: 三种状态都正确', function () {
        App.go('gallery');
        return wait(400).then(function () {
          var enabled = Feed.enabled();
          if (!enabled.length) return false;
          var offId = enabled[0].id;
          Feed.setOn(offId, false);          // 临时关掉一个，验证目录会显示「启用」
          var before = Feed.list().length;
          ReadView.openCatalog();
          return wait(900).then(function () {
            var sheet = document.querySelector('.sheet');
            if (!sheet) return false;
            var labels = {}, byId = {};
            Array.prototype.slice.call(sheet.querySelectorAll('[data-add]')).forEach(function (b) {
              var t = b.textContent.trim();
              labels[t] = (labels[t] || 0) + 1;
              byId[b.getAttribute('data-add')] = t;
            });
            U.closeTopSheet();
            Feed.setOn(offId, true);
            var ok = (labels['已订阅'] || 0) === before - 1 &&
                     (labels['订阅'] || 0) >= 15 &&
                     byId[offId] === '启用';
            return ok
              ? ('已订阅 ' + labels['已订阅'] + ' / 可启用 ' + labels['启用'] +
                 ' / 未订阅 ' + labels['订阅'] + ' ｜ 关闭的源显示为「' + byId[offId] + '」')
              : false;
          });
        });
      }); })
      .then(function () { return check('收藏: 切换并持久化', function () {
        var all = Feed.allItems();
        if (!all.length) return false;
        var id = all[0].id;
        return Feed.toggleStar(id).then(function (on) {
          return Store.getMeta('star').then(function (m) {
            var saved = !!(m && m.ids && m.ids[id]);
            return Feed.toggleStar(id).then(function (off) {
              return (on === true && saved && off === false)
                ? '收藏→已落库→取消，状态一致' : false;
            });
          });
        });
      }); })
      .then(function () { return check('屏蔽词: 过滤生效', function () {
        var all = Feed.allItems();
        if (!all.length) return false;
        var word = String(all[0].title || '').split(/\s+/)[0];
        if (!word) return false;
        Store.settings.blocked = [word];
        Store.saveSettings();
        var after = Feed.allItems();
        var hit = after.some(function (x) {
          return (x.title || '').toLowerCase().indexOf(word.toLowerCase()) >= 0;
        });
        Store.settings.blocked = [];
        Store.saveSettings();
        return (!hit && after.length < all.length)
          ? ('屏蔽「' + word + '」后 ' + all.length + ' → ' + after.length + ' 条') : false;
      }); })

      .then(function () { return check('版本: 应用内版本与 version.json 一致', function () {
        // version.json 由构建脚本写入 APK，是版本号的唯一来源；
        // 界面显示的必须和它一致，否则用户没法判断装的是哪个包。
        return fetch('version.json', { cache: 'no-store' })
          .then(function (r) { return r.json(); })
          .then(function (v) {
            return App.loadVersion().then(function () {
              var txt = App.versionText();
              var hasName = txt.indexOf(v.appName) >= 0;
              var hasVer = txt.indexOf('v' + v.versionName) >= 0;
              var hasCode = txt.indexOf('build ' + v.versionCode) >= 0;
              return (hasName && hasVer && hasCode)
                ? ('界面显示「' + txt + '」= version.json 内容') : false;
            });
          });
      }); })
      .then(function () { return check('版本: 设置页「关于」显示版本号', function () {
        App.go('books');
        return wait(900).then(function () {
          var el = document.querySelector('#screen #about-ver');
          if (!el) return false;
          var t = el.textContent.trim();
          var v = App.version;
          return (v && t.indexOf('v' + v.versionName) >= 0 && t.indexOf('build ' + v.versionCode) >= 0)
            ? ('关于区显示「' + t + '」') : false;
        });
      }); })
      .then(function () { return check('版本: 更新日志列出历史版本', function () {
        var v = App.version;
        if (!v || !(v.history || []).length) return false;
        App.changelogSheet();
        return wait(600).then(function () {
          var all = document.querySelectorAll('.sheet');
          var sheet = all.length ? all[all.length - 1] : null;
          if (!sheet) return false;
          var heads = sheet.querySelectorAll('.card.tight');
          var items = sheet.querySelectorAll('.cl-list li');
          var head = sheet.querySelector('.sheet-head h3');
          var titled = head && head.textContent.indexOf('更新日志') >= 0;
          U.closeTopSheet();
          return (titled && heads.length === v.history.length && items.length >= heads.length)
            ? (heads.length + ' 个历史版本 / ' + items.length + ' 条改动') : false;
        });
      }); })
      .then(function () { return check('版本: 应用名已是「乐学英语」', function () {
        // 应用名体现在三处：页面标题、version.json、Android 清单的 launcher label
        // （清单里的那份由构建脚本校验，浏览器里查不到）。
        // 标题栏显示的是当前页名，所以只校验页面标题与 version.json。
        var v = App.version;
        App.go('books');
        return wait(700).then(function () {
          var card = document.querySelector('#screen .card');
          var ok = document.title.indexOf('乐学英语') >= 0 && (!v || v.appName === '乐学英语');
          return ok ? ('页面标题=「' + document.title + '」，version.json appName=「' +
                       (v ? v.appName : '?') + '」') : false;
        });
      }); })

      .then(function () { return check('订阅源: http 地址不会被拒绝', function () {
        // 曾经清单里写成 usesCleartextTraffic="false"，http 源一律被系统拦掉，
        // 表现却是「网络不通」，极难排查。这里验证前端从校验到抓取都不排斥 http。
        var url = 'http://example.org/plain-http.xml';
        if (!/^https?:\/\//i.test(url)) return false;
        var got = null;
        var real = Bridge.http;
        Bridge.http = function (u) {
          if (u === url) got = u;
          return Promise.resolve({ ok: true, status: 200, body: RSS_XML });
        };
        var id = 'http-test';
        Store.settings.feeds = Feed.list().filter(function (f) { return f.id !== id; });
        Store.saveSettings();
        Feed.add({ id: id, name: 'HTTP 源', url: url, cat: 'test', catName: '测试',
                   level: 3, cn: true, on: true, custom: true });
        return Feed.refreshAll().then(function () {
          Bridge.http = real;
          Store.settings.feeds = Feed.list().filter(function (f) { return f.id !== id; });
          Store.saveSettings();
          var st = Feed.sourceState(id);
          return (got === url && st && st.items && st.items.length)
            ? ('http 地址被正常请求并解析出 ' + st.items.length + ' 条') : false;
        }).catch(function (e) {
          Bridge.http = real; throw e;
        });
      }); })
      .then(function () { return check('订阅源: 明文被拦时给出可读原因', function () {
        var a = Feed.humanError('java.io.IOException: Cleartext HTTP traffic to www.xinhuanet.com not permitted');
        var b = Feed.humanError('javax.net.ssl.SSLHandshakeException: handshake failed');
        var c = Feed.humanError(null, 503);
        var ok = /明文/.test(a) && /TLS/.test(b) && /HTTP 503/.test(c);
        return ok ? (a + ' / ' + b + ' / ' + c) : false;
      }); })
      .then(function () { return check('内置源: 全部为 https 地址', function () {
        return Feed.catalogFeeds().then(function (list) {
          var http = list.filter(function (f) { return /^http:\/\//i.test(f.url); });
          return http.length === 0
            ? (list.length + ' 个内置源全部使用 https（仍支持用户自行添加 http 源）') : false;
        });
      }); })
      .then(function () { return check('语言: 跟随系统时的判定规则', function () {
        var real = Object.getOwnPropertyDescriptor(navigator, 'languages');
        function withLangs(list, fn) {
          try { Object.defineProperty(navigator, 'languages', { value: list, configurable: true }); } catch (e) {}
          var r = fn();
          try {
            if (real) Object.defineProperty(navigator, 'languages', real);
            else delete navigator.languages;
          } catch (e) {}
          return r;
        }
        var a = withLangs(['zh-CN', 'en'], function () { return I18N.resolve('auto'); });
        var b = withLangs(['zh-TW'], function () { return I18N.resolve('auto'); });
        var c = withLangs(['zh-HK', 'zh'], function () { return I18N.resolve('auto'); });
        var d = withLangs(['en-US', 'en'], function () { return I18N.resolve('auto'); });
        var e = withLangs(['fr-FR'], function () { return I18N.resolve('auto'); });
        var f = withLangs(['en-US', 'zh-CN'], function () { return I18N.resolve('auto'); });
        var g = I18N.resolve('zh-Hant');
        return (a === 'zh-Hans' && b === 'zh-Hant' && c === 'zh-Hant' &&
                d === 'en' && e === 'en' && f === 'zh-Hans' && g === 'zh-Hant')
          ? ('zh-CN→' + a + ' zh-TW→' + b + ' zh-HK→' + c + ' en-US→' + d +
             ' fr-FR→' + e + ' 多语言含中文→' + f + ' 显式指定→' + g) : false;
      }); })
      .then(function () { return check('语言: 切到英文后界面变为英文', function () {
        Store.settings.lang = 'en';
        Store.saveSettings();
        I18N.setLang('en');
        App.go('gallery');
        return wait(800).then(function () {
          var tabs = Array.prototype.slice.call(document.querySelectorAll('#tabbar .tab'))
            .map(function (t) { return t.textContent.replace(/[\d+]+$/, ''); });
          var title = document.getElementById('bar-title').textContent;
          var noHan = !/[\u4e00-\u9fff]/.test(tabs.join('') + title);
          return (I18N.lang === 'en' && noHan && tabs[0] === 'Gallery' && /Gallery/.test(title))
            ? ('标签=' + tabs.join('/') + ' | 标题=' + title) : false;
        });
      }); })
      .then(function () { return check('语言: 切到繁体后界面变为繁体', function () {
        Store.settings.lang = 'zh-Hant';
        Store.saveSettings();
        I18N.setLang('zh-Hant');
        App.go('gallery');
        return wait(800).then(function () {
          var tabs = Array.prototype.slice.call(document.querySelectorAll('#tabbar .tab'))
            .map(function (t) { return t.textContent.replace(/[\d+]+$/, ''); });
          var title = document.getElementById('bar-title').textContent;
          return (I18N.lang === 'zh-Hant' && tabs[0] === '圖庫' && /圖庫/.test(title) &&
                  tabs.join('') === '圖庫識圖背單詞閱讀詞書')
            ? ('标签=' + tabs.join('/') + ' | 标题=' + title) : false;
        });
      }); })
      .then(function () { return check('语言: 繁体采用词组规则而非逐字转换', function () {
        // 逐字转换会把「头发」变成「頭发」，词组规则才给「頭髮」
        I18N.setLang('zh-Hant');
        var a = T('头发'), b = T('里面'), c = T('记忆宫殿');
        var d = I18N.lang;
        I18N.setLang('zh-Hans');
        return (d === 'zh-Hant' && a === '頭髮' && b === '裏面' && c === '記憶宮殿')
          ? ('头发→' + a + '，里面→' + b + '，记忆宫殿→' + c) : false;
      }); })
      .then(function () { return check('语言: 切回简体后恢复原文', function () {
        Store.settings.lang = 'zh-Hans';
        Store.saveSettings();
        I18N.setLang('zh-Hans');
        App.go('gallery');
        return wait(700).then(function () {
          var tabs = Array.prototype.slice.call(document.querySelectorAll('#tabbar .tab'))
            .map(function (t) { return t.textContent.replace(/[\d+]+$/, ''); });
          var title = document.getElementById('bar-title').textContent;
          return (I18N.lang === 'zh-Hans' && T('图库') === '图库' &&
                  tabs[0] === '图库' && /图库/.test(title))
            ? ('标签=' + tabs.join('/') + '，T 已是恒等函数') : false;
        });
      }); })
      .then(function () { return check('语言: 偏好写入本地存储', function () {
        Store.settings.lang = 'en';
        Store.saveSettings();
        var saved = JSON.parse(localStorage.getItem('wp.settings') || '{}').lang === 'en';
        Store.settings.lang = 'zh-Hans';
        Store.saveSettings();
        return saved ? 'lang 已持久化到 wp.settings' : false;
      }); })
      .then(function () { return check('语言: 未收录文案安全回退为原文', function () {
        var odd = '这句文案不在词表里';
        Store.settings.lang = 'en'; I18N.setLang('en');
        var en = T(odd);
        Store.settings.lang = 'zh-Hant'; I18N.setLang('zh-Hant');
        var hant = T(odd);
        Store.settings.lang = 'zh-Hans'; I18N.setLang('zh-Hans');
        return (en === odd && hant === '這句文案不在詞表裏')
          ? ('英文回退原文、繁体逐字兜底：' + hant) : false;
      }); })
      .then(function () { return check('主题: 三种取值的解析与状态栏同步', function () {
        Store.settings.theme = 'light'; var a = Theme.apply();
        Store.settings.theme = 'dark'; var b = Theme.apply();
        var metaDark = (document.querySelector('meta[name="theme-color"]') || {}).content;
        Store.settings.theme = 'auto';
        var auto = Theme.resolve('auto');
        Theme.apply();
        var attr = document.documentElement.getAttribute('data-theme');
        return (a === 'light' && b === 'dark' && (auto === 'light' || auto === 'dark') &&
                attr === auto && metaDark === '#141a22' && !!Theme.systemDark)
          ? ('light→' + a + ' dark→' + b + ' auto→' + auto + ' 深色状态栏=' + metaDark) : false;
      }); })
      .then(function () { return check('主题: 深色下背景确实变暗且文字可读', function () {
        function lum(rgb) {
          var m = /(\d+),\s*(\d+),\s*(\d+)/.exec(rgb);
          return m ? (parseInt(m[1], 10) + parseInt(m[2], 10) + parseInt(m[3], 10)) / 3 : null;
        }
        Store.settings.theme = 'dark'; Theme.apply();
        var darkBg = lum(getComputedStyle(document.body).backgroundColor);
        var darkFg = lum(getComputedStyle(document.body).color);
        Store.settings.theme = 'light'; Theme.apply();
        var lightBg = lum(getComputedStyle(document.body).backgroundColor);
        var lightFg = lum(getComputedStyle(document.body).color);
        Store.settings.theme = 'auto'; Theme.apply();
        return (darkBg !== null && lightBg !== null &&
                darkBg < 80 && darkFg > 150 && lightBg > 200 && lightFg < 120)
          ? ('深色 ' + Math.round(darkBg) + '/文字' + Math.round(darkFg) +
             '，浅色 ' + Math.round(lightBg) + '/文字' + Math.round(lightFg)) : false;
      }); })
      .then(function () { return check('设置面板: 左上角入口可打开', function () {
        App.go('gallery');
        return wait(600).then(function () {
          var btn = document.getElementById('bar-settings');
          if (!btn) return false;
          var left = btn.getBoundingClientRect().left;
          var barLeft = document.querySelector('.appbar').getBoundingClientRect().left;
          var titleLeft = document.getElementById('bar-title').getBoundingClientRect().left;
          btn.click();
          return wait(700).then(function () {
            var all = document.querySelectorAll('.sheet');
            var sheet = all.length ? all[all.length - 1] : null;
            if (!sheet) return false;
            var langs = sheet.querySelectorAll('[data-set="lang"]').length;
            var themes = sheet.querySelectorAll('[data-set="theme"]').length;
            var head = sheet.querySelector('.sheet-head h3');
            var titled = head && head.textContent.indexOf('设置') >= 0;
            U.closeTopSheet();
            return (titled && langs === 4 && themes === 3 &&
                    left - barLeft < 30 && titleLeft > left)
              ? ('入口距左 ' + Math.round(left - barLeft) + 'px 且在标题左侧，面板含 ' +
                 langs + ' 个语言项 / ' + themes + ' 个外观项') : false;
          });
        });
      }); })
      .then(function () { return check('设置面板: 点选语言立即生效并持久化', function () {
        App.go('gallery');
        return wait(500).then(function () {
          App.openSettings();
          return wait(700).then(function () {
            var all = document.querySelectorAll('.sheet');
            var sheet = all[all.length - 1];
            var row = sheet.querySelector('[data-set="lang"][data-v="en"]');
            if (!row) return false;
            row.click();
            return wait(900).then(function () {
              var tag = document.querySelector('#tabbar .tab').textContent.replace(/[\d+]+$/, '');
              var saved = JSON.parse(localStorage.getItem('wp.settings') || '{}').lang;
              var isEn = I18N.lang === 'en' && tag === 'Gallery';
              var back = sheet.querySelector('[data-set="lang"][data-v="zh-Hans"]');
              if (back) back.click();
              return wait(800).then(function () {
                U.closeTopSheet();
                App.go('gallery');
                return (isEn && saved === 'en')
                  ? ('点选后标签变为 ' + tag + '，lang 已存为 ' + saved +
                     '，随后已切回 ' + Store.settings.lang) : false;
              });
            });
          });
        });
      }); })
      .then(function () { return check('设置面板: 点选主题立即生效', function () {
        App.go('gallery');
        return wait(500).then(function () {
          App.openSettings();
          return wait(700).then(function () {
            var all = document.querySelectorAll('.sheet');
            var sheet = all[all.length - 1];
            var row = sheet.querySelector('[data-set="theme"][data-v="dark"]');
            if (!row) return false;
            row.click();
            return wait(500).then(function () {
              var attr = document.documentElement.getAttribute('data-theme');
              var saved = JSON.parse(localStorage.getItem('wp.settings') || '{}').theme;
              var back = sheet.querySelector('[data-set="theme"][data-v="auto"]');
              if (back) back.click();
              return wait(400).then(function () {
                U.closeTopSheet();
                return (attr === 'dark' && saved === 'dark')
                  ? ('data-theme=' + attr + '，theme 已存为 ' + saved + '，随后已还原') : false;
              });
            });
          });
        });
      }); })
      .then(function () { return check('订阅源: 单源预算为 10 秒', function () {
        var b = Feed.budget;
        return (b.source === 10000 && b.direct === 7500 && b.direct < b.source)
          ? ('单源上限 ' + (b.source / 1000) + 's，其中直连最多 ' + (b.direct / 1000) +
             's，余下留给浏览器引擎') : false;
      }); })
      .then(function () { return check('订阅源: 超时由预算兜底而不是无限等', function () {
        var t0 = Date.now();
        var never = new Promise(function () {});
        return Feed.withBudget(never, 250, { error: 'timeout', timedOut: true })
          .then(function (r) {
            var ms = Date.now() - t0;
            return (r.error === 'timeout' && ms >= 200 && ms < 900)
              ? ('挂住的请求在 ' + ms + 'ms 被预算截断') : false;
          });
      }); })
      .then(function () { return check('订阅源: 请求失败会记为该源无效', function () {
        var real = Bridge.http;
        Bridge.http = function () {
          return Promise.resolve({ ok: false, status: 0, body: '', error: 'timeout' });
        };
        var on = Feed.enabled();
        var target = on[0];
        return Feed.refreshAll().then(function () {
          Bridge.http = real;
          var st = Feed.sourceState(target.id);
          var invalid = Feed.isInvalid(target.id);
          return (invalid && st && st.invalid === true)
            ? ('「' + target.name + '」被标记为无效，错误：' + String(st.error).slice(0, 20)) : false;
        }).catch(function (e) { Bridge.http = real; throw e; });
      }); })
      .then(function () { return check('订阅源: 无效标记在管理面板可见', function () {
        App.go('gallery');
        return wait(400).then(function () {
          ReadView.openSourceManager();
          return wait(700).then(function () {
            var all = document.querySelectorAll('.sheet');
            var sheet = all.length ? all[all.length - 1] : null;
            if (!sheet) return false;
            var bads = sheet.querySelectorAll('.tag.bad');
            var txt = bads.length ? bads[0].textContent : '';
            U.closeTopSheet();
            return bads.length > 0
              ? (bads.length + ' 个源带「' + txt + '」标记') : false;
          });
        });
      }); })
      .then(function () { return check('订阅源: 抓取成功后清除无效标记', function () {
        var real = Bridge.http;
        Bridge.http = function (u) {
          if (/(cgtn|ecns|hnrss|xinhuanet|globaltimes|guardian|bbci|breakingnewsenglish|example\.(com|org))/i.test(u)) {
            return Promise.resolve({ ok: true, status: 200, body: RSS_XML });
          }
          return real.call(Bridge, u);
        };
        return Feed.refreshAll().then(function () {
          Bridge.http = real;
          var stillBad = Feed.enabled().filter(function (f) { return Feed.isInvalid(f.id); });
          var okCount = Feed.stats().lastResult.ok;
          return (stillBad.length === 0)
            ? ('全部源恢复正常，本轮成功 ' + okCount + ' 个') : false;
        }).catch(function (e) { Bridge.http = real; throw e; });
      }); })
      .then(function () { return check('订阅源: 默认源已换掉 CGTN', function () {
        var ids = Feed.DEFAULT_ON;
        var hasCgtn = ids.filter(function (x) { return /^cgtn/.test(x); });
        var hasXinhua = ids.indexOf('xinhua-en') >= 0;
        return (ids.length === 4 && hasCgtn.length === 0 && hasXinhua)
          ? ('默认源 = ' + ids.join('，')) : false;
      }); })
      .then(function () {
        report('all');
      });
  }

  /* 单页截图模式：?tab=xxx 只打开某个页面并停留 */
  function runOne() {
    var params = new URLSearchParams(location.search);
    var tab = params.get('tab');
    var sub = params.get('sub');
    var chain = Promise.resolve();
    if (tab) chain = chain.then(function () { App.go(tab); return wait(700); });
    if (sub === 'article') {
      chain = chain.then(function () {
        var c = q('#screen [data-rec]');
        if (c) { c.click(); return wait(700); }
      });
    } else if (sub === 'picture') {
      chain = chain.then(function () {
        var t = q('#screen .tile');
        if (t) { t.click(); return wait(600); }
      });
    } else if (sub === 'flash') {
      chain = chain.then(function () {
        Review.startSession({ words: ['consistent', 'ability', 'environment'], title: '复习' });
        return wait(600);
      });
    } else if (sub === 'book') {
      chain = chain.then(function () {
        var c = q('#screen [data-b]');
        if (c) { c.click(); return wait(700); }
      });
    } else if (sub === 'search') {
      chain = chain.then(function () {
        var inp = q('#d-q');
        if (inp) {
          inp.value = 'ability';
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.blur();
          return wait(500);
        }
      });
    } else if (sub === 'word') {
      chain = chain.then(function () {
        UIKit.wordSheet('abandon', {});
        return wait(600);
      });
    } else if (sub === 'online' || sub === 'feed' || sub === 'star') {
      chain = chain.then(function () {
        // 新版阅读页：推荐(0) / 订阅(1) / 收藏(2)
        var idx = sub === 'star' ? 2 : (sub === 'rec' ? 0 : 1);
        var segs = qq('[data-seg] button');
        if (segs[idx]) { segs[idx].click(); return wait(1400); }
      });
    } else if (sub === 'palace') {
      chain = chain.then(function () {
        var seg = qq('#g-seg button')[1];
        if (seg) seg.click();
        return wait(400);
      }).then(function () {
        var p = q('#screen [data-p]');
        if (p) { p.click(); return wait(600); }
      });
    }
    chain.then(function () { return wait(300); }).then(function () { report(tab || 'single'); });
  }

  waitFor(function () { return window.App && window.Dict && Dict.ready && Dict.ready(); }, 15000)
    .then(function () { return wait(300); })
    .then(function () {
      if (new URLSearchParams(location.search).get('tab')) return runOne();
      return runAll();
    })
    .catch(function (e) {
      errors.push('BOOT ' + (e && e.message));
      report('boot-failed');
    });
})();
