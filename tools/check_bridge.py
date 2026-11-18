#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
JS ⇄ 原生 桥接契约静态校验。

背景：Bridge.java 里 @JavascriptInterface 方法的参数顺序，必须和
assets/www/js/bridge.js 里发起的调用完全一致。曾经踩过一次坑——
JS 把 callId 放在参数末尾，Java 却期望它在最前，导致 url 收到空字符串，
请求静默失败、回调打到不存在的 callId 上，最终表现为「网络超时」，
而单元测试因为打桩了 Bridge.http 完全发现不了。

约定：所有异步方法第一个参数固定为 callId；同步方法直接按签名传参。

用法：python3 tools/check_bridge.py        （不通过则退出码 1）
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JAVA = os.path.join(ROOT, 'app', 'java', 'com', 'wordpalace', 'app', 'Bridge.java')
JS = os.path.join(ROOT, 'app', 'assets', 'www', 'js', 'bridge.js')

TYPES = r'(?:final\s+)?(?:String|int|float|boolean|long|double)'


def java_methods(src):
    """返回 {name: [paramName, ...]}，仅含 @JavascriptInterface 方法。"""
    out = {}
    for m in re.finditer(r'@JavascriptInterface\s+public\s+\w+\s+(\w+)\s*\(([^)]*)\)', src):
        name, params = m.group(1), m.group(2).strip()
        names = []
        if params:
            for p in split_top(params):
                p = p.strip()
                pm = re.search(r'(\w+)\s*$', p)
                names.append(pm.group(1) if pm else p)
        out[name] = names
    return out


def split_top(s):
    """按顶层逗号切分（忽略泛型尖括号与括号内的逗号）。"""
    out, depth, cur, i = [], 0, '', 0
    while i < len(s):
        c = s[i]
        if c in '<([':
            depth += 1
        elif c in '>)]':
            depth -= 1
        if c == ',' and depth == 0:
            out.append(cur)
            cur = ''
        else:
            cur += c
        i += 1
    if cur.strip():
        out.append(cur)
    return out


def js_arg_count(text):
    """统计一个 JS 数组字面量 `[...]` 顶层的元素个数。"""
    s = text.strip()
    if not (s.startswith('[') and s.endswith(']')):
        return None
    inner = s[1:-1].strip()
    if not inner:
        return 0
    return len(split_top_js(inner))


def split_top_js(s):
    out, depth, cur, i, quote = [], 0, '', 0, None
    while i < len(s):
        c = s[i]
        if quote:
            if c == '\\':
                cur += s[i:i + 2]
                i += 2
                continue
            if c == quote:
                quote = None
            cur += c
        else:
            if c in '"\'`':
                quote = c
                cur += c
            elif c in '([{':
                depth += 1
                cur += c
            elif c in ')]}':
                depth -= 1
                cur += c
            elif c == ',' and depth == 0:
                out.append(cur)
                cur = ''
            else:
                cur += c
        i += 1
    if cur.strip():
        out.append(cur)
    return out


def match_bracket(s, start, open_ch, close_ch):
    """返回从 start（指向 open_ch）开始、配对的 close_ch 下标。"""
    depth, i, quote = 0, start, None
    while i < len(s):
        c = s[i]
        if quote:
            if c == '\\':
                i += 2
                continue
            if c == quote:
                quote = None
        elif c in '"\'`':
            quote = c
        elif c == open_ch:
            depth += 1
        elif c == close_ch:
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1


def main():
    java_src = open(JAVA, encoding='utf-8').read()
    js_src = open(JS, encoding='utf-8').read()
    methods = java_methods(java_src)

    problems = []
    checked = 0

    # ---- 异步调用：call('name', [args], timeout) ----
    for m in re.finditer(r"call\(\s*'(\w+)'\s*,\s*", js_src):
        name = m.group(1)
        arr_start = js_src.index('[', m.end())
        arr_end = match_bracket(js_src, arr_start, '[', ']')
        if arr_end < 0:
            problems.append('%s: 解析 call(%s) 的参数数组失败' % (JS, name))
            continue
        n = js_arg_count(js_src[arr_start:arr_end + 1])
        checked += 1
        if name not in methods:
            problems.append('JS 调用了原生不存在的异步方法 %s()' % name)
            continue
        params = methods[name]
        if not params or params[0] != 'callId':
            problems.append('%s(): Java 第一个参数必须是 callId，当前为 %r'
                            % (name, params[0] if params else None))
            continue
        if n != len(params) - 1:
            problems.append('%s(): 参数个数不匹配——JS 传 %d 个业务参数，Java 期望 %d 个 %s'
                            % (name, n, len(params) - 1, params[1:]))

    # ---- 同步调用：N.xxx(args) ----
    async_names = {m.group(1) for m in re.finditer(r"call\(\s*'(\w+)'", js_src)}
    for m in re.finditer(r'\bN\.(\w+)\s*\(', js_src):
        name = m.group(1)
        if name in async_names or name in ('apply', 'call'):
            continue
        par_start = js_src.index('(', m.end() - 1)
        par_end = match_bracket(js_src, par_start, '(', ')')
        if par_end < 0:
            continue
        args = js_src[par_start + 1:par_end].strip()
        n = 0 if not args else len(split_top_js(args))
        checked += 1
        if name not in methods:
            problems.append('JS 调用了原生不存在的同步方法 %s()' % name)
            continue
        params = methods[name]
        if params and params[0] == 'callId':
            problems.append('%s(): 这是异步方法（首参为 callId），应当用 call() 调用' % name)
        elif n != len(params):
            problems.append('%s(): 参数个数不匹配——JS 传 %d 个，Java 期望 %d 个 %s'
                            % (name, n, len(params), params))

    # ---- 通用分发器：N[name].apply(N, ...) 必须把 id 放在参数最前 ----
    disp = re.search(r'N\[name\]\.apply\s*\(', js_src)
    if disp:
        par_start = js_src.index('(', disp.end() - 1)
        par_end = match_bracket(js_src, par_start, '(', ')')
        checked += 1
        if par_end < 0:
            problems.append('解析 N[name].apply(...) 失败')
        else:
            args = split_top_js(js_src[par_start + 1:par_end])
            if len(args) != 2:
                problems.append('N[name].apply 应当只有两个参数（thisArg 与参数数组）')
            else:
                second = args[1].strip()
                if not re.match(r'^\[\s*id\s*\]\s*\.concat\b', second):
                    problems.append(
                        'N[name].apply 的第二个参数必须以 [id].concat(...) 开头'
                        '（callId 必须是原生方法的第一个参数），当前为: %s'
                        % second[:70])
    else:
        problems.append('未找到 N[name].apply 通用分发器，桥接实现可能已变更')

    # ---- 未在 JS 中使用的原生方法（仅提示）----
    unused = [k for k in methods if ("'%s'" % k) not in js_src and ('N.%s' % k) not in js_src]

    print('桥接契约检查：比对 %d 处调用，原生方法 %d 个' % (checked, len(methods)))
    if unused:
        print('  提示：以下原生方法 JS 侧未使用 ->', ', '.join(sorted(unused)))
    if problems:
        print()
        for p in problems:
            print('  ✗', p)
        print()
        print('契约校验失败：JS 与 Java 的方法签名不一致。')
        return 1
    print('  ✓ 全部一致（异步方法首参均为 callId）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
