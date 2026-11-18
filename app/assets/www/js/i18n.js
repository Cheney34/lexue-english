/**
 * 多语言运行时。
 *
 * 设计取舍：
 *
 * 1. **词表按「简体原文」索引**，而不是给每条文案起英文键名。
 *    这样源码里写的仍是中文（对中文开发者可读），`T('删除')` 在没有对应
 *    译文时安全地返回原文——未翻译只是「没翻译」，不会变成空白或乱码。
 *
 * 2. **繁体走转换而不是另写一份词表**：
 *    英文必须逐条翻译，但繁体只是字形差异，用 OpenCC 的精确映射 + 单字兜底
 *    就能覆盖全部界面乃至词典释义，且不需要维护第二份中文。
 *
 * 3. **跟随系统时的判定**：系统语言里有中文就用中文（按 zh-TW/zh-HK 等
 *    判断繁体），否则一律英文——即「有中文用中文，默认其他语言用 en_US」。
 */
(function (global) {
  'use strict';

  var DATA = global.I18N_DATA || { en: {}, hant: {}, hantChars: {} };
  var LANGS = ['zh-Hans', 'zh-Hant', 'en'];
  var HAN = /[\u3400-\u9fff\uf900-\ufaff]/;

  var current = 'zh-Hans';

  /* ---------------- 语言判定 ---------------- */

  function systemTags() {
    var tags = [];
    try {
      if (global.navigator && global.navigator.languages && global.navigator.languages.length) {
        tags = Array.prototype.slice.call(global.navigator.languages);
      }
    } catch (e) {}
    if (!tags.length) {
      try {
        if (global.navigator && global.navigator.language) tags = [global.navigator.language];
      } catch (e) {}
    }
    return tags.map(function (t) { return String(t || ''); });
  }

  /** 依据偏好（auto / zh-Hans / zh-Hant / en）解析出实际使用的语言 */
  function resolve(pref) {
    if (LANGS.indexOf(pref) >= 0) return pref;
    var tags = systemTags();
    for (var i = 0; i < tags.length; i++) {
      var t = tags[i].toLowerCase().replace('_', '-');
      if (t === 'zh' || t.indexOf('zh-') === 0) {
        // 繁体地区：台湾 / 香港 / 澳门 / 显式 Hant
        return /hant|tw|hk|mo/.test(t) ? 'zh-Hant' : 'zh-Hans';
      }
    }
    return 'en';
  }

  /* ---------------- 翻译 ---------------- */

  /**
   * 逐段转繁体（用于词典释义这类没有固定串的动态文本）。
   *
   * 必须**先按词组匹配、匹配不上再逐字**：逐字转换会把「头发」变成
   * 「頭發」而不是「頭髮」，这类错误在释义里非常显眼。
   * 词组表只收本项目文本里出现过的词组，最长 8 字。
   */
  var MAX_PHRASE = 8;

  function toHant(s) {
    var chars = DATA.hantChars || {};
    var phrases = DATA.hantPhrases || {};
    var out = '';
    var i = 0;
    var n = s.length;
    while (i < n) {
      var hit = null;
      var max = n - i < MAX_PHRASE ? n - i : MAX_PHRASE;
      for (var len = max; len >= 2; len--) {
        var sub = s.substr(i, len);
        if (phrases[sub] !== undefined) { hit = phrases[sub]; i += len; break; }
      }
      if (hit !== null) { out += hit; continue; }
      var c = s.charAt(i);
      out += chars[c] || c;
      i++;
    }
    return out;
  }

  /**
   * 翻译一个字符串。
   * 非字符串、空串、纯 ASCII 一律原样返回（绝大多数调用都命中这条快路径）。
   */
  function T(s) {
    if (typeof s !== 'string' || !s) return s;
    if (current === 'zh-Hans') return s;
    if (!HAN.test(s)) return s;          // 没有汉字，没什么可翻的
    if (current === 'en') {
      var e = DATA.en[s];
      return e === undefined ? s : e;
    }
    var h = DATA.hant[s];
    return h === undefined ? toHant(s) : h;
  }

  /* ---------------- 界面自身的标签 ----------------
   * 这几个词是「设置」界面自己的文案，不进主词表，
   * 因为它们是语言切换的载体——必须在任何语言下都可读。
   */
  var UI = {
    settings:     ['设置', '設定', 'Settings'],
    language:     ['语言', '語言', 'Language'],
    appearance:   ['外观', '外觀', 'Appearance'],
    followSystem: ['跟随系统', '跟隨系統', 'Follow system'],
    light:        ['浅色', '淺色', 'Light'],
    dark:         ['深色', '深色', 'Dark'],
    langAuto:     ['跟随系统（有中文用中文，否则英文）', '跟隨系統（有中文用中文，否則英文）', 'Follow system (Chinese if available, otherwise English)'],
    themeAuto:    ['跟随系统设置', '跟隨系統設定', 'Follow system setting'],
    themeHint:    ['深色模式在夜间阅读更省眼', '深色模式在夜間閱讀更省眼', 'Dark mode is easier on the eyes at night'],
    moreSettings: ['更多设置', '更多設定', 'More settings'],
    restartHint:  ['切换后立即生效', '切換後立即生效', 'Takes effect immediately'],
    /* 发音（TTS）与诊断：这两处是会「出故障」的地方，文案必须在任何语言下
     * 都能读，所以放在这张手写表里，不进自动生成的 i18n-data.js。 */
    ttsEngine:    ['发音引擎', '發音引擎', 'Speech engine'],
    ttsAuto:      ['自动（优先英语发音）', '自動（優先英語發音）', 'Automatic (prefer English voice)'],
    ttsSystem:    ['系统默认引擎', '系統預設引擎', 'System default engine'],
    ttsOpen:      ['打开系统语音设置', '開啟系統語音設定', 'Open system speech settings'],
    ttsHint:      ['没有声音或发音不标准时，先打开系统语音设置，装上英语语音', '沒有聲音或發音不標準時，先開啟系統語音設定，裝上英語語音', 'If there is no sound, open the system speech settings and install an English voice'],
    diagnostics:  ['诊断信息', '診斷資訊', 'Diagnostics'],
    diagHint:     ['白屏 / 转圈 / 订阅源拉不到时，复制这里的文本发给我', '白屏 / 轉圈 / 訂閱源拉不到時，複製這裡的文字發給我', 'If the screen is blank or feeds fail, copy this text to report it'],
    /* 在线查词（1.2.3）：这几个串是「查不到词」时的出口，必须在任何语言下可读 */
    dictWeb:      ['浏览器查词', '瀏覽器查詞', 'Open in browser'],
    dictWebHint:  ['也可以点「浏览器查词」，用系统浏览器里的词典页面查', '也可以點「瀏覽器查詞」，用系統瀏覽器裡的詞典頁面查', 'You can also use "Open in browser" to look it up in a dictionary page'],
    dictOpened:   ['已用系统浏览器打开词典', '已用系統瀏覽器開啟詞典', 'Opened the dictionary in your browser'],
    dictOpenFail: ['打不开浏览器，请手动搜索：', '打不開瀏覽器，請手動搜尋：', 'Could not open a browser, please search manually: '],
    onlineTried:  ['已尝试：', '已嘗試：', 'Tried: '],
    onlineVia:    ['按原形查到：', '按原形查到：', 'Matched by base form: '],
    onlineNet:    ['联网查询失败（网络不通或被拦截），请稍后重试', '聯網查詢失敗（網路不通或被攔截），請稍後重試', 'Online lookup failed (network blocked?), please retry later'],
    onlineParse:  ['联网查到了内容但解析不出来（接口可能改版），可点「浏览器查词」', '聯網查到了內容但解析不出來（接口可能改版），可點「瀏覽器查詞」', 'Got a response but could not parse it (API may have changed); try "Open in browser"'],
    onlineNone:   ['在线词典里也没有查到这个词', '線上詞典裡也沒有查到這個詞', 'Not found in the online dictionaries either'],
    /* 中英对照（1.3.0）：阅读页「对照」按钮与译文行 */
    biLabel:      ['对照', '對照', 'Bilingual'],
    biPending:    ['正在翻译…', '正在翻譯…', 'Translating…'],
    biProgress:   ['正在翻译', '正在翻譯', 'Translating'],
    biDoneFail:   ['有几段没翻出来，点那段可以重试', '有幾段沒翻出來，點那段可以重試', 'Some paragraphs failed; tap one to retry'],
    biFail:       ['这段没翻出来，点一下重试', '這段沒翻出來，點一下重試', 'Translation failed; tap to retry'],
    biQuota:      ['免费翻译额度用完了，稍后再试；也可以点「原文」去浏览器看', '免費翻譯額度用完了，稍後再試；也可以點「原文」去瀏覽器看', 'Free translation quota used up; retry later or open the original'],
    biRetryHint:  ['点一下重新翻译这一段', '點一下重新翻譯這一段', 'Tap to retranslate this paragraph'],
    /* 导入词书（1.3.1）：词书数据不进 APK、不进仓库，只落本机 */
    importBook:   ['导入词书（JSON 文件）', '匯入詞書（JSON 檔案）', 'Import word book (JSON)'],
    importBookHint: ['把 xlsx 词书用 tools/xlsx_to_book.ps1 转成 JSON 后在这里导入；导入的词书只保存在本机，不会写进词库文件。', '把 xlsx 詞書用 tools/xlsx_to_book.ps1 轉成 JSON 後在這裡匯入；匯入的詞書只保存在本機，不會寫進詞庫檔案。', 'Convert an xlsx word book to JSON with tools/xlsx_to_book.ps1, then import it here. Imported books stay on this device.'],
    customBook:   ['自定义', '自訂', 'Custom'],
    delBook:      ['删除', '刪除', 'Delete'],
    delBookTitle: ['删除词书', '刪除詞書', 'Delete word book'],
    delBookBody:  ['确定删除「', '確定刪除「', 'Delete "'],
    delBookBody2: ['」？只会删掉这本词书，学习记录不受影响。', '」？只會刪掉這本詞書，學習記錄不受影響。', '"? Only this book is removed; your study records stay.'],
    importOpening:['正在打开文件选择器…', '正在開啟檔案選擇器…', 'Opening file picker…'],
    importBadJson:['这不是有效的 JSON 文件', '這不是有效的 JSON 檔案', 'Not a valid JSON file'],
    importEmpty:  ['文件里没有可用的词书', '檔案裡沒有可用的詞書', 'No usable word book in this file'],
    importDone:   ['已导入 ', '已匯入 ', 'Imported '],
    importDoneEnd:[' 本词书', ' 本詞書', ' word book(s)'],
    readFailed:   ['读取失败', '讀取失敗', 'Read failed'],
    importFailed: ['导入失败：', '匯入失敗：', 'Import failed: '],
    noStore:      ['本地存储不可用，无法保存导入的词书', '本機儲存不可用，無法儲存匯入的詞書', 'Local storage unavailable; cannot save the imported book'],
    unnameBook:   ['未命名词书', '未命名詞書', 'Untitled book'],
    customDesc:   ['自定义词书 · ', '自訂詞書 · ', 'Custom book · '],
    wordUnit:     [' 词', ' 詞', ' words'],
    deletedOk:    ['已删除', '已刪除', 'Deleted']
  };

  function idx() { return current === 'en' ? 2 : (current === 'zh-Hant' ? 1 : 0); }

  /** 取界面标签（设置面板自身用） */
  function L(key) {
    var v = UI[key];
    return v ? v[idx()] : key;
  }

  /** 语言按钮上的显示名：始终用该语言自己的写法 */
  function langName(code) {
    if (code === 'en') return 'English';
    if (code === 'zh-Hant') return '繁體中文';
    return '简体中文';
  }

  /* ---------------- 生效与切换 ---------------- */

  function apply() {
    try { global.document.documentElement.setAttribute('lang', current); } catch (e) {}
  }

  /**
   * 初始化 / 切换语言。
   * pref 为 'auto' | 'zh-Hans' | 'zh-Hant' | 'en'
   */
  function setLang(pref) {
    var next = resolve(pref);
    var changed = next !== current;
    current = next;
    apply();
    // 界面文案是渲染时翻译的，改语言要把已经画出来的重画一遍
    try {
      if (global.App && global.App.onLocaleChange) global.App.onLocaleChange();
    } catch (e) {}
    return changed;
  }

  global.T = T;
  global.I18N = {
    t: T,
    L: L,
    langName: langName,
    setLang: setLang,
    resolve: resolve,
    systemTags: systemTags,
    toHant: toHant,
    get lang() { return current; },
    get isDefault() { return current === 'zh-Hans'; }
  };
})(typeof window !== 'undefined' ? window : this);
