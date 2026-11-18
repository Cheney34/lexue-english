#Requires -Version 5.1
<#
.SYNOPSIS
    乐学英语 (WordPalace) 手工构建 APK —— build.sh 的 Windows PowerShell 移植版。

.DESCRIPTION
    流水线：aapt2 compile -> check_bridge -> aapt2 link -> javac -> d8 -> 组装 -> zipalign -> apksigner。
    不依赖 Gradle / AGP，因此无需访问 maven.google.com。

    与原 build.sh 的差异（均为适配 Windows，不改产物语义）：
      * python3 的三处用途（解析 version.json、生成 strings.xml、二进制校验）改为原生 PowerShell 实现；
      * `zip` 不可用，改用 .NET System.IO.Compression.ZipArchive 追加 classes.dex 与 lib/*.so；
      * `find` / `sed` / `head` 改为 Get-ChildItem / Select-Object；
      * 签名与验签直接调用 `java -jar apksigner.jar`（绕开 .bat 的 cmd 代码页问题，中文路径也安全）；
      * make_icon.py 依赖 PIL 且图标已存在，故仅在图标缺失时才尝试生成；
      * 新增 [3.5/7] 步骤：修正 Windows 版 aapt2 写出的 assets 反斜杠条目名（详见该步骤注释）。

    红线（来自 HANDOVER.md，移植时一并保留）：
      1. 绝不用 `| ... || true` 之类吞掉退出码 —— 曾因此打包出缺少 MainActivity/Bridge 的 APK，
         安装即闪退，而构建却显示成功。本脚本对每一步都显式检查 $LASTEXITCODE。
      2. 版本号只从 version.json 读，应用名与 strings.xml 由它生成，避免两处各写一份。
      3. 必须校验产物里真的含有应用类、应用名、版本号与 assets 条目。

.PARAMETER SdkPath
    Android SDK 根目录（需含 build-tools\34.0.0 与 platforms\android-34）。默认按
    $env:ANDROID_HOME / $env:ANDROID_SDK_ROOT / ..\..\android-sdk / 系统 SDK 依次探测。

.PARAMETER JavaPath
    JDK 根目录（需含 bin\javac.exe）。默认按 $env:JAVA_HOME / Zulu 17 / Zulu 21 / Android Studio JBR 依次探测。

.PARAMETER OutApk
    输出 APK 路径。默认 <项目根>\<应用名>-v<版本号>.apk。

.PARAMETER Abis
    打包的原生库 ABI，默认 arm64-v8a armeabi-v7a。例如 -Abis arm64-v8a 可再省约 1.8MB。

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1
#>
[CmdletBinding()]
param(
    [string]$SdkPath,
    [string]$JavaPath,
    [string]$OutApk,
    [string[]]$Abis = @('arm64-v8a', 'armeabi-v7a')
)

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

# zip 读写（[3.5/7] 与 [6/7] 都要用，提前加载，避免 "Unable to find type [IO.Compression.ZipFile]"）
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$ROOT = $PSScriptRoot
if (-not $ROOT) { $ROOT = (Get-Location).Path }
$APP = Join-Path $ROOT 'app'
$BUILD = Join-Path $ROOT 'build'
$VERSION_FILE = Join-Path $ROOT 'version.json'

function Die {
    param([string]$Message)
    Write-Host ''
    Write-Host "构建中止：$Message" -ForegroundColor Red
    exit 1
}

function Write-Step {
    param([string]$Message)
    Write-Host "==> $Message"
}

# 执行原生程序，返回退出码；输出写入 $Log（若有），否则由调用方决定是否回显。
function Invoke-Native {
    param(
        [string]$Exe,
        [string[]]$Arguments,
        [string]$Log
    )
    $lines = & $Exe @Arguments 2>&1 | ForEach-Object {
        if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.ToString() } else { [string]$_ }
    }
    $rc = $LASTEXITCODE
    if ($Log) {
        $lines | Set-Content -Path $Log -Encoding UTF8
    }
    return [pscustomobject]@{ ExitCode = $rc; Output = @($lines) }
}

# 用 Latin-1 做字节序列查找（1 字节 ↔ 1 字符，不会因编码替换而失配）
function Test-BytesContain {
    param([byte[]]$Haystack, [string]$Needle)
    return ([Text.Encoding]::GetEncoding(28591).GetString($Haystack)).Contains($Needle)
}

function Get-BytesAsText {
    param([byte[]]$Bytes)
    return [Text.Encoding]::GetEncoding(28591).GetString($Bytes)
}

# 把字符串按 UTF-16LE 或 UTF-8 编码后映射成 Latin-1 文本，便于在二进制里查找
function Get-Latin1Of {
    param([string]$Text, [bool]$Utf16)
    $bytes = if ($Utf16) { [Text.Encoding]::Unicode.GetBytes($Text) } else { [Text.Encoding]::UTF8.GetBytes($Text) }
    return [Text.Encoding]::GetEncoding(28591).GetString($bytes)
}

function Test-ZipEntry {
    param([System.IO.Compression.ZipArchive]$Archive, [string]$Name)
    return ($null -ne $Archive.GetEntry($Name))
}

function Read-ZipEntryBytes {
    param([System.IO.Compression.ZipArchive]$Archive, [string]$Name)
    $e = $Archive.GetEntry($Name)
    if (-not $e) { return $null }
    $ms = New-Object IO.MemoryStream
    $s = $e.Open()
    $s.CopyTo($ms)
    $s.Dispose()
    $bytes = $ms.ToArray()
    $ms.Dispose()
    return $bytes
}

# ---- 版本信息：以 version.json 为唯一来源 ----
if (-not (Test-Path $VERSION_FILE)) { Die "缺少 $VERSION_FILE" }
try {
    $ver = Get-Content -Path $VERSION_FILE -Raw -Encoding UTF8 | ConvertFrom-Json
}
catch {
    Die "解析 $VERSION_FILE 失败：$($_.Exception.Message)"
}
$APP_NAME = if ($ver.appName) { [string]$ver.appName } else { 'App' }
$VERSION_NAME = if ($ver.versionName) { [string]$ver.versionName } else { '1.0.0' }
$VERSION_CODE = if ($ver.versionCode) { [string]$ver.versionCode } else { '1' }
$BUILD_DATE = [string]$ver.buildDate

if (-not $OutApk) { $OutApk = Join-Path $ROOT "$APP_NAME-v$VERSION_NAME.apk" }
Write-Step "构建 $APP_NAME v$VERSION_NAME (versionCode $VERSION_CODE, $BUILD_DATE)"

# ---- 定位 Android SDK ----
if (-not $SdkPath) {
    $candidates = New-Object System.Collections.ArrayList
    if ($env:ANDROID_HOME) { [void]$candidates.Add($env:ANDROID_HOME) }
    if ($env:ANDROID_SDK_ROOT) { [void]$candidates.Add($env:ANDROID_SDK_ROOT) }
    $wsRoot = Split-Path -Parent (Split-Path -Parent $ROOT)
    [void]$candidates.Add((Join-Path $wsRoot 'android-sdk'))
    [void]$candidates.Add((Join-Path $env:LOCALAPPDATA 'Android\Sdk'))
    foreach ($c in $candidates) {
        if (-not $c) { continue }
        if ((Test-Path (Join-Path $c 'build-tools\34.0.0\aapt2.exe')) -and
            (Test-Path (Join-Path $c 'platforms\android-34\android.jar'))) {
            $SdkPath = $c
            break
        }
    }
}
if (-not $SdkPath) {
    Die "找不到含 build-tools\34.0.0 与 platforms\android-34 的 Android SDK。请用 -SdkPath 指定，或设置 `$env:ANDROID_HOME。"
}
$BT = Join-Path $SdkPath 'build-tools\34.0.0'
$PLATFORM = Join-Path $SdkPath 'platforms\android-34\android.jar'

# ---- 定位 JDK ----
if (-not $JavaPath) {
    $jdkCandidates = New-Object System.Collections.ArrayList
    if ($env:JAVA_HOME) { [void]$jdkCandidates.Add($env:JAVA_HOME) }
    [void]$jdkCandidates.Add('C:\Program Files\Zulu\zulu-17')
    [void]$jdkCandidates.Add('C:\Program Files\Zulu\zulu-21')
    [void]$jdkCandidates.Add('C:\Program Files\Android\Android Studio\jbr')
    foreach ($j in $jdkCandidates) {
        if (-not $j) { continue }
        if (Test-Path (Join-Path $j 'bin\javac.exe')) { $JavaPath = $j; break }
    }
}
if (-not $JavaPath) { Die "找不到 JDK（需要 bin\javac.exe）。请用 -JavaPath 指定，或设置 `$env:JAVA_HOME。" }
$JAVAC = Join-Path $JavaPath 'bin\javac.exe'
$JAVA = Join-Path $JavaPath 'bin\java.exe'
$KEYTOOL = Join-Path $JavaPath 'bin\keytool.exe'
if (-not (Test-Path $JAVA)) { Die "缺少 $JAVA" }
if (-not (Test-Path $KEYTOOL)) { Die "缺少 $KEYTOOL" }

Write-Host "    SDK: $SdkPath"
Write-Host "    JDK: $JavaPath"

# ---- 组件自检 ----
$AAPT2 = Join-Path $BT 'aapt2.exe'
$ZIPALIGN = Join-Path $BT 'zipalign.exe'
$D8_JAR = Join-Path $BT 'lib\d8.jar'
$APKSIGNER_JAR = Join-Path $BT 'lib\apksigner.jar'
$JAVA_LIBS = Join-Path $ROOT 'libs\tesseract4android.jar'

foreach ($f in @($AAPT2, $ZIPALIGN, $D8_JAR, $APKSIGNER_JAR, $PLATFORM)) {
    if (-not (Test-Path $f)) { Die "缺少构建组件: $f" }
}
if (-not (Test-Path $JAVA_LIBS)) { Die "缺少 $JAVA_LIBS（请先准备好 tesseract4android.jar）" }

# ---- 应用名来自 version.json，这里生成 strings.xml，避免两处各写一份名字 ----
$valuesDir = Join-Path $APP 'res\values'
if (-not (Test-Path $valuesDir)) { New-Item -ItemType Directory -Path $valuesDir -Force | Out-Null }
$stringsXml = @"
<?xml version="1.0" encoding="utf-8"?>
<!-- 由 build.ps1 从 version.json 生成，请勿手工修改 -->
<resources>
    <string name="app_name">$APP_NAME</string>
</resources>
"@
[IO.File]::WriteAllText((Join-Path $valuesDir 'strings.xml'), $stringsXml, (New-Object Text.UTF8Encoding($false)))

# 把版本信息拷进 assets，应用内「关于 / 更新日志」直接读它
Copy-Item -Path $VERSION_FILE -Destination (Join-Path $APP 'assets\www\version.json') -Force

if (Test-Path $BUILD) { Remove-Item $BUILD -Recurse -Force }
foreach ($d in @('res', 'gen', 'classes', 'dex')) {
    New-Item -ItemType Directory -Path (Join-Path $BUILD $d) -Force | Out-Null
}

# ---- [1/7] 图标 ----
Write-Step '[1/7] 检查图标资源'
$iconDirs = @('mipmap-mdpi', 'mipmap-hdpi', 'mipmap-xhdpi', 'mipmap-xxhdpi', 'mipmap-xxxhdpi')
$missingIcons = @()
foreach ($d in $iconDirs) {
    if (-not (Test-Path (Join-Path $APP "res\$d\ic_launcher.png"))) { $missingIcons += $d }
}
if ($missingIcons.Count -gt 0) {
    # 原流程用 tools/make_icon.py（依赖 PIL）生成图标
    $py = Get-Command python -ErrorAction SilentlyContinue
    if ($py -and (Test-Path (Join-Path $ROOT 'tools\make_icon.py'))) {
        & $py.Source (Join-Path $ROOT 'tools\make_icon.py') > $null 2>&1
    }
    foreach ($d in $iconDirs) {
        if (-not (Test-Path (Join-Path $APP "res\$d\ic_launcher.png"))) {
            Die "缺少图标 app\res\$d\ic_launcher.png，且无法生成（需要 python + PIL 运行 tools\make_icon.py）"
        }
    }
    Write-Host '    已生成图标'
}
else {
    Write-Host '    图标齐备（5 档 ic_launcher.png，跳过生成）'
}

# ---- [2/7] 编译资源 ----
Write-Step '[2/7] aapt2 compile 资源'
$resZip = Join-Path $BUILD 'res.zip'
$r = Invoke-Native -Exe $AAPT2 -Arguments @('compile', '--dir', (Join-Path $APP 'res'), '-o', $resZip)
if ($r.ExitCode -ne 0) {
    $r.Output | Select-Object -First 40 | ForEach-Object { Write-Host "    $_" }
    Die "aapt2 compile 失败（退出码 $($r.ExitCode)）"
}

# ---- [2.5/7] 桥接契约校验 ----
Write-Step '[2.5/7] 校验 JS ⇄ 原生 桥接契约'
$checkBridge = Join-Path $ROOT 'tools\check_bridge.ps1'
if (Test-Path $checkBridge) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $checkBridge
    if ($LASTEXITCODE -ne 0) { Die '构建中止：JS 与 Java 的桥接签名不一致（见上方 ✗ 项）' }
}
else {
    Write-Host '    （未找到 tools\check_bridge.ps1，跳过）'
}

# ---- [3/7] aapt2 link ----
Write-Step '[3/7] aapt2 link（含 assets）'
$baseApk = Join-Path $BUILD 'base.apk'
$linkArgs = @(
    'link',
    '-o', $baseApk,
    '-I', $PLATFORM,
    '--manifest', (Join-Path $APP 'AndroidManifest.xml'),
    $resZip,
    '-A', (Join-Path $APP 'assets'),
    '--java', (Join-Path $BUILD 'gen'),
    '--min-sdk-version', '21',
    '--target-sdk-version', '34',
    '--version-code', $VERSION_CODE,
    '--version-name', $VERSION_NAME
)
$r = Invoke-Native -Exe $AAPT2 -Arguments $linkArgs
if ($r.ExitCode -ne 0) {
    $r.Output | Select-Object -First 40 | ForEach-Object { Write-Host "    $_" }
    Die "aapt2 link 失败（退出码 $($r.ExitCode)）"
}

# ---- [3.5/7] 规范化 assets 条目路径 ----
# Windows 版 aapt2 用 -A <dir> 打包 assets 时会把条目名写成 "assets\www\index.html"（反斜杠）。
# 设备上 AssetManager 按原样匹配 zip 条目名，而 MainActivity.openAsset() 与 Ocr 读的是
# "www/index.html"、"tessdata/eng.traineddata" 这类正斜杠路径，于是每个资源都
# FileNotFoundException：WebView 白屏、词典与单词表全空、OCR 取不到训练数据。
# 这一步把条目名统一改回正斜杠（res/* 走的是 arsc 里的正斜杠路径，无需处理）。
Write-Step '[3.5/7] 规范化 assets 条目路径（反斜杠 -> 正斜杠）'
try {
    $zip = [IO.Compression.ZipFile]::Open($baseApk, [IO.Compression.ZipArchiveMode]::Update)
    try {
        $badNames = @($zip.Entries | Where-Object { $_.FullName.Contains('\') } | Select-Object -ExpandProperty FullName)
        foreach ($name in $badNames) {
            $entry = $zip.GetEntry($name)
            $ms = New-Object IO.MemoryStream
            $s = $entry.Open(); $s.CopyTo($ms); $s.Dispose()
            $bytes = $ms.ToArray(); $ms.Dispose()
            $ne = $zip.CreateEntry($name.Replace('\', '/'), [IO.Compression.CompressionLevel]::Optimal)
            $os = $ne.Open(); $os.Write($bytes, 0, $bytes.Length); $os.Dispose()
            $entry.Delete()
        }
        $stillBad = @($zip.Entries | Where-Object { $_.FullName.Contains('\') })
        if ($stillBad.Count -gt 0) { throw "仍有 $($stillBad.Count) 个条目名含反斜杠（例：$($stillBad[0].FullName)）" }
        Write-Host "    修正 $($badNames.Count) 个条目，残留 0"
    }
    finally { $zip.Dispose() }
}
catch { Die "规范化 assets 条目路径失败：$($_.Exception.Message)" }

# ---- [4/7] javac ----
Write-Step '[4/7] javac 编译 Java 源码'
$srcs = @()
$srcs += Get-ChildItem -Path (Join-Path $APP 'java') -Recurse -Filter '*.java' | Select-Object -ExpandProperty FullName
$srcs += Get-ChildItem -Path (Join-Path $BUILD 'gen') -Recurse -Filter '*.java' | Select-Object -ExpandProperty FullName
if ($srcs.Count -eq 0) { Die '没有找到任何 .java 源文件' }
Write-Host "    源文件 $($srcs.Count) 个"

$classesDir = Join-Path $BUILD 'classes'
$classpath = "$PLATFORM;$JAVA_LIBS"
$javacLog = Join-Path $BUILD 'javac.log'
# 用英文语言环境跑 javac：中文 javac 提示在 Windows 控制台代码页下会变成乱码，
# 英文提示（Note: / error:）是纯 ASCII，可稳定过滤与阅读。
$javacArgs = @('-J-Duser.language=en', '-J-Duser.country=US',
               '-nowarn', '-source', '8', '-target', '8', '-encoding', 'UTF-8',
               '-classpath', $classpath, '-d', $classesDir) + $srcs

$r = Invoke-Native -Exe $JAVAC -Arguments $javacArgs -Log $javacLog
$JAVAC_RC = $r.ExitCode
$noise = 'bootstrap class path|source value 8 is obsolete|target value 8 is obsolete|To suppress warnings about obsolete options|^Note:|Xlint|^note:'
$r.Output | Where-Object { $_ -notmatch $noise } | Select-Object -First 60 | ForEach-Object { Write-Host "    $_" }

if ($JAVAC_RC -ne 0) { Die "javac 编译失败（退出码 $JAVAC_RC，完整日志 $javacLog）" }
foreach ($c in @('com\wordpalace\app\MainActivity.class', 'com\wordpalace\app\Bridge.class')) {
    if (-not (Test-Path (Join-Path $classesDir $c))) { Die "缺少编译产物 $c" }
}
Write-Host '    编译通过，应用类齐备'

# ---- [5/7] d8 ----
Write-Step '[5/7] d8 生成 dex'
$dexDir = Join-Path $BUILD 'dex'
$classFiles = Get-ChildItem -Path $classesDir -Recurse -Filter '*.class' | Select-Object -ExpandProperty FullName
if ($classFiles.Count -eq 0) { Die 'build\classes 下没有 .class 文件' }
$d8Args = @('-Xmx1024M', '-cp', $D8_JAR, 'com.android.tools.r8.D8',
            '--release', '--min-api', '21', '--lib', $PLATFORM,
            '--output', $dexDir) + $classFiles + @($JAVA_LIBS)
$r = Invoke-Native -Exe $JAVA -Arguments $d8Args
if ($r.ExitCode -ne 0) {
    $r.Output | Select-Object -First 40 | ForEach-Object { Write-Host "    $_" }
    Die "d8 生成 dex 失败（退出码 $($r.ExitCode)）"
}

# 校验 dex 里真的有应用类，避免打包出「空壳 APK」
$dexPath = Join-Path $dexDir 'classes.dex'
if (-not (Test-Path $dexPath)) { Die 'd8 未生成 classes.dex' }
$dexBytes = [IO.File]::ReadAllBytes($dexPath)
$needClasses = @('Lcom/wordpalace/app/MainActivity;', 'Lcom/wordpalace/app/Bridge;',
                 'Lcom/wordpalace/app/Ocr;', 'Lcom/wordpalace/app/CaptureProvider;')
$missing = @($needClasses | Where-Object { -not (Test-BytesContain -Haystack $dexBytes -Needle $_) })
if ($missing.Count -gt 0) { Die "classes.dex 缺少应用类 -> $($missing -join ', ')" }
Write-Host "    classes.dex 校验通过（$($dexBytes.Length) 字节，应用类齐备）"

# ---- [6/7] 组装 APK ----
Write-Step '[6/7] 组装 APK（dex + 原生库）'
$unsignedApk = Join-Path $BUILD 'unsigned.apk'
Copy-Item -Path $baseApk -Destination $unsignedApk -Force

$libEntries = @()
if (Test-Path (Join-Path $ROOT 'prebuilt\lib')) {
    $chosen = @()
    foreach ($abi in $Abis) {
        if (Test-Path (Join-Path $ROOT "prebuilt\lib\$abi")) { $chosen += $abi }
    }
    Write-Host "    打包原生库 ABI: $($chosen -join ' ')"
    foreach ($abi in $chosen) {
        foreach ($f in (Get-ChildItem -Path (Join-Path $ROOT "prebuilt\lib\$abi") -Filter '*.so')) {
            $libEntries += [pscustomobject]@{ Path = $f.FullName; Name = "lib/$abi/$($f.Name)" }
        }
    }
}

$zip = [IO.Compression.ZipFile]::Open($unsignedApk, [IO.Compression.ZipArchiveMode]::Update)
try {
    $items = @([pscustomobject]@{ Path = $dexPath; Name = 'classes.dex' }) + $libEntries
    foreach ($item in $items) {
        $e = $zip.CreateEntry($item.Name, [IO.Compression.CompressionLevel]::Optimal)
        $es = $e.Open()
        try {
            $fs = [IO.File]::OpenRead($item.Path)
            try { $fs.CopyTo($es) } finally { $fs.Dispose() }
        }
        finally { $es.Dispose() }
    }
}
finally { $zip.Dispose() }
Write-Host "    已写入 classes.dex 与 $($libEntries.Count) 个原生库"

# ---- [7/7] zipalign + 签名 ----
Write-Step '[7/7] zipalign + 签名'
$alignedApk = Join-Path $BUILD 'aligned.apk'
$r = Invoke-Native -Exe $ZIPALIGN -Arguments @('-f', '-p', '4', $unsignedApk, $alignedApk)
if ($r.ExitCode -ne 0) {
    $r.Output | ForEach-Object { Write-Host "    $_" }
    Die "zipalign 失败（退出码 $($r.ExitCode)）"
}
if (-not (Test-Path $alignedApk)) { Die 'zipalign 未产出 aligned.apk' }

# 签名口令不入库：优先环境变量，其次本机私有文件 tools\_local_secrets.ps1（.gitignore 排除 tools/_*）
$secretFile = Join-Path $ROOT 'tools\_local_secrets.ps1'
if (Test-Path $secretFile) { . $secretFile }
if ($env:WP_KEYSTORE_ALIAS) { $KS_ALIAS = $env:WP_KEYSTORE_ALIAS }
if ($env:WP_KEYSTORE_PASS)  { $KS_PASS  = $env:WP_KEYSTORE_PASS }
if (-not $KS_ALIAS -or -not $KS_PASS) {
    Die '缺少签名口令：请设置环境变量 WP_KEYSTORE_PASS / WP_KEYSTORE_ALIAS，或提供本机私有文件 tools\_local_secrets.ps1（见 README 第五节）'
}
$KS = if ($env:WP_KEYSTORE_PATH) { $env:WP_KEYSTORE_PATH } else { Join-Path $ROOT 'keystore.jks' }
if (-not (Test-Path $KS)) {
    Write-Host '    生成签名密钥 keystore.jks'
    $ktArgs = @('-genkeypair', '-keystore', $KS, '-alias', $KS_ALIAS,
                '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10950',
                '-storetype', 'PKCS12',
                '-storepass', $KS_PASS, '-keypass', $KS_PASS,
                '-dname', 'CN=WordPalace, OU=Personal, O=WordPalace, L=Beijing, ST=Beijing, C=CN')
    $r = Invoke-Native -Exe $KEYTOOL -Arguments $ktArgs
    if ($r.ExitCode -ne 0 -or -not (Test-Path $KS)) { Die "keytool 生成密钥失败（退出码 $($r.ExitCode)）" }
}

# 先签到 ASCII 路径，再复制到最终（可能是中文）文件名：
# cmd 批处理与中文参数的代码页问题在这里被完全绕开。
$signedApk = Join-Path $BUILD 'signed.apk'
$signArgs = @('-Xmx1024M', '-jar', $APKSIGNER_JAR, 'sign',
              '--ks', $KS, '--ks-key-alias', $KS_ALIAS,
              '--ks-pass', ('pass:' + $KS_PASS), '--key-pass', ('pass:' + $KS_PASS),
              '--min-sdk-version', '21',
              '--v1-signing-enabled', 'true', '--v2-signing-enabled', 'true',
              '--out', $signedApk, $alignedApk)
$r = Invoke-Native -Exe $JAVA -Arguments $signArgs
if ($r.ExitCode -ne 0) {
    $r.Output | ForEach-Object { Write-Host "    $_" }
    Die "apksigner 签名失败（退出码 $($r.ExitCode)）"
}
if (-not (Test-Path $signedApk)) { Die 'apksigner 未产出签名后的 APK' }
Copy-Item -Path $signedApk -Destination $OutApk -Force

# ---- 收尾自检 ----
Write-Host ''
Write-Host '=== 签名校验 ==='
$r = Invoke-Native -Exe $JAVA -Arguments @('-Xmx1024M', '-jar', $APKSIGNER_JAR, 'verify',
                                           '--min-sdk-version', '21', '-v', $OutApk)
$r.Output | Select-Object -First 8 | ForEach-Object { Write-Host $_ }
if ($r.ExitCode -ne 0) { Die "签名校验失败（退出码 $($r.ExitCode)）" }

Write-Host ''
Write-Host '=== APK 信息 ==='
# 注意：先把输出整体收下来再取前 3 行，不要让上游进程因为管道被提前关闭而收到 SIGPIPE。
$r = Invoke-Native -Exe $AAPT2 -Arguments @('dump', 'badging', $OutApk)
$r.Output | Select-Object -First 3 | ForEach-Object { Write-Host $_ }
if ($r.ExitCode -ne 0) { Die "aapt2 dump badging 失败（退出码 $($r.ExitCode)）" }

Write-Host ''
# 校验产物里的版本、应用名与 assets 确实来自 version.json / 源目录
# （防止「名字对了版本没进去」这类沉默的错误）
$zipOut = [IO.Compression.ZipFile]::OpenRead($OutApk)
try {
    $manifestBytes = Read-ZipEntryBytes -Archive $zipOut -Name 'AndroidManifest.xml'
    $arscBytes = Read-ZipEntryBytes -Archive $zipOut -Name 'resources.arsc'
    $slashBad = @($zipOut.Entries | Where-Object { $_.FullName.Contains('\') } |
                  Select-Object -ExpandProperty FullName)
    $missingEntries = @('assets/www/index.html', 'assets/tessdata/eng.traineddata', 'assets/data/words.json') |
        Where-Object { -not (Test-ZipEntry -Archive $zipOut -Name $_) }
    $packedVersionJson = Read-ZipEntryBytes -Archive $zipOut -Name 'assets/www/version.json'
}
finally { $zipOut.Dispose() }

$ok = $true
$manifestText = if ($manifestBytes) { Get-BytesAsText $manifestBytes } else { '' }
$arscText = if ($arscBytes) { Get-BytesAsText $arscBytes } else { '' }

$nameU16 = Get-Latin1Of -Text $APP_NAME -Utf16 $true
$nameU8 = Get-Latin1Of -Text $APP_NAME -Utf16 $false
if ($arscText.Contains($nameU16) -or $arscText.Contains($nameU8) -or
    $manifestText.Contains($nameU16) -or $manifestText.Contains($nameU8)) {
    Write-Host "  OK  应用名：$APP_NAME"
}
else {
    Write-Host "  !!  应用名不是「$APP_NAME」（既不在 resources.arsc 也不在清单里）"
    $ok = $false
}

$verU16 = Get-Latin1Of -Text $VERSION_NAME -Utf16 $true
$verU8 = Get-Latin1Of -Text $VERSION_NAME -Utf16 $false
if ($manifestText.Contains($verU16) -or $manifestText.Contains($verU8)) {
    Write-Host "  OK  版本号：$VERSION_NAME（versionCode $VERSION_CODE）"
}
else {
    Write-Host "  !!  清单里没有版本号 $VERSION_NAME"
    $ok = $false
}

# assets 条目必须是正斜杠，否则设备上 getAssets().open("www/index.html") 会抛
# FileNotFoundException（表现为白屏 + 词典/单词表为空 + OCR 无训练数据）。
if ($slashBad.Count -gt 0) {
    Write-Host "  !!  APK 内有 $($slashBad.Count) 个条目名含反斜杠，设备上读不到资源（例：$($slashBad[0])）"
    $ok = $false
}
else {
    Write-Host '  OK  assets 条目路径均为正斜杠'
}
if ($missingEntries.Count -gt 0) {
    Write-Host "  !!  APK 内缺少关键 assets 条目：$($missingEntries -join ', ')"
    $ok = $false
}
else {
    Write-Host '  OK  关键 assets 齐备（index.html / eng.traineddata / words.json）'
}
$diskVersionJson = [IO.File]::ReadAllBytes($VERSION_FILE)
if ($packedVersionJson -and [Linq.Enumerable]::SequenceEqual([byte[]]$diskVersionJson, [byte[]]$packedVersionJson)) {
    Write-Host '  OK  assets/www/version.json 与 version.json 完全一致'
}
else {
    Write-Host '  !!  assets/www/version.json 与 version.json 不一致'
    $ok = $false
}

# 明文 HTTP 必须真的放开：订阅源里有只支持 http 的站点，被系统拦掉会表现为「网络不通」，很难排查。
# 清单里存的是资源 ID 而不是名字，所以用 aapt2 反解核对。
$r = Invoke-Native -Exe $AAPT2 -Arguments @('dump', 'xmltree', $OutApk, '--file', 'AndroidManifest.xml')
$manXml = $r.Output -join "`n"
$r2 = Invoke-Native -Exe $AAPT2 -Arguments @('dump', 'xmltree', $OutApk, '--file', 'res/xml/network_security_config.xml')
$nscXml = $r2.Output -join "`n"

if ($manXml -match 'networkSecurityConfig') { Write-Host '  OK  清单已引用网络安全配置' }
else { Write-Host '  !!  清单没有引用 networkSecurityConfig'; $ok = $false }
if ($nscXml -match 'cleartextTrafficPermitted=true') { Write-Host '  OK  明文 HTTP 已放开（cleartextTrafficPermitted=true）' }
else { Write-Host '  !!  network_security_config 未允许明文 HTTP'; $ok = $false }

if (-not $ok) { Die '构建产物校验失败' }

Write-Host ''
$final = Get-Item $OutApk
Write-Host ("产物: {0}" -f $final.FullName)
Write-Host ("大小: {0:N2} MB ({1} 字节)" -f ($final.Length / 1MB), $final.Length)
Write-Host ("SHA256: {0}" -f (Get-FileHash -Path $OutApk -Algorithm SHA256).Hash)
Write-Host ''
Write-Host "构建完成: $OutApk"
exit 0
