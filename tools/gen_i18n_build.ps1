# One-time helper (NOT a deliverable): extracts the three OpenCC-derived data tables that
# already exist in app\assets\www\js\i18n-data.js and emits tools\i18n_build.ps1 with those
# tables embedded as data.  Run:
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\_gen_i18n_ps1.ps1

param(
    [string]$Dest = 'C:\Users\KOUFIK\Documents\deepseek-harness\default-workspace\lexue\WordPalace\tools\i18n_build.ps1'
)

$ErrorActionPreference = 'Stop'

$root = 'C:\Users\KOUFIK\Documents\deepseek-harness\default-workspace\lexue\WordPalace'
$out  = Join-Path $root 'app\assets\www\js\i18n-data.js'

$t = [IO.File]::ReadAllText($out, [Text.Encoding]::UTF8)

function Get-ObjBlock([string]$text, [string]$name) {
    $marker = '    ' + $name + ': {'
    $s = $text.IndexOf($marker, [StringComparison]::Ordinal)
    if ($s -lt 0) { throw "block not found: $name" }
    $i = $s + $marker.Length - 1
    $depth = 0
    $inStr = $false
    $esc = $false
    for (; $i -lt $text.Length; $i++) {
        $ch = $text[$i]
        if ($inStr) {
            if ($esc) { $esc = $false }
            elseif ($ch -eq '\') { $esc = $true }
            elseif ($ch -eq '"') { $inStr = $false }
            continue
        }
        if ($ch -eq '"') { $inStr = $true; continue }
        if ($ch -eq '{') { $depth++ }
        elseif ($ch -eq '}') { $depth--; if ($depth -eq 0) { $i++; break } }
    }
    return $text.Substring($s + $marker.Length - 1, $i - ($s + $marker.Length - 1))
}

# 内嵌表以「单引号字符串 + ConvertFrom-Json」形式生成（JSON 直接裸放进 .ps1 会解析失败）
$dataLines = '$Data = @{}' + "`r`n"
foreach ($n in 'hant', 'hantPhrases', 'hantChars') {
    $blk = Get-ObjBlock $t $n
    $null = ConvertFrom-Json $blk -ErrorAction Stop   # validate the JSON literal
    if ($blk.Contains("'")) { throw "内嵌表 $n 含单引号，无法用单引号字符串承载" }
    $dataLines += '$Data[' + "'" + $n + "'" + '] = ' + "'" + $blk + "'" + "`r`n"
    Write-Host ("{0}: {1} chars" -f $n, $blk.Length)
}

$template = @'
# i18n_build.ps1 -- partial PowerShell port of tools/i18n_build.py
# -*- coding: utf-8 -*-
#
# 生成 app/assets/www/js/i18n-data.js。
# 产物包含四张表：
#   1. en          -- 简体界面文案 -> 英文（tools/i18n/en.json，顺序与 keys.json 一一对应）
#   2. hant        -- 简体界面文案 -> 繁体（整串精确映射）
#   3. hantPhrases -- 词组级简 -> 繁映射（前端按最长优先匹配）
#   4. hantChars   -- 单字级简 -> 繁映射，兜底处理动态内容（词典释义等）
#
# 与 Python 版的差异（本机没有 python3 / pip / OpenCC 词典，无法在运行时现算繁体表）：
#   Python 版用 OpenCC('s2t') 现算 hant/hantPhrases/hantChars；
#   本脚本把这三张表作为数据内嵌在下面的 $Data 段（取自现有生成物，字节不变），
#   en 表则每次运行时从 tools/i18n/keys.json + tools/i18n/en.json 重新读取。
#   因此本脚本不能修正繁体表里的错误，也不能为新键现算繁体；keys.json 保持现有全集时，
#   输出与 Python 版逐字节一致（前提是 $Source 指向的是同一份基线生成物）。
#
# 用法（项目根目录执行）：
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\i18n_build.ps1

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

@@DATABLOCK@@
foreach ($tbl in 'hant', 'hantPhrases', 'hantChars') {
    if (-not ($Data.Keys -contains $tbl)) {
        [Console]::Error.WriteLine('缺内嵌数据表：{0}（本文件由 tools\_gen_i18n_ps1.ps1 生成）' -f $tbl)
        exit 1
    }
}

# ---- 路径（等价于 Python 版的 os.path.dirname(os.path.dirname(os.path.abspath(__file__)))) ----
$ROOT     = Split-Path -Parent $PSScriptRoot
$I18N_DIR = Join-Path $ROOT 'tools\i18n'
$KEYS     = Join-Path $I18N_DIR 'keys.json'
$EN       = Join-Path $I18N_DIR 'en.json'
$OUT      = Join-Path $ROOT 'app\assets\www\js\i18n-data.js'

if (-not (Test-Path -LiteralPath $KEYS -PathType Leaf)) {
    [Console]::Error.WriteLine("找不到 $KEYS")
    exit 1
}
if (-not (Test-Path -LiteralPath $EN -PathType Leaf)) {
    [Console]::Error.WriteLine("找不到 $EN")
    exit 1
}

# ---- 有序 JSON 解析（ConvertFrom-Json 不保序，这里自己扫描，顺序即文件顺序）----
function Read-JsonString([string]$s, [ref]$i) {
    $n = $s.Length
    $i.Value++
    $sb = New-Object System.Text.StringBuilder
    while ($i.Value -lt $n) {
        $c = $s[$i.Value]
        if ($c -eq '"') { $i.Value++; return $sb.ToString() }
        if ($c -eq '\') {
            $i.Value++
            $e = $s[$i.Value]
            switch ($e) {
                '"'  { [void]$sb.Append('"') }
                '\'  { [void]$sb.Append('\') }
                '/'  { [void]$sb.Append('/') }
                'b'  { [void]$sb.Append([char]8) }
                'f'  { [void]$sb.Append([char]12) }
                'n'  { [void]$sb.Append([char]10) }
                'r'  { [void]$sb.Append([char]13) }
                't'  { [void]$sb.Append([char]9) }
                'u'  {
                    $hex = $s.Substring($i.Value + 1, 4)
                    [void]$sb.Append([char][Convert]::ToInt32($hex, 16))
                    $i.Value += 4
                }
                default { [void]$sb.Append($e) }
            }
            $i.Value++
        }
        else {
            [void]$sb.Append($c)
            $i.Value++
        }
    }
    throw 'JSON 字符串未闭合'
}

function Read-JsonArrayStrings([string]$s) {
    $i = 0
    $n = $s.Length
    while ($i -lt $n -and [char]::IsWhiteSpace($s[$i])) { $i++ }
    if ($i -ge $n -or $s[$i] -ne '[') { throw '不是 JSON 数组' }
    $i++
    $list = New-Object System.Collections.Generic.List[string]
    while ($true) {
        while ($i -lt $n -and [char]::IsWhiteSpace($s[$i])) { $i++ }
        if ($i -lt $n -and $s[$i] -eq ']') { $i++; break }
        if ($i -ge $n) { throw 'JSON 数组未闭合' }
        if ($s[$i] -ne '"') { throw "JSON 数组元素应为字符串（偏移 $i）" }
        $iref = [ref]$i
        $list.Add((Read-JsonString $s $iref))
        $i = $iref.Value
        while ($i -lt $n -and [char]::IsWhiteSpace($s[$i])) { $i++ }
        if ($i -lt $n -and $s[$i] -eq ',') { $i++; continue }
        if ($i -lt $n -and $s[$i] -eq ']') { $i++; break }
        throw "JSON 数组分隔符异常（偏移 $i）"
    }
    return $list
}

# ---- js_str：等价于 Python 的 json.dumps(s, ensure_ascii=False) ----
$EscMap = @{ 8 = '\b'; 9 = '\t'; 10 = '\n'; 12 = '\f'; 13 = '\r'; 34 = '\"'; 92 = '\\' }
function ConvertTo-JsString([string]$s) {
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append('"')
    $run = New-Object System.Text.StringBuilder
    $n = $s.Length
    for ($i = 0; $i -lt $n; $i++) {
        $c = [int][char]$s[$i]
        if ($c -lt 32 -or $c -eq 34 -or $c -eq 92) {
            if ($run.Length -gt 0) { [void]$sb.Append($run.ToString()); [void]$run.Clear() }
            if ($EscMap.ContainsKey($c)) { [void]$sb.Append($EscMap[$c]) }
            else { [void]$sb.Append('\u{0:x4}' -f $c) }
        }
        else { [void]$run.Append([char]$c) }
    }
    if ($run.Length -gt 0) { [void]$sb.Append($run.ToString()) }
    [void]$sb.Append('"')
    return $sb.ToString()
}

# ---- 读取输入 ----
$keys = Read-JsonArrayStrings ([IO.File]::ReadAllText($KEYS, [Text.Encoding]::UTF8))
$en   = Read-JsonArrayStrings ([IO.File]::ReadAllText($EN, [Text.Encoding]::UTF8))

if ($keys.Count -ne $en.Count) {
    [Console]::Error.WriteLine('键与译文数量不一致：{0} vs {1}' -f $keys.Count, $en.Count)
    exit 1
}

$hant = ConvertFrom-Json ([string]$Data['hant'])
$phr  = ConvertFrom-Json ([string]$Data['hantPhrases'])
$chrs = ConvertFrom-Json ([string]$Data['hantChars'])
$hantNames = @($hant.PSObject.Properties)
$phrNames  = @($phr.PSObject.Properties)
$chrNames  = @($chrs.PSObject.Properties)

# ---- 组装（顺序与 Python 版一致：en / hant / hantPhrases / hantChars）----
$empty = 0
$same  = 0
$enPairs = New-Object System.Collections.Generic.List[object]
for ($k = 0; $k -lt $keys.Count; $k++) {
    $kk = $keys[$k]
    $vv = $en[$k]
    $enPairs.Add([pscustomobject]@{ Name = $kk; Value = $vv })
    if ($vv -eq '') { $empty++ }
}
$hantKeys = @{}
foreach ($p in $hantNames) { $hantKeys[$p.Name] = $true }
foreach ($kk in $keys) { if (-not $hantKeys.ContainsKey($kk)) { $same++ } }

$maxPhrase = 0
foreach ($p in $phrNames) { if ($p.Name.Length -gt $maxPhrase) { $maxPhrase = $p.Name.Length } }

$lines = New-Object System.Collections.Generic.List[string]
function Add-Line([string]$x) { $lines.Add($x) }

Add-Line '/* 本文件由 tools/i18n_build.ps1 生成，请勿手工修改。'
Add-Line ' * 源：tools/i18n/keys.json（按顺序的原文）+ tools/i18n/en.json（英文）+ OpenCC（繁体）'
Add-Line (' * 条目数：{0} 条英文 / {1} 条繁体整串映射 / {2} 个繁体词组 / {3} 个繁简单字' -f $keys.Count, $hantNames.Count, $phrNames.Count, $chrNames.Count)
Add-Line (' * 繁体最长词组：{0} 字（前端按最长优先匹配）*/' -f $maxPhrase)
Add-Line '(function (global) {'
Add-Line "  'use strict';"
Add-Line '  global.I18N_DATA = {'

function Add-Map([string]$name, $pairs, [int]$count, [bool]$isLast) {
    $tail = ''
    if (-not $isLast) { $tail = ',' }
    if ($count -eq 0) {
        Add-Line ('    {0}: {{}}{1}' -f $name, $tail)
        return
    }
    Add-Line ('    {0}: {{' -f $name)
    $buf = New-Object System.Collections.Generic.List[string]
    foreach ($p in $pairs) {
        $buf.Add('      ' + (ConvertTo-JsString $p.Name) + ': ' + (ConvertTo-JsString ([string]$p.Value)))
    }
    Add-Line ([string]::Join(",`n", $buf.ToArray()))
    Add-Line ('    }}{0}' -f $tail)
}

Add-Map 'en' $enPairs $enPairs.Count $false
Add-Map 'hant' $hantNames $hantNames.Count $false
Add-Map 'hantPhrases' $phrNames $phrNames.Count $false
Add-Map 'hantChars' $chrNames $chrNames.Count $true
Add-Line '  };'
Add-Line '})(typeof window !== "undefined" ? window : this);'
Add-Line ''

$text = [string]::Join("`n", $lines.ToArray())
$dir = Split-Path -Parent $OUT
if (-not (Test-Path -LiteralPath $dir)) { [void](New-Item -ItemType Directory -Path $dir -Force) }
[IO.File]::WriteAllText($OUT, $text, (New-Object System.Text.UTF8Encoding($false)))

$size = (Get-Item -LiteralPath $OUT).Length
$rel = $OUT.Substring($ROOT.Length + 1).Replace('\', '/')
Write-Host ('已生成 {0}（{1:N1} KB）' -f $rel, ($size / 1024))
Write-Host ('  英文条目      : {0}（其中映射为空串 {1} 条）' -f $keys.Count, $empty)
Write-Host ('  繁体精确映射  : {0}（另有 {1} 条简繁同形，无需映射）' -f $hantNames.Count, $same)
Write-Host ('  繁体词组映射  : {0}（最长 {1} 字）' -f $phrNames.Count, $maxPhrase)
Write-Host ('  繁简单字兜底  : {0}' -f $chrNames.Count)
exit 0
'@

$script = $template.Replace('@@DATABLOCK@@', $dataLines)

$script = $script.Replace("`r`n", "`n").Replace("`n", "`r`n")

[IO.File]::WriteAllText($Dest, $script, (New-Object System.Text.UTF8Encoding($true)))

$db = [IO.File]::ReadAllBytes($Dest)
Write-Host ("wrote {0} bytes; BOM: {1},{2},{3}; CRLF: {4}" -f $db.Length, $db[0], $db[1], $db[2], ([regex]::Matches($script, "`r`n").Count))
