#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
版本号提升工具。

用法：
    python3 tools/bump_version.py patch  -m "修复了某个问题" -m "又改了一处"
    python3 tools/bump_version.py minor  -m "新增阅读模式"
    python3 tools/bump_version.py major  -m "首个正式版"
    python3 tools/bump_version.py current            # 只看当前版本，不改动

做的事：
    1) versionCode 自增 1（Android 用它判断升级，必须单调递增）
    2) versionName 按 SemVer 提升（patch / minor / major）
    3) 在 version.json 的 history 头部插入一条更新日志
    4) buildDate 更新为当天

version.json 是本项目所有版本信息的唯一来源：
build.sh 从它读取包名、版本号、应用名，并把它拷进 APK 供应用内展示。
"""

import json
import os
import sys
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VERSION_FILE = os.path.join(ROOT, 'version.json')

BUMP_KINDS = ('major', 'minor', 'patch')


def load():
    with open(VERSION_FILE, encoding='utf-8') as f:
        return json.load(f)


def save(data):
    with open(VERSION_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write('\n')


def bump_name(name, kind):
    parts = (name or '1.0.0').split('.')
    while len(parts) < 3:
        parts.append('0')
    try:
        major, minor, patch = (int(x) for x in parts[:3])
    except ValueError:
        raise SystemExit('versionName 不是形如 1.2.3 的格式：%s' % name)

    if kind == 'major':
        major, minor, patch = major + 1, 0, 0
    elif kind == 'minor':
        minor, patch = minor + 1, 0
    else:
        patch += 1
    return '%d.%d.%d' % (major, minor, patch)


def main(argv):
    kind = argv[1] if len(argv) > 1 else 'patch'
    if kind not in BUMP_KINDS and kind != 'current':
        raise SystemExit('用法：bump_version.py [major|minor|patch|current] -m "改动说明"')

    data = load()

    if kind == 'current':
        print('%s  versionName=%s  versionCode=%d  日期=%s' % (
            data.get('appName', ''), data.get('versionName', ''),
            data.get('versionCode', 0), data.get('buildDate', '')))
        return 0

    # 收集 -m / --message 后面的说明
    notes = []
    i = 2
    while i < len(argv):
        a = argv[i]
        if a in ('-m', '--message'):
            if i + 1 >= len(argv):
                raise SystemExit('-m 后面要跟一句改动说明')
            notes.append(argv[i + 1].strip())
            i += 2
        else:
            notes.append(a.strip())
            i += 1
    notes = [n for n in notes if n]

    today = date.today().isoformat()
    old_code = int(data.get('versionCode', 0))
    new_code = old_code + 1
    new_name = bump_name(data.get('versionName', '1.0.0'), kind)

    data['versionCode'] = new_code
    data['versionName'] = new_name
    data['buildDate'] = today

    entry = {
        'version': new_name,
        'code': new_code,
        'date': today,
        'title': notes[0] if notes else '例行更新',
        'changes': notes if notes else ['例行更新'],
    }
    hist = data.get('history') or []
    hist.insert(0, entry)
    data['history'] = hist

    save(data)

    print('版本已提升：%s  (versionCode %d -> %d)' % (new_name, old_code, new_code))
    for n in entry['changes']:
        print('  · ' + n)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
