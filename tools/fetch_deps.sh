#!/usr/bin/env bash
# 拉取并解包 Tesseract4Android（离线 OCR 内核）到 libs/ 与 prebuilt/。
# Tesseract4Android 以 Apache-2.0 发布，通过 JitPack 分发 AAR。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${TESSERACT_VERSION:-4.9.0}"
WORK="$(mktemp -d)"
COORD="cz/adaptech/tesseract4android/tesseract4android/${VERSION}/tesseract4android-${VERSION}.aar"
URL="https://jitpack.io/${COORD}"

echo "==> 下载 ${URL}"
curl -fL --retry 3 --max-time 600 -o "$WORK/tesseract.aar" "$URL"

echo "==> 解包"
mkdir -p "$WORK/x"
unzip -q -o "$WORK/tesseract.aar" -d "$WORK/x"

mkdir -p "$ROOT/libs" \
         "$ROOT/prebuilt/lib/arm64-v8a" \
         "$ROOT/prebuilt/lib/armeabi-v7a"

cp "$WORK/x/classes.jar" "$ROOT/libs/tesseract4android.jar"
cp "$WORK/x/jni/arm64-v8a/"*.so     "$ROOT/prebuilt/lib/arm64-v8a/"
cp "$WORK/x/jni/armeabi-v7a/"*.so   "$ROOT/prebuilt/lib/armeabi-v7a/"

echo "==> 英文语言包（tessdata_fast，约 2MB）"
mkdir -p "$ROOT/app/assets/tessdata"
curl -fL --retry 3 --max-time 600 \
  -o "$ROOT/app/assets/tessdata/eng.traineddata" \
  "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/eng.traineddata"

rm -rf "$WORK"
echo "完成。"
