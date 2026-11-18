#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成 app/assets/www/js/i18n-data.js。

产物包含三张表：
  1. EN          —— 简体界面文案 → 英文（人工撰写，见 tools/i18n/en.json）
  2. HANT        —— 简体界面文案 → 繁体（OpenCC 精确转换，含词组规则，如 头发→頭髮）
  3. HANT_PHRASES—— 词组级简→繁映射（只保留本项目文本里真正出现的词组）
  4. HANT_CHARS  —— 单字级简→繁映射，兜底处理动态内容（词典释义等）

为什么要三张表：
  界面固定文案走「整串精确映射」，结果最准；
  词典释义这类动态文本没有固定串，只能先查词组表、再逐字兜底。
  纯逐字兜底会出洋相——「头发」会转成「頭發」而不是「頭髮」，
  所以词组表是必需的，只是只保留本项目里真正用得上的那些，避免把
  一份 1MB 的全球词组表塞进安装包。

依赖：opencc-python-reimplemented（仅在重新生成时需要，构建 APK 不需要）。

用法：
    python3 tools/i18n_build.py
"""

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
I18N_DIR = os.path.join(ROOT, 'tools', 'i18n')
KEYS = os.path.join(I18N_DIR, 'keys.json')
EN = os.path.join(I18N_DIR, 'en.json')
OUT = os.path.join(ROOT, 'app', 'assets', 'www', 'js', 'i18n-data.js')

# 这些位置的 OpenCC 都找一下：正常安装的、以及手工解包的 wheel
CANDIDATES = [
    '/tmp/occx',
    os.path.join(ROOT, 'tools', '.opencc'),
]


def load_opencc():
    for p in CANDIDATES:
        if os.path.isdir(p) and p not in sys.path:
            sys.path.insert(0, p)
    try:
        from opencc import OpenCC
    except ImportError:
        print('缺少 opencc。请先安装：\n'
              '  pip3 install --break-system-packages opencc-python-reimplemented\n'
              '或把 wheel 解包到 /tmp/occx 后重试。', file=sys.stderr)
        raise SystemExit(2)
    return OpenCC('s2t')


def collect_dynamic_text():
    """收集需要逐字兜底的全部中文文本（界面 + 内置数据 + 词库释义）。"""
    import glob
    parts = []
    for pat in ('app/assets/www/js/*.js', 'app/assets/www/css/*.css',
                'app/assets/www/index.html', 'app/assets/data/*.json'):
        for f in glob.glob(os.path.join(ROOT, pat)):
            if f.endswith('i18n-data.js'):
                continue
            try:
                parts.append(open(f, encoding='utf-8').read())
            except Exception:
                pass
    return '\n'.join(parts)


def js_str(s):
    """安全地写成 JS 字符串字面量（用 JSON 转义即可，JSON 是 JS 的子集）。"""
    return json.dumps(s, ensure_ascii=False)


def main():
    keys = json.load(open(KEYS, encoding='utf-8'))
    en = json.load(open(EN, encoding='utf-8'))

    if len(keys) != len(en):
        print('键与译文数量不一致：%d vs %d' % (len(keys), len(en)), file=sys.stderr)
        raise SystemExit(1)

    cc = load_opencc()

    en_map = {}
    hant_map = {}
    edge_warn = []
    empty = 0
    same = 0

    for k, v in zip(keys, en):
        en_map[k] = v
        h = cc.convert(k)
        if h != k:
            hant_map[k] = h
        else:
            same += 1
        if v == '':
            empty += 1
        # 拼接型文案靠首尾空格对齐，写错了会让两段文字黏在一起，这里逐个提示以便复核
        if v and (k.startswith(' ') != v.startswith(' ')) and not (k.startswith('') and False):
            edge_warn.append((k, v, '首'))
        if v and (k.endswith(' ') != v.endswith(' ')):
            edge_warn.append((k, v, '尾'))

    # 词组表：只保留本项目文本里真正出现过的词组
    text = collect_dynamic_text()
    phrase_map = {}
    phrases_file = None
    for cand in ('/tmp/occx/opencc/dictionary/STPhrases.txt',
                 os.path.join(ROOT, 'tools', '.opencc', 'opencc', 'dictionary', 'STPhrases.txt')):
        if os.path.isfile(cand):
            phrases_file = cand
            break
    if phrases_file:
        for line in open(phrases_file, encoding='utf-8'):
            line = line.rstrip('\n')
            if not line or '\t' not in line:
                continue
            simp, trad = line.split('\t', 1)
            if len(simp) >= 2 and simp != trad and simp in text:
                phrase_map[simp] = trad

    # 单字级兜底表
    chars = sorted(set(c for c in text if '\u4e00' <= c <= '\u9fff'))
    char_map = {}
    for c in chars:
        t = cc.convert(c)
        if t != c:
            char_map[c] = t
    max_phrase = max([len(k) for k in phrase_map] or [0])

    lines = [
        '/* 本文件由 tools/i18n_build.py 生成，请勿手工修改。',
        ' * 源：tools/i18n/keys.json（按顺序的原文）+ tools/i18n/en.json（英文）+ OpenCC（繁体）',
        ' * 条目数：%d 条英文 / %d 条繁体整串映射 / %d 个繁体词组 / %d 个繁简单字' % (
            len(en_map), len(hant_map), len(phrase_map), len(char_map)),
        ' * 繁体最长词组：%d 字（前端按最长优先匹配）*/' % max_phrase,
        '(function (global) {',
        "  'use strict';",
        '  global.I18N_DATA = {',
    ]

    def dump_map(name, d, last=False):
        tail = '' if last else ','
        if not d:
            lines.append('    %s: {}%s' % (name, tail))
            return
        lines.append('    %s: {' % name)
        buf = []
        for k, v in d.items():
            buf.append('      %s: %s' % (js_str(k), js_str(v)))
        lines.append(',\n'.join(buf))
        lines.append('    }%s' % tail)

    # 注意：块之间要有逗号，漏掉会让整份数据变成语法错误——
    # 而语法错误的表现是「所有文案都没翻译」，排查起来很绕。
    dump_map('en', en_map)
    dump_map('hant', hant_map)
    dump_map('hantPhrases', phrase_map)
    dump_map('hantChars', char_map, last=True)
    lines.append('  };')
    lines.append('})(typeof window !== "undefined" ? window : this);')
    lines.append('')

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, 'w', encoding='utf-8').write('\n'.join(lines))

    size = os.path.getsize(OUT)
    print('已生成 %s（%.1f KB）' % (os.path.relpath(OUT, ROOT), size / 1024))
    print('  英文条目      : %d（其中映射为空串 %d 条）' % (len(en_map), empty))
    print('  繁体精确映射  : %d（另有 %d 条简繁同形，无需映射）' % (len(hant_map), same))
    print('  繁体词组映射  : %d（最长 %d 字）' % (len(phrase_map), max_phrase))
    print('  繁简单字兜底  : %d' % len(char_map))
    if edge_warn:
        print('  首尾空格不一致 %d 处（拼接文案需逐条确认）：' % len(edge_warn))
        for k, v, w in edge_warn:
            print('    %s空格  %-22s -> %s' % (w, repr(k), repr(v)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
