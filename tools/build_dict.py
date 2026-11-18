#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 ECDICT（MIT 协议）生成应用内置的离线词库与分级词书索引。

输入：ecdict.csv（word, phonetic, definition, translation, pos, collins,
                   oxford, tag, bnc, frq, exchange, detail, audio）
输出：app/assets/data/words.json   列式词库（体积最小化）
      app/assets/data/books.json   词书索引（前端按 tag 过滤）

用法：python3 tools/build_dict.py <ecdict.csv> [输出目录]
"""
import csv
import json
import os
import re
import sys

# 考纲标签 -> 单字符标记
TAG_MAP = [
    ("zk", "z"),     # 中考
    ("gk", "g"),     # 高考
    ("cet4", "4"),   # 四级
    ("cet6", "6"),   # 六级
    ("ky", "k"),     # 考研
    ("ielts", "i"),  # 雅思
    ("toefl", "t"),  # 托福
    ("gre", "r"),    # GRE
]

WORD_RE = re.compile(r"^[a-z][a-z'\-]{0,23}$")

BOOKS = [
    {"id": "core", "name": "高频核心词", "desc": "按母语者语料频率排序的最常用词，任何考试都绕不开",
     "order": 1, "color": "#3d5a80"},
    {"id": "zk", "name": "中考核心", "desc": "初中阶段全部考纲词汇，约 1600 词", "order": 2,
     "color": "#4c956c"},
    {"id": "gk", "name": "高考核心", "desc": "高中阶段考纲词汇，含常见派生词", "order": 3,
     "color": "#2a9d8f"},
    {"id": "cet4", "name": "大学英语四级", "desc": "CET-4 大纲词汇，大学英语基础线", "order": 4,
     "color": "#3d5a80"},
    {"id": "cet6", "name": "大学英语六级", "desc": "CET-6 大纲词汇，含四级全部词汇", "order": 5,
     "color": "#5c6bc0"},
    {"id": "ky", "name": "考研英语", "desc": "考研英语一/二大纲词汇", "order": 6,
     "color": "#7b5ea7"},
    {"id": "ielts", "name": "雅思核心", "desc": "IELTS 常考学术与生活词汇", "order": 7,
     "color": "#c9803a"},
    {"id": "toefl", "name": "托福核心", "desc": "TOEFL 学术词汇，偏学术阅读写作", "order": 8,
     "color": "#b5651d"},
    {"id": "gre", "name": "GRE 词汇", "desc": "GRE 高阶词汇，阅读写作拉分项", "order": 9,
     "color": "#8d5a5a"},
    {"id": "oxford", "name": "牛津核心 3000", "desc": "Oxford 3000，英语学习者最该先掌握的词",
     "order": 10, "color": "#2f6f4e"},
]

MAX_TRANS = 68          # 中文释义最大长度
FREQ_CUTOFF = 20000     # 无标签词的最低词频要求


def clean_translation(trans, definition):
    """清洗释义：去掉领域标记行与换行，保留最核心的前 3 个义项。"""
    out = []
    if trans:
        for line in trans.replace("\\n", "\n").split("\n"):
            line = line.strip()
            if not line or line.startswith("["):
                continue
            line = re.sub(r"\s+", " ", line)
            out.append(line)
            if len(out) >= 3:
                break
    s = "；".join(out)
    s = s.replace("；；", "；").strip("； ")
    if len(s) > MAX_TRANS:
        s = s[:MAX_TRANS].rstrip("；，, ") + "…"
    if not s and definition:
        d = re.sub(r"\s+", " ", definition).strip()
        if len(d) > 90:
            d = d[:90].rstrip() + "…"
        s = d
    return s


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    src = sys.argv[1]
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_dir = sys.argv[2] if len(sys.argv) > 2 else os.path.join(root, "app", "assets", "data")
    os.makedirs(out_dir, exist_ok=True)

    words, phones, trans_list, tags, ranks = [], [], [], [], []
    seen = set()

    with open(src, "r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            w = (row.get("word") or "").strip().lower()
            if not WORD_RE.match(w) or w in seen:
                continue

            tag_raw = (row.get("tag") or "").strip()
            tag_str = ""
            for key, ch in TAG_MAP:
                if key in tag_raw.split():
                    tag_str += ch

            oxford = (row.get("oxford") or "0") == "1"
            if oxford:
                tag_str += "o"

            collins = int(row.get("collins") or 0)
            if collins >= 3 and "c" not in tag_str:
                tag_str += "c"

            frq = int(row.get("frq") or 0)
            bnc = int(row.get("bnc") or 0)
            cands = [x for x in (frq, bnc) if x > 0]
            rank = min(cands) if cands else 0

            if not tag_str and not (0 < rank <= FREQ_CUTOFF):
                continue

            t = clean_translation(row.get("translation"), row.get("definition"))
            if not t:
                continue
            if not tag_str and len(t) < 2:
                continue

            seen.add(w)
            words.append(w)
            phones.append((row.get("phonetic") or "").strip()[:32])
            trans_list.append(t)
            tags.append(tag_str)
            ranks.append(rank)

    order = sorted(range(len(words)), key=lambda i: (ranks[i] if ranks[i] > 0 else 10 ** 9, words[i]))
    words = [words[i] for i in order]
    phones = [phones[i] for i in order]
    trans_list = [trans_list[i] for i in order]
    tags = [tags[i] for i in order]
    ranks = [ranks[i] for i in order]

    data = {
        "v": 1,
        "count": len(words),
        "w": words,
        "p": phones,
        "t": trans_list,
        "g": tags,
        "r": ranks,
    }
    words_path = os.path.join(out_dir, "words.json")
    with open(words_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))

    # 词书覆盖统计
    tag_index = {b["id"]: 0 for b in BOOKS}
    for tg in tags:
        for key, ch in TAG_MAP:
            if ch in tg:
                pass
        for b in BOOKS:
            if b["id"] == "core":
                continue
            ch = dict(TAG_MAP).get(b["id"])
            if ch and ch in tg:
                tag_index[b["id"]] += 1
        if "o" in tg:
            tag_index["oxford"] += 1
    tag_index["core"] = sum(1 for r in ranks if 0 < r <= 3000)

    for b in BOOKS:
        b["count"] = tag_index.get(b["id"], 0)

    books_path = os.path.join(out_dir, "books.json")
    with open(books_path, "w", encoding="utf-8") as f:
        json.dump({"v": 1, "books": BOOKS}, f, ensure_ascii=False, separators=(",", ":"))

    print("词条总数:", len(words))
    print("words.json:", round(os.path.getsize(words_path) / 1048576, 2), "MB")
    print("books.json:", round(os.path.getsize(books_path) / 1024, 1), "KB")
    for b in BOOKS:
        print("  {:10s} {:>6d}  {}".format(b["id"], b["count"], b["name"]))


if __name__ == "__main__":
    main()
