#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
扫描源码里需要翻译的中文文案，登记到 tools/i18n/keys.json。

关键点：**保留已有键的顺序，只把新出现的追加到末尾**。
如果按词频重排，加一句文案就会让 en.json 里所有译文错位——
那种错位是静默的，只会表现为「英文界面里冒出几处风马牛不相及的翻译」。

用法：
    python3 tools/i18n_extract.py
"""

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS_DIR = os.path.join(ROOT, 'app', 'assets', 'www', 'js')
I18N_DIR = os.path.join(ROOT, 'tools', 'i18n')
KEYS = os.path.join(I18N_DIR, 'keys.json')

# i18n.js 自带界面标签表，不需要进主词表；i18n-data.js 是生成物
SKIP = {'i18n.js', 'i18n-data.js', 'theme.js'}

# T('...') 已经包好的文案
PAT_T = re.compile(r"\bT\(\s*'((?:[^'\\\n]|\\.)*)'\s*\)|\bT\(\s*\"((?:[^\"\\\n]|\\.)*)\"\s*\)")
# 还没包但含汉字的字面量（提醒去跑 i18n_wrap.py）
PAT_RAW = re.compile(r"'((?:[^'\\\n]|\\.)*[\u4e00-\u9fff](?:[^'\\\n]|\\.)*)'|\"((?:[^\"\\\n]|\\.)*[\u4e00-\u9fff](?:[^\"\\\n]|\\.)*)\"")
HAN = re.compile(r'[\u3400-\u9fff\uf900-\ufaff]')


def strip_comments(s):
    s = re.sub(r'/\*[\s\S]*?\*/', '', s)
    return re.sub(r'(?m)^\s*//.*$', '', s)


def main():
    old = []
    if os.path.isfile(KEYS):
        old = json.load(open(KEYS, encoding='utf-8'))
    known = set(old)

    found = []
    unwrapped = []
    for name in sorted(os.listdir(JS_DIR)):
        if not name.endswith('.js') or name in SKIP:
            continue
        src = strip_comments(open(os.path.join(JS_DIR, name), encoding='utf-8').read())
        for m in PAT_T.finditer(src):
            lit = m.group(1) if m.group(1) is not None else m.group(2)
            lit = lit.replace("\\'", "'").replace('\\"', '"')
            if HAN.search(lit) and lit not in found:
                found.append(lit)
        # 找出漏包装的
        for m in PAT_RAW.finditer(src):
            lit = (m.group(1) if m.group(1) is not None else m.group(2))
            lit = lit.replace("\\'", "'").replace('\\"', '"')
            if HAN.search(lit) and lit not in found and lit not in unwrapped:
                unwrapped.append(lit)

    new = [k for k in found if k not in known]
    keys = old + new
    json.dump(keys, open(KEYS, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)

    print('已登记 %d 条（原有 %d，新增 %d）' % (len(keys), len(old), len(new)))
    for k in new:
        print('  + %s' % k)
    if unwrapped:
        print('\n注意：有 %d 条含汉字的字面量还没包成 T(...)，请先跑 i18n_wrap.py：' % len(unwrapped))
        for k in unwrapped[:10]:
            print('  ? %s' % k[:60])
    gone = [k for k in old if k not in set(found)]
    if gone:
        print('\n提示：%d 条旧键在当前源码里已找不到（保留不动，避免译文错位）：' % len(gone))
        for k in gone[:6]:
            print('  - %s' % k[:50])
    return 0


if __name__ == '__main__':
    sys.exit(main())
