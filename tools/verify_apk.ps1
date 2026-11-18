# 独立复核：不信任构建脚本的结论，直接从 APK 里把东西读出来比对
param([string]$Apk = '乐学英语-v1.3.1.apk', [string]$Web = 'app\assets\www')

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$ApkPath = (Resolve-Path $Apk).Path
$zip = [IO.Compression.ZipFile]::OpenRead($ApkPath)
$fail = 0
function Bad($m) { Write-Host "  !!  $m" -ForegroundColor Red; $script:fail++ }
function Ok($m) { Write-Host "  OK  $m" }

Write-Host "== APK: $ApkPath"
Write-Host "== 1) assets/www 下每个文件与磁盘逐字节一致"
$entries = $zip.Entries | Where-Object { $_.FullName -like 'assets/www/*' -and $_.Length -gt 0 }
$checked = 0
foreach ($e in $entries) {
    $rel = $e.FullName.Substring('assets/www/'.Length)
    $disk = Join-Path $Web ($rel -replace '/', '\')
    if (-not (Test-Path $disk)) { Bad "APK 里有、磁盘上没有：$rel"; continue }
    $ms = New-Object IO.MemoryStream
    $s = $e.Open(); $s.CopyTo($ms); $s.Close()
    $a = $ms.ToArray()
    $b = [IO.File]::ReadAllBytes($disk)
    if ($a.Length -ne $b.Length) { Bad "$rel 长度不同 APK=$($a.Length) 磁盘=$($b.Length)"; continue }
    $same = $true
    for ($i = 0; $i -lt $a.Length; $i++) { if ($a[$i] -ne $b[$i]) { $same = $false; break } }
    if (-not $same) { Bad "$rel 内容不同" } else { $checked++ }
}
Ok "逐字节一致的文件数：$checked / $($entries.Count)"

Write-Host "== 2) 修复标记是否真的进了包"
function TextOf($name) {
    $e = $zip.Entries | Where-Object { $_.FullName -eq $name } | Select-Object -First 1
    if (-not $e) { return $null }
    $ms = New-Object IO.MemoryStream
    $s = $e.Open(); $s.CopyTo($ms); $s.Close()
    return [Text.Encoding]::UTF8.GetString($ms.ToArray())
}
$markers = @(
    @('assets/www/js/store.js', 'IDB_TIMEOUT', '本地存储超时'),
    @('assets/www/js/store.js', 'storageState', '存储状态导出'),
    @('assets/www/js/app.js', 'BOOT_WATCHDOG_MS', '启动看门狗'),
    @('assets/www/js/app.js', 'showBootProblem', '启动故障面板'),
    @('assets/www/js/theme.js', 'isSystemDark', '原生深浅色'),
    @('assets/www/js/theme.js', 'onSystemChange', '系统深浅色变化回调'),
    @('assets/www/js/bridge.js', 'opt.timeoutMs', '每次调用独立超时'),
    @('assets/www/index.html', 'boot-hint', '启动提示行'),
    @('assets/www/js/feed.js', 'WEBVIEW_BUDGET', '兜底通道预算'),
    @('assets/www/js/feed.js', 'catalogError', '订阅目录错误'),
    @('assets/www/js/view-read.js', 'failPage', '阅读页兜底'),
    @('assets/www/js/view-dict.js', 'set-tts-note', '发音引擎设置项'),
    @('assets/www/js/i18n.js', 'ttsEngine', '发音引擎文案'),
    @('assets/www/js/diag.js', 'wp.diag.probe', '诊断面板'),
    # ---- 1.2.3 ----
    @('assets/www/css/app.css', 'color: var(--text)', '正文颜色跟随主题'),
    @('assets/www/css/app.css', '.rd-title .wd', '大标题可点词样式'),
    @('assets/www/css/app.css', '.bp-pct', '词书进度颜色'),
    @('assets/www/css/app.css', 'style*="#a33248"', '深色内联颜色补丁'),
    @('assets/www/js/reader.js', 'renderText(b.text, cmap, false)', '小标题/图注切词'),
    @('assets/www/js/reader.js', 'renderText(article.title', '大标题切词'),
    @('assets/www/js/dict.js', 'queryForms', '候选写法展开'),
    @('assets/www/js/dict.js', 'ONLINE_FAIL_TTL', '失败缓存 5 分钟'),
    @('assets/www/js/dict.js', 'isTransportFail', '网络失败与未收录分开'),
    @('assets/www/js/dict.js', 'mymemory', '第三源兜底'),
    @('assets/www/js/ui-kit.js', 'data-act="web"', '浏览器查词按钮'),
    @('assets/www/js/i18n.js', 'onlineTried', '在线查词文案'),
    # ---- 1.2.4：联网查词重做（小接口优先 / 换通道 / 三种结论分开）----
    @('assets/www/js/dict.js', 'function parseSuggest', '有道轻量接口解析'),
    @('assets/www/js/dict.js', 'function planOf', '取数顺序表'),
    @('assets/www/js/dict.js', 'SOURCE_TIMEOUT', '单次接口等待上限'),
    @('assets/www/js/dict.js', 'webOnly', '原生通道不通时改走 WebView'),
    @('assets/www/js/dict.js', "res.channel = web ? 'web' : 'native'", '标记实际使用的通道'),
    @('assets/www/js/i18n.js', 'onlineParse', '「解析不了」文案'),
    # ---- 1.3.0：中英对照 ----
    @('assets/www/index.html', 'js/translate.js', '对照脚本已加载'),
    @('assets/www/js/translate.js', 'function chunk', '按句切块'),
    @('assets/www/js/translate.js', 'mymemory', '首选翻译源'),
    @('assets/www/js/translate.js', 'translate.googleapis.com', '备用翻译源'),
    @('assets/www/js/translate.js', 'quotaFinished', '额度用完识别'),
    @('assets/www/js/reader.js', 'function startBi', '逐段翻译接线'),
    @('assets/www/js/reader.js', 'data-a="bi"', '工具栏对照按钮'),
    @('assets/www/css/app.css', '.rd-zh', '译文行样式'),
    @('assets/www/js/i18n.js', 'biLabel', '对照按钮文案'),
    # ---- 1.3.1：导入自定义词书 ----
    @('assets/www/js/dict.js', 'function setCustomBooks', '自定义词书装载'),
    @('assets/www/js/dict.js', 'function loadCustom', '启动时读回自定义词书'),
    @('assets/www/js/dict.js', 'extraByBook', '自定义词书词表'),
    @('assets/www/js/dict.js', 'custom: true', '自定义词条标记'),
    @('assets/www/js/view-dict.js', 'data-a="importbook"', '导入词书按钮'),
    @('assets/www/js/view-dict.js', 'function normImportedBooks', '导入格式宽容解析'),
    @('assets/www/js/view-dict.js', 'function doDeleteBook', '删除导入的词书'),
    @('assets/www/js/i18n.js', 'importBookHint', '导入说明文案'),
    @('assets/www/js/i18n.js', 'customBook', '「导入」标记文案'),
    @('assets/www/js/store.js', "putMeta('cbooks'", '备份/恢复带上自定义词书')
)
foreach ($m in $markers) {
    $t = TextOf $m[0]
    if ($null -eq $t) { Bad "缺文件 $($m[0])"; continue }
    if ($t.Contains($m[1])) { Ok "$($m[1])  ($($m[2]))" } else { Bad "没找到 $($m[1]) —— $($m[2]) 没进包（$($m[0])）" }
}

Write-Host "== 3) 原生侧：dex 里是否含新增的桥接方法"
$dex = TextOf 'classes.dex'
if ($null -eq $dex) { Bad 'APK 里没有 classes.dex' }
else {
    foreach ($n in @('isSystemDark', 'ttsInfo', 'setTtsMode', 'openTtsSettings', 'onRenderProcessGone', 'setAlgorithmicDarkeningAllowed', 'didCrash')) {
        if ($dex.Contains($n)) { Ok $n } else { Bad "dex 里没有 $n" }
    }
}
$zip.Dispose()
Write-Host ""
if ($fail -eq 0) { Write-Host '复核通过：没有发现问题' -ForegroundColor Green; exit 0 }
Write-Host "复核发现 $fail 个问题" -ForegroundColor Red
exit 1
