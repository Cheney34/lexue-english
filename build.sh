#!/usr/bin/env bash
# 手工构建 APK：aapt2 -> javac -> d8 -> 打包 -> zipalign -> apksigner
# 不依赖 Gradle / AGP，因此无需访问 maven.google.com。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SDK="${ANDROID_HOME:-/opt/android-sdk}"
BT="$SDK/build-tools/34.0.0"
PLATFORM="$SDK/platforms/android-34/android.jar"
APP="$ROOT/app"
BUILD="$ROOT/build"
VERSION_FILE="$ROOT/version.json"

# ---- 版本信息：以 version.json 为唯一来源 ----
[ -f "$VERSION_FILE" ] || { echo "缺少 $VERSION_FILE"; exit 1; }
eval "$(python3 - "$VERSION_FILE" <<'PYEOF'
import json, sys, shlex
d = json.load(open(sys.argv[1], encoding='utf-8'))
for k, v in (('APP_NAME', d.get('appName', 'App')),
             ('VERSION_NAME', d.get('versionName', '1.0.0')),
             ('VERSION_CODE', d.get('versionCode', 1)),
             ('BUILD_DATE', d.get('buildDate', ''))):
    print('%s=%s' % (k, shlex.quote(str(v))))
PYEOF
)"
OUT_APK="${OUT_APK:-$ROOT/${APP_NAME}-v${VERSION_NAME}.apk}"

echo "==> 构建 ${APP_NAME} v${VERSION_NAME} (versionCode ${VERSION_CODE}, ${BUILD_DATE})"

# 应用名同样来自 version.json：生成 strings.xml，避免两处各写一份名字
mkdir -p "$APP/res/values"
python3 - "$APP/res/values/strings.xml" "$APP_NAME" <<'PYEOF'
import sys
path, name = sys.argv[1], sys.argv[2]
xml = ('<?xml version="1.0" encoding="utf-8"?>\n'
       '<!-- 由 build.sh 从 version.json 生成，请勿手工修改 -->\n'
       '<resources>\n'
       '    <string name="app_name">%s</string>\n'
       '</resources>\n' % name)
open(path, 'w', encoding='utf-8').write(xml)
PYEOF

# 把版本信息拷进 assets，应用内「关于 / 更新日志」直接读它
cp "$VERSION_FILE" "$APP/assets/www/version.json"

JAVA_LIBS="$ROOT/libs/tesseract4android.jar"

for f in "$BT/aapt2" "$BT/d8" "$BT/zipalign" "$BT/apksigner" "$PLATFORM"; do
  [ -e "$f" ] || { echo "缺少构建组件: $f"; exit 1; }
done
[ -f "$JAVA_LIBS" ] || { echo "缺少 $JAVA_LIBS（请先运行 tools/fetch_deps.sh）"; exit 1; }

rm -rf "$BUILD"
mkdir -p "$BUILD/res" "$BUILD/gen" "$BUILD/classes" "$BUILD/dex"

echo "==> [1/7] 生成图标"
python3 "$ROOT/tools/make_icon.py" > /dev/null

echo "==> [2/7] aapt2 compile 资源"
"$BT/aapt2" compile --dir "$APP/res" -o "$BUILD/res.zip"

echo "==> [2.5/7] 校验 JS ⇄ 原生 桥接契约"
if [ -f "$ROOT/tools/check_bridge.py" ]; then
  python3 "$ROOT/tools/check_bridge.py" || {
    echo "构建中止：JS 与 Java 的桥接签名不一致（见上方 ✗ 项）"; exit 1; }
fi

echo "==> [3/7] aapt2 link（含 assets）"
"$BT/aapt2" link \
  -o "$BUILD/base.apk" \
  -I "$PLATFORM" \
  --manifest "$APP/AndroidManifest.xml" \
  "$BUILD/res.zip" \
  -A "$APP/assets" \
  --java "$BUILD/gen" \
  --min-sdk-version 21 \
  --target-sdk-version 34 \
  --version-code "$VERSION_CODE" \
  --version-name "$VERSION_NAME"

echo "==> [4/7] javac 编译 Java 源码"
SRCS=$(find "$APP/java" "$BUILD/gen" -name '*.java')
# 注意：这里绝不能用 `| ... || true` 吞掉退出码——曾经因此打包出一个
# 缺少 MainActivity/Bridge 的 APK（安装即闪退），而构建却显示成功。
set +e
javac -nowarn -source 8 -target 8 \
  -encoding UTF-8 \
  -classpath "$PLATFORM:$JAVA_LIBS" \
  -d "$BUILD/classes" \
  $SRCS > "$BUILD/javac.log" 2>&1
JAVAC_RC=$?
set -e
grep -v "bootstrap class path" "$BUILD/javac.log" || true
if [ $JAVAC_RC -ne 0 ]; then
  echo
  echo "构建中止：javac 编译失败（错误见上）"
  exit 1
fi
for c in com/wordpalace/app/MainActivity.class com/wordpalace/app/Bridge.class; do
  if [ ! -f "$BUILD/classes/$c" ]; then
    echo "构建中止：缺少编译产物 $c"
    exit 1
  fi
done
echo "    编译通过，应用类齐备"

echo "==> [5/7] d8 生成 dex"
CLASSES=$(find "$BUILD/classes" -name '*.class')
"$BT/d8" --release --min-api 21 --lib "$PLATFORM" \
  --output "$BUILD/dex" $CLASSES "$JAVA_LIBS" > /dev/null

# 校验 dex 里真的有应用类，避免打包出“空壳 APK”
python3 - "$BUILD/dex/classes.dex" <<'PYEOF'
import sys, os
p = sys.argv[1]
if not os.path.exists(p):
    print('构建中止：d8 未生成 classes.dex'); sys.exit(1)
data = open(p, 'rb').read()
need = [b'Lcom/wordpalace/app/MainActivity;', b'Lcom/wordpalace/app/Bridge;',
        b'Lcom/wordpalace/app/Ocr;', b'Lcom/wordpalace/app/CaptureProvider;']
missing = [n.decode() for n in need if n not in data]
if missing:
    print('构建中止：classes.dex 缺少应用类 ->', ', '.join(missing)); sys.exit(1)
print('    classes.dex 校验通过（%d 字节，应用类齐备）' % len(data))
PYEOF

echo "==> [6/7] 组装 APK（dex + 原生库）"
cp "$BUILD/base.apk" "$BUILD/unsigned.apk"
( cd "$BUILD/dex" && zip -q -X "$BUILD/unsigned.apk" classes.dex )
if [ -d "$ROOT/prebuilt/lib" ]; then
  # ABIS 可覆盖，例如 ABIS=arm64-v8a 可再省约 1.8MB（代价是不支持 32 位老机型）
  ABIS="${ABIS:-arm64-v8a armeabi-v7a}"
  LIBS=""
  for abi in $ABIS; do
    [ -d "$ROOT/prebuilt/lib/$abi" ] && LIBS="$LIBS $abi"
  done
  echo "    打包原生库 ABI:$LIBS"
  for abi in $LIBS; do
    ( cd "$ROOT/prebuilt" && zip -q -X "$BUILD/unsigned.apk" lib/$abi/*.so )
  done
fi

echo "==> [7/7] zipalign + 签名"
"$BT/zipalign" -f -p 4 "$BUILD/unsigned.apk" "$BUILD/aligned.apk"

# 签名口令不入库：优先环境变量，其次本机私有文件 tools/_local_secrets.sh（.gitignore 排除 tools/_*）
[ -f "$ROOT/tools/_local_secrets.sh" ] && . "$ROOT/tools/_local_secrets.sh"
KS_ALIAS="${WP_KEYSTORE_ALIAS:-${KS_ALIAS:-}}"
KS_PASS="${WP_KEYSTORE_PASS:-${KS_PASS:-}}"
if [ -z "$KS_ALIAS" ] || [ -z "$KS_PASS" ]; then
  echo "错误：未设置签名口令。请 export WP_KEYSTORE_PASS / WP_KEYSTORE_ALIAS，或提供 tools/_local_secrets.sh（见 README 第五节）" >&2
  exit 1
fi
KS="${WP_KEYSTORE_PATH:-$ROOT/keystore.jks}"
if [ ! -f "$KS" ]; then
  echo "    生成签名密钥 keystore.jks"
  keytool -genkeypair -keystore "$KS" -alias "$KS_ALIAS" \
    -keyalg RSA -keysize 2048 -validity 10950 \
    -storetype PKCS12 \
    -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -dname "CN=WordPalace, OU=Personal, O=WordPalace, L=Beijing, ST=Beijing, C=CN" > /dev/null 2>&1
fi

"$BT/apksigner" sign \
  --ks "$KS" --ks-key-alias "$KS_ALIAS" \
  --ks-pass "pass:$KS_PASS" --key-pass "pass:$KS_PASS" \
  --min-sdk-version 21 \
  --v1-signing-enabled true --v2-signing-enabled true \
  --out "$OUT_APK" "$BUILD/aligned.apk"

echo
echo "=== 签名校验 ==="
"$BT/apksigner" verify --min-sdk-version 21 -v "$OUT_APK" | head -8
echo
echo "=== APK 信息 ==="
# 注意：不要写成 `aapt2 dump badging | head -3`——脚本开了 pipefail，
# head 读够就关管道会让 aapt2 收到 SIGPIPE，整条管道非零退出把构建掐断。
BADGING="$("$BT/aapt2" dump badging "$OUT_APK" | sed -n '1,3p')"
echo "$BADGING"
echo
# 校验产物里的版本与应用名确实来自 version.json（防止出现“名字对了版本没进去”这类问题）
python3 - "$OUT_APK" "$VERSION_NAME" "$VERSION_CODE" "$APP_NAME" <<'PYEOF'
import sys, zipfile
apk, want_name, want_code, want_app = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
z = zipfile.ZipFile(apk)
# 版本号写在二进制清单里；应用名是 @string/app_name，实际字符串在 resources.arsc 里。
# 两处都要查，否则会出现「版本对了、名字还是旧的」这种沉默的错误。
manifest = z.read('AndroidManifest.xml')
arsc = z.read('resources.arsc') if 'resources.arsc' in z.namelist() else b''

def has(blob, s):
    return s.encode('utf-16-le') in blob or s.encode('utf-8') in blob

ok = True
if has(arsc, want_app) or has(manifest, want_app):
    print('  ✓ 应用名：%s' % want_app)
else:
    print('  ✗ 应用名不是「%s」（既不在 resources.arsc 也不在清单里）' % want_app); ok = False

if has(manifest, want_name):
    print('  ✓ 版本号：%s（versionCode %s）' % (want_name, want_code))
else:
    print('  ✗ 清单里没有版本号 %s' % want_name); ok = False

if not ok:
    print('构建产物校验失败'); sys.exit(1)
PYEOF

# 明文 HTTP 必须真的放开：订阅源里有只支持 http 的站点，被系统拦掉会表现为
# “网络不通”，很难排查。清单里存的是资源 ID 而不是名字，所以用 aapt2 反解核对。
MAN_XML="$("$BT/aapt2" dump xmltree "$OUT_APK" --file AndroidManifest.xml 2>/dev/null || true)"
NSC_XML="$("$BT/aapt2" dump xmltree "$OUT_APK" --file res/xml/network_security_config.xml 2>/dev/null || true)"
case "$MAN_XML" in
  *networkSecurityConfig*) echo "  ✓ 清单已引用网络安全配置" ;;
  *) echo "  ✗ 清单没有引用 networkSecurityConfig"; exit 1 ;;
esac
case "$NSC_XML" in
  *cleartextTrafficPermitted=true*) echo "  ✓ 明文 HTTP 已放开（cleartextTrafficPermitted=true）" ;;
  *) echo "  ✗ network_security_config 未允许明文 HTTP"; exit 1 ;;
esac

echo
ls -lh "$OUT_APK"
echo "构建完成: $OUT_APK"
