#!/usr/bin/env bash
# 实测订阅源连通性：按 Net.java 的 UA 与超时逐个请求，判定是否返回有效 RSS
# 用法: bash tools/check_feeds.sh [feeds.json 路径]
#
# ⚠ 结论可信度：连续扫几十个源会被上层网络限流，表现为「本来可用的源偶发返回
#   拦截页或超时」，且每轮失败的名单都不一样。所以本脚本适合发现「明显长期失效」
#   的源（连续几轮都失败、或直接 HTTP 000），不适合据此逐个改 cn 标记——
#   单个源要下结论，请单独 curl 复测两三次，以应用内「测试连接」为准。
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FEEDS="${1:-$ROOT/app/assets/data/feeds.json}"

python3 - "$FEEDS" <<'PYEOF' > /tmp/feed-urls.txt
import json, sys
d = json.load(open(sys.argv[1], encoding='utf-8'))
for c in d['categories']:
    for f in c['feeds']:
        print('%s\t%s\t%s\t%s' % (f['id'], f['name'], f.get('cn'), f['url']))
PYEOF

UA="Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
ok=0; bad=0
printf '%-10s %-6s %-28s %s\n' 结果 标记 源 说明
# 抓三次再下结论：实测不少站点对连续请求会偶发返回拦截页，且 12 秒超时
# 对慢源（Nature 110KB、Ars 75KB）根本不够——曾经因此把一批可用源误判为失效。
# 每次间隔 3 秒、超时放宽到 20 秒，才能滤掉抖动，得到稳定结论。
fetch() {
  local url="$1" i out
  for i in 1 2 3; do
    # -L 跟随跳转（不少源会 301/308 到最终地址），--compressed 解 gzip
    # （少这一项时，服务端返回的 gzip 二进制会让「是不是 RSS」的判断直接误报）
    out=$(curl -sS -m 20 -L --compressed -A "$UA" -w '\n%{http_code}' "$url" 2>/dev/null)
    code=$(printf '%s' "$out" | tail -1)
    body=$(printf '%s' "$out" | head -n -1)
    if [ "$code" = "200" ] && printf '%s' "$body" \
        | grep -qiE '<(rss|feed|rdf:RDF)|<channel|<item|<entry'; then
      return 0
    fi
    [ "$i" -lt 3 ] && sleep 3
  done
  return 1
}

while IFS=$'\t' read -r id name cn url; do
  if fetch "$url"; then
    n=$(printf '%s' "$body" | grep -oiE '<(item|entry)[ >]' | wc -l | tr -d ' ')
    printf '%-10s %-6s %-28s %s 条\n' "✓" "$cn" "$name" "$n"; ok=$((ok+1))
  elif [ "$code" != "200" ]; then
    printf '%-10s %-6s %-28s HTTP %s\n' "✗" "$cn" "$name" "$code"; bad=$((bad+1))
  else
    printf '%-10s %-6s %-28s 非 RSS（可能是拦截页）\n' "✗" "$cn" "$name"; bad=$((bad+1))
  fi
  sleep 0.3
done < /tmp/feed-urls.txt
echo
echo "可解析 $ok 个，失败 $bad 个"
