/* 本地数据层：IndexedDB（图片 / 宫殿 / 卡片）+ localStorage（设置）+ SM-2 复习算法 */
(function (global) {
  'use strict';

  var DB_NAME = 'wordpalace';
  var DB_VER = 1;
  var STORES = {
    images: { keyPath: 'id', indexes: [['createdAt', 'createdAt'], ['tags', 'tags', { multiEntry: true }]] },
    palaces: { keyPath: 'id', indexes: [['createdAt', 'createdAt']] },
    cards: { keyPath: 'id', indexes: [['due', 'due'], ['word', 'word'], ['createdAt', 'createdAt']] },
    daily: { keyPath: 'd', indexes: [] },
    meta: { keyPath: 'k', indexes: [] }
  };

  var db = null;
  var cardCache = null;
  // pending | ok | blocked | timeout | error | absent —— 供诊断面板读取
  var idbState = 'pending';

  var DEFAULT_SETTINGS = {
    bookId: 'cet4',
    ttsRate: 1,
    // auto = 优先英语发音；system = 直接用系统默认语音（只装了中文引擎时也能出声）
    ttsMode: 'auto',
    autoSpeak: true,
    onlineDict: true,
    dailyNew: 20,
    dailyLimit: 120,
    showCue: true,
    autoFeed: true,
    lang: 'auto',            // auto | zh-Hans | zh-Hant | en
    theme: 'auto',           // auto | light | dark
    feeds: null,
    blocked: [],
    readerFont: 17,
    readerHl: true,
    // 默认标签是「数据」而不是界面文案：一旦保存就归用户所有，不该随界面语言变
    tags: ['客厅', '厨房', '卧室', '书房', '通勤', '自然', '人物']
  };

  function loadSettings() {
    var s = {};
    for (var k in DEFAULT_SETTINGS) if (DEFAULT_SETTINGS.hasOwnProperty(k)) s[k] = DEFAULT_SETTINGS[k];
    try {
      var raw = localStorage.getItem('wp.settings');
      if (raw) {
        var o = JSON.parse(raw);
        for (var j in o) if (o.hasOwnProperty(j)) s[j] = o[j];
      }
    } catch (e) {}
    return s;
  }

  /* ------------------------------------------------------------------
   * 打开数据库。
   *
   * 这里必须带超时：部分 ROM（实测澎湃 OS / Android 17 上出现）会让
   * indexedDB.open() 既不发 onsuccess 也不发 onerror —— Promise 永远挂着，
   * 启动流程的 Promise.all 跟着一起挂，界面就永远停在「正在装载词库…」。
   * 超时后按「内存模式」继续跑：功能可用，只是关掉应用数据不保留。
   * ------------------------------------------------------------------ */
  var IDB_TIMEOUT = 7000;
  var openPromise = null;

  function open() {
    if (db) return Promise.resolve(db);
    if (openPromise) return openPromise;
    openPromise = new Promise(function (resolve, reject) {
      var req;
      var settled = false;
      var timer = null;
      function finish(fn, v) {
        if (settled) return;
        settled = true;
        if (timer) { clearTimeout(timer); timer = null; }
        fn(v);
      }
      try {
        if (!global.indexedDB) { idbState = 'absent'; throw new Error('IndexedDB 不可用'); }
        req = indexedDB.open(DB_NAME, DB_VER);
      } catch (e) {
        idbState = 'absent';
        finish(reject, e);
        return;
      }
      timer = setTimeout(function () {
        idbState = 'timeout';
        finish(reject, new Error('IndexedDB 打开超时（' + (IDB_TIMEOUT / 1000) + 's 无响应）'));
      }, IDB_TIMEOUT);
      req.onblocked = function () {
        idbState = 'blocked';
        finish(reject, new Error('IndexedDB 被占用（onblocked）'));
      };
      req.onupgradeneeded = function () {
        var d = req.result;
        for (var name in STORES) {
          if (!STORES.hasOwnProperty(name)) continue;
          var def = STORES[name];
          if (d.objectStoreNames.contains(name)) continue;
          var os = d.createObjectStore(name, { keyPath: def.keyPath });
          (def.indexes || []).forEach(function (ix) {
            try { os.createIndex(ix[0], ix[1], ix[2] || {}); } catch (e) {}
          });
        }
      };
      req.onsuccess = function () {
        db = req.result;
        idbState = 'ok';
        db.onversionchange = function () { try { db.close(); } catch (e) {} db = null; openPromise = null; };
        finish(resolve, db);
      };
      req.onerror = function () { idbState = 'error'; finish(reject, req.error); };
    });
    // 失败不缓存这个坏 Promise：稍后（比如用户清一次应用数据）还能重试
    openPromise.catch(function () { openPromise = null; });
    return openPromise;
  }

  function tx(store, mode) {
    return open().then(function (d) {
      return d.transaction(store, mode || 'readonly').objectStore(store);
    });
  }

  function wrap(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  var mem = {};   // 内存兜底（IndexedDB 不可用时，例如无痕模式）

  function put(store, obj) {
    return tx(store, 'readwrite').then(function (os) {
      return wrap(os.put(obj));
    }).then(function () {
      return obj;
    }).catch(function () {
      mem[store] = mem[store] || {};
      mem[store][obj.id || obj.k || obj.d] = obj;
      return obj;
    });
  }

  function get(store, key) {
    return tx(store, 'readonly').then(function (os) {
      return wrap(os.get(key));
    }).catch(function () {
      return (mem[store] || {})[key];
    });
  }

  function all(store) {
    return tx(store, 'readonly').then(function (os) {
      return wrap(os.getAll());
    }).catch(function () {
      var o = mem[store] || {};
      return Object.keys(o).map(function (k) { return o[k]; });
    });
  }

  function del(store, key) {
    return tx(store, 'readwrite').then(function (os) {
      return wrap(os.delete(key));
    }).catch(function () {
      if (mem[store]) delete mem[store][key];
    });
  }

  function clearStore(store) {
    return tx(store, 'readwrite').then(function (os) {
      return wrap(os.clear());
    }).catch(function () { mem[store] = {}; });
  }

  /* ============================== 设置 ============================== */

  var settings = loadSettings();

  function saveSettings() {
    try { localStorage.setItem('wp.settings', JSON.stringify(settings)); } catch (e) {}
  }

  /* ============================== 图片 ============================== */

  function addImage(data) {
    var img = {
      id: U.uid('img'),
      dataUrl: data.dataUrl,
      title: data.title || '',
      tags: data.tags || [],
      note: data.note || '',
      ocrText: data.ocrText || '',
      words: data.words || [],
      palaceId: data.palaceId || '',
      createdAt: Date.now()
    };
    return put('images', img);
  }

  function listImages() {
    return all('images').then(function (list) {
      return (list || []).sort(function (a, b) { return b.createdAt - a.createdAt; });
    });
  }

  /* ============================== 宫殿 ============================== */

  function addPalace(name, desc) {
    return put('palaces', {
      id: U.uid('pal'),
      name: name || T('未命名宫殿'),
      desc: desc || '',
      loci: [],
      createdAt: Date.now()
    });
  }

  function listPalaces() {
    return all('palaces').then(function (list) {
      return (list || []).sort(function (a, b) { return a.createdAt - b.createdAt; });
    });
  }

  /* ============================== 卡片 ============================== */

  function normalizeCard(word, extra) {
    var now = Date.now();
    return {
      id: String(word).toLowerCase(),
      word: String(word),
      phonetic: extra.phonetic || '',
      trans: extra.trans || '',
      note: extra.note || '',
      source: extra.source || 'manual',
      bookId: extra.bookId || settings.bookId,
      imageIds: extra.imageIds || [],
      palaceId: extra.palaceId || '',
      ease: 2.5,
      interval: 0,
      reps: 0,
      lapses: 0,
      state: 'new',
      due: now,
      lastReview: 0,
      createdAt: now
    };
  }

  function getCard(word) {
    return get('cards', String(word).toLowerCase());
  }

  function listCards() {
    return all('cards');
  }

  /** 所有卡片的内存索引（word -> card），供高频查询使用 */
  function cardMap(refresh) {
    if (cardCache && !refresh) return Promise.resolve(cardCache);
    return listCards().then(function (list) {
      var m = {};
      (list || []).forEach(function (c) { m[c.id] = c; });
      cardCache = m;
      return m;
    });
  }

  function upsertCard(word, extra) {
    extra = extra || {};
    return getCard(word).then(function (old) {
      var card = old || normalizeCard(word, extra);
      if (old) {
        if (extra.trans) card.trans = extra.trans;
        if (extra.phonetic) card.phonetic = extra.phonetic;
        if (extra.note) card.note = extra.note;
        if (extra.imageIds && extra.imageIds.length) {
          card.imageIds = union(card.imageIds, extra.imageIds);
        }
        if (extra.palaceId) card.palaceId = extra.palaceId;
      }
      return put('cards', card).then(function () {
        cardCache = null;
        return { card: card, isNew: !old };
      });
    });
  }

  function union(a, b) {
    var out = (a || []).slice();
    (b || []).forEach(function (x) { if (out.indexOf(x) < 0) out.push(x); });
    return out;
  }

  function deleteCard(word) {
    cardCache = null;
    return del('cards', String(word).toLowerCase());
  }

  /**
   * SM-2 变体。grade: 0=忘记 1=模糊 2=记得 3=简单
   * 返回更新后的卡片。
   */
  function applyReview(card, grade) {
    var q = [2, 3, 4, 5][grade] || 4;
    var now = Date.now();
    card.lastReview = now;

    if (q < 3) {
      card.lapses++;
      card.reps = 0;
      card.interval = 0;
      card.state = 'learning';
      card.due = now + 10 * 60 * 1000;              // 10 分钟后重来
    } else {
      card.reps++;
      if (card.state === 'new' || card.state === 'learning') card.state = 'review';
      if (card.reps === 1) card.interval = 1;
      else if (card.reps === 2) card.interval = 6;
      else card.interval = Math.max(1, Math.round(card.interval * card.ease));
      if (grade === 3) card.interval = Math.max(1, Math.round(card.interval * 1.3));
      card.due = now + card.interval * 86400000;
    }

    card.ease = Math.max(1.3, card.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
    return put('cards', card).then(function () {
      cardCache = null;
      return card;
    });
  }

  function dueCards() {
    var now = Date.now();
    return listCards().then(function (list) {
      var due = (list || []).filter(function (c) { return c.due <= now; });
      due.sort(function (a, b) { return a.due - b.due; });
      return due;
    });
  }

  function newCards(limit) {
    return listCards().then(function (list) {
      var n = (list || []).filter(function (c) { return c.state === 'new'; });
      n.sort(function (a, b) { return a.createdAt - b.createdAt; });
      return n.slice(0, limit);
    });
  }

  /* ============================== 统计 ============================== */

  function today() { return U.dayKey(); }

  function bumpDaily(field, n) {
    var d = today();
    return get('daily', d).then(function (row) {
      row = row || { d: d, reviewed: 0, learned: 0, correct: 0 };
      row[field] = (row[field] || 0) + (n === undefined ? 1 : n);
      return put('daily', row);
    });
  }

  function recentDaily(days) {
    days = days || 7;
    var out = [];
    var now = new Date();
    var tasks = [];
    for (var i = days - 1; i >= 0; i--) {
      var dt = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      var key = U.dayKey(dt);
      out.push({ d: key, label: (dt.getMonth() + 1) + '/' + dt.getDate(), reviewed: 0, learned: 0 });
      tasks.push(key);
    }
    return all('daily').then(function (rows) {
      var map = {};
      (rows || []).forEach(function (r) { map[r.d] = r; });
      out.forEach(function (o) {
        var r = map[o.d];
        if (r) { o.reviewed = r.reviewed || 0; o.learned = r.learned || 0; }
      });
      return out;
    });
  }

  function streak() {
    return all('daily').then(function (rows) {
      var set = {};
      (rows || []).forEach(function (r) { if ((r.reviewed || 0) > 0) set[r.d] = 1; });
      var n = 0;
      var dt = new Date();
      // 今天没复习不清零，从昨天开始算
      if (!set[U.dayKey(dt)]) dt.setDate(dt.getDate() - 1);
      while (set[U.dayKey(dt)]) {
        n++;
        dt.setDate(dt.getDate() - 1);
      }
      return n;
    });
  }

  function cardStats() {
    return listCards().then(function (list) {
      var s = { total: 0, new: 0, learning: 0, review: 0, mastered: 0, due: 0 };
      var now = Date.now();
      (list || []).forEach(function (c) {
        s.total++;
        if (c.state === 'new') s.new++;
        else if (c.state === 'learning') s.learning++;
        else s.review++;
        if (c.interval >= 21) s.mastered++;
        if (c.due <= now) s.due++;
      });
      return s;
    });
  }

  /* ======================== 通用键值（缓存/已读标记等） ======================== */

  function getMeta(k) {
    return get('meta', k).then(function (row) { return row ? row.v : null; });
  }

  function putMeta(k, v) {
    return put('meta', { k: k, v: v });
  }

  /* ============================== 导出/导入 ============================== */

  function exportAll() {
    return Promise.all([listCards(), listImages(), listPalaces()]).then(function (r) {
      return JSON.stringify({
        v: 1, exportedAt: Date.now(),
        settings: settings, cards: r[0], images: r[1], palaces: r[2]
      });
    });
  }

  function importAll(json) {
    var o = typeof json === 'string' ? JSON.parse(json) : json;
    var jobs = [];
    (o.cards || []).forEach(function (c) { jobs.push(put('cards', c)); });
    (o.images || []).forEach(function (c) { jobs.push(put('images', c)); });
    (o.palaces || []).forEach(function (c) { jobs.push(put('palaces', c)); });
    cardCache = null;
    return Promise.all(jobs);
  }

  global.Store = {
    init: open,
    settings: settings,
    saveSettings: saveSettings,
    resetSettings: function () { settings = loadSettings(); },

    // 存储健康度：诊断面板用它判断「数据能不能落地」
    get storageState() { return idbState; },
    get memoryMode() { return !db; },

    addImage: addImage, listImages: listImages, getImage: function (id) { return get('images', id); },
    putImage: function (o) { return put('images', o); }, delImage: function (id) { return del('images', id); },

    addPalace: addPalace, listPalaces: listPalaces,
    getPalace: function (id) { return get('palaces', id); },
    putPalace: function (o) { return put('palaces', o); },
    delPalace: function (id) { return del('palaces', id); },

    getCard: getCard, listCards: listCards, cardMap: cardMap,
    upsertCard: upsertCard, deleteCard: deleteCard,
    applyReview: applyReview, dueCards: dueCards, newCards: newCards,
    cardStats: cardStats,

    bumpDaily: bumpDaily, recentDaily: recentDaily, streak: streak,

    getMeta: getMeta, putMeta: putMeta,

    exportAll: exportAll, importAll: importAll,
    clearAll: function () {
      cardCache = null;
      return Promise.all([clearStore('cards'), clearStore('images'), clearStore('palaces')]);
    }
  };
})(window);
