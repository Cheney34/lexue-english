/*
 * test-dict-books.js —— 自定义词书（1.3.1）的离线单元测试
 *
 * 本机没有 node/chromium，用 JDK 自带的 Nashorn 跑：
 *   jjs -scripting tools/test-dict-books.js
 * 输出以 TEST-DONE: n failure(s) of m checks 结束，退出码非 0 表示失败。
 */

var failures = 0;
var checks = 0;
function ok(cond, name, extra) {
  checks++;
  if (!cond) { failures++; print('FAIL  ' + name + (extra ? '   << ' + extra : '')); }
  else { print('ok    ' + name); }
}

// ---------- 最小运行环境（Nashorn 没有 Promise，写个同步版） ----------
var window = {};
var T = function (s) { return s; };

function P(v) { this.v = v; }
function unwrap(x) { while (x instanceof P) { x = x.v; } return x; }
P.prototype.then = function (a, b) {
  try {
    var r = a ? a(this.v) : this.v;
    return (r instanceof P) ? r : new P(r);
  } catch (e) {
    if (b) { var r2 = b(e); return (r2 instanceof P) ? r2 : new P(r2); }
    throw e;
  }
};
P.prototype['catch'] = function (b) {
  try { return new P(unwrap(this.v)); } catch (e) { if (b) { return new P(b(e)); } throw e; }
};
var Promise = {
  resolve: function (v) { return new P(v); },
  all: function (arr) {
    return new P(arr.map(function (p) { return unwrap(p); }));
  }
};

var FIXTURE = {
  words: { v: 1, count: 4, w: ['apple', 'book', 'cat', 'dog'],
           p: ['ˈæpl', 'bʊk', 'kæt', 'dɒg'],
           t: ['n. 苹果', 'n. 书', 'n. 猫', 'n. 狗'],
           g: ['zgoc', 'zgoc', '', ''],
           r: [100, 200, 0, 0] },
  books: { v: 1, books: [{ id: 'core', name: '高频核心词', desc: '', order: 1, color: '#3d5a80', count: 2 }] }
};

function fetch(url) {
  var body = (url.indexOf('words.json') >= 0) ? FIXTURE.words : FIXTURE.books;
  return new P({ json: function () { return new P(body); } });
}

load('app/assets/www/js/dict.js');
var Dict = window.Dict;

Dict.load();
ok(Dict.ready() === true, '内置词库装载完成');
ok(Dict.wordCount() === 4, '内置词数 4', Dict.wordCount());

// ---------- 导入两本自定义词书 ----------
Dict.setCustomBooks([
  { id: 'c1', name: '人教版一年级上', desc: '导入词书 · 3 词', color: '#4c956c',
    words: [['resilience', 'rɪˈzɪliəns', 'n. 恢复力'], ['apple', 'ˈæpl', 'n. 苹果（自定义）'], ['ruler', 'ˈruːlə', 'n. 尺']] },
  { id: 'c2', name: '新概念一', desc: '', color: '#5c6bc0',
    words: [['excuse', 'ɪkˈskjuːs', 'n. 借口'], ['apple', 'ˈæpl', 'n. 苹果（第二本）']] }
]);

var ids = Dict.getBooks().map(function (b) { return b.id; });
ok(ids.length === 3 && ids[0] === 'core' && ids[1] === 'c1' && ids[2] === 'c2',
  '词书列表 = 内置 + 两本自定义', ids.join(','));

ok(Dict.bookCount('c1') === 3, 'c1 词数 3', Dict.bookCount('c1'));
ok(Dict.bookCount('c2') === 2, 'c2 词数 2', Dict.bookCount('c2'));
ok(Dict.bookById('c1').name === '人教版一年级上', 'bookById 认自定义词书');
ok(Dict.bookById('c1').custom === true, '自定义标记存在');

var e = Dict.lookup('Resilience');
ok(!!e && e.trans === 'n. 恢复力', 'lookup 命中自定义词（大小写无关）', e && e.trans);
ok(Dict.lookup('ruler') !== null, 'lookup ruler');
ok(Dict.lookup('excuse') !== null, 'lookup excuse');
ok(Dict.lemma('resilience') !== null, 'lemma 也能落回自定义词');
ok(Dict.lookup('zzzznope') === null, '不存在的词仍返回 null');

var apple = Dict.lookup('apple');
ok(apple && apple.trans === 'n. 苹果' && !apple.custom, '内置词优先于自定义词', apple && apple.trans);

ok(Dict.inBook(Dict.lookup('ruler'), 'c1') === true, 'ruler 属于 c1');
ok(Dict.inBook(Dict.lookup('ruler'), 'c2') === false, 'ruler 不属于 c2');
ok(Dict.inBook(Dict.lookup('book'), 'c1') === false, '内置词 book 不在 c1 里');
ok(Dict.inBook(apple, 'all') === true, 'all 通配');

var ents = Dict.bookEntries('c1');
ok(ents.length === 3, 'c1 词表 3 条', ents.length);
ok(ents[0].word === 'resilience', 'c1 词表首词 resilience', ents[0].word);

var hits = Dict.search('res', { bookId: 'all' });
ok(hits.length === 1 && hits[0].word === 'resilience', '搜索 res 命中自定义词',
  hits.map(function (x) { return x.word; }).join(','));
ok(Dict.search('res', { bookId: 'c2' }).length === 0, '限定 c2 时搜不到 resilience');
ok(Dict.bookCount('core') === 2, 'core 词数仍按词频算', Dict.bookCount('core'));

Dict.setCustomBooks([{ id: 'c9', name: '只有一本', words: [['solo', '', 'adj. 单独的']] }]);
ok(Dict.getBooks().length === 2, '重设后只剩内置 + 1 本', Dict.getBooks().length);
ok(Dict.lookup('resilience') === null, '旧的导入词已清除');
ok(Dict.lookup('solo') !== null, '新的导入词可用');

print('');
print('TEST-DONE: ' + failures + ' failure(s) of ' + checks + ' checks');
if (failures > 0) { java.lang.System.exit(1); }
