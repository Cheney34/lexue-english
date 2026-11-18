#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把界面里的中文字符串包成 T(...)，让它们可以被翻译。

为什么用自动改写而不是手工加：
    界面文案有 600 多条，散在 13 个文件里。手工改一遍既慢又容易漏，
    而这件事本身是纯机械的——扫描字符串字面量、判断是否需要翻译、
    包一层函数调用。

安全性来自三点：
    1. T() 在简体中文下是**恒等函数**，包上之后默认行为完全不变；
    2. 扫描器会跳过注释、正则字面量、模板字符串，不会误伤；
    3. 已经有 90 多条端到端断言，改错了会被测出来。

用法：
    python3 tools/i18n_wrap.py           # 就地改写
    python3 tools/i18n_wrap.py --check   # 只报告不修改
"""

import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS_DIR = os.path.join(ROOT, 'app', 'assets', 'www', 'js')

# 这两个文件本身就是词典，里面的中文字面量是被翻译的对象，不能再包一层
SKIP = {'i18n.js', 'i18n-data.js', 'theme.js'}

HAN = re.compile(r'[\u3400-\u9fff\uf900-\ufaff]')

# 正则字面量的前一个有意义字符是这些时，才认为 / 开始的是正则而不是除法
REGEX_PREV = set('(,=:[!&|?{};+-*%~^<>')


def scan_and_wrap(src):
    """返回 (新文本, 包装数量)。"""
    out = []
    i = 0
    n = len(src)
    wrapped = 0

    def prev_sig(idx):
        j = idx - 1
        while j >= 0 and src[j] in ' \t\r\n':
            j -= 1
        return src[j] if j >= 0 else ''

    while i < n:
        c = src[i]

        # 行注释
        if c == '/' and i + 1 < n and src[i + 1] == '/':
            j = src.find('\n', i)
            j = n if j < 0 else j
            out.append(src[i:j])
            i = j
            continue

        # 块注释
        if c == '/' and i + 1 < n and src[i + 1] == '*':
            j = src.find('*/', i + 2)
            j = n if j < 0 else j + 2
            out.append(src[i:j])
            i = j
            continue

        # 模板字符串：整体跳过（里面有 ${} 表达式，逐字处理容易出错）
        if c == '`':
            j = i + 1
            while j < n:
                if src[j] == '\\':
                    j += 2
                    continue
                if src[j] == '`':
                    j += 1
                    break
                j += 1
            out.append(src[i:j])
            i = j
            continue

        # 正则字面量：整体跳过，避免把里面的内容当成字符串
        if c == '/' and prev_sig(i) in REGEX_PREV:
            j = i + 1
            in_class = False
            while j < n:
                ch = src[j]
                if ch == '\\':
                    j += 2
                    continue
                if ch == '[':
                    in_class = True
                elif ch == ']':
                    in_class = False
                elif ch == '/' and not in_class:
                    j += 1
                    break
                elif ch == '\n':
                    break
                j += 1
            # 只有确实找到了结束斜杠才当正则处理
            if j <= n and j - 1 < n and src[j - 1] == '/':
                out.append(src[i:j])
                i = j
                continue

        # 字符串字面量
        if c == "'" or c == '"':
            quote = c
            j = i + 1
            while j < n:
                ch = src[j]
                if ch == '\\':
                    j += 2
                    continue
                if ch == quote:
                    break
                if ch == '\n':
                    break
                j += 1

            if j < n and src[j] == quote:
                lit = src[i:j + 1]
                inner = src[i + 1:j]
                # 已经是 T(...) 的就不要再包一层（重复运行要保持幂等）
                already = re.search(r'\bT\s*\(\s*$', src[max(0, i - 8):i]) is not None
                if HAN.search(inner) and not already:
                    before = prev_sig(i)
                    # 对象字面量的键不能包：{ '中文': 1 }
                    after = src[j + 1:j + 3].strip()
                    is_key = (before in '{,' and after.startswith(':'))
                    if not is_key:
                        out.append('T(' + lit + ')')
                        wrapped += 1
                        i = j + 1
                        continue
                out.append(lit)
                i = j + 1
                continue

        out.append(c)
        i += 1

    return ''.join(out), wrapped


def main(argv):
    check = '--check' in argv
    total = 0
    changed_files = []

    for name in sorted(os.listdir(JS_DIR)):
        if not name.endswith('.js') or name in SKIP:
            continue
        path = os.path.join(JS_DIR, name)
        src = open(path, encoding='utf-8').read()
        new, cnt = scan_and_wrap(src)
        if cnt:
            total += cnt
            changed_files.append((name, cnt))
            if not check:
                open(path, 'w', encoding='utf-8').write(new)

    for name, cnt in changed_files:
        print('  %-22s %3d 处' % (name, cnt))
    print('共 %d 处%s' % (total, '（仅检查，未写入）' if check else '已包装'))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
