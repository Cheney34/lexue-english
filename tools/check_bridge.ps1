#Requires -Version 5.1
<#
.SYNOPSIS
    JS ⇄ 原生 桥接契约静态校验（build.sh 中 check_bridge.py 的 Windows PowerShell 移植版）。

.DESCRIPTION
    背景：Bridge.java 里 @JavascriptInterface 方法的参数顺序，必须和
    assets/www/js/bridge.js 里发起的调用完全一致。曾经踩过一次坑——
    JS 把 callId 放在参数末尾，Java 却期望它在最前，导致 url 收到空字符串，
    请求静默失败、回调打到不存在的 callId 上，最终表现为「网络超时」，
    而单元测试因为打桩了 Bridge.http 完全发现不了。

    约定：所有异步方法第一个参数固定为 callId；同步方法直接按签名传参。

    用法：powershell -File tools\check_bridge.ps1 [-Root <项目根>]
    不通过则退出码 1（build.ps1 会据此中止构建）。

.NOTES
    逻辑与 tools/check_bridge.py 逐条对齐：异步调用 call('name', [args])、
    同步调用 N.xxx(args)、通用分发器 N[name].apply(N, [id].concat(...))。
#>
[CmdletBinding()]
param(
    [string]$Root
)

$ErrorActionPreference = 'Stop'

if (-not $Root) { $Root = Split-Path -Parent $PSScriptRoot }
$JAVA = Join-Path $Root 'app\java\com\wordpalace\app\Bridge.java'
$JS = Join-Path $Root 'app\assets\www\js\bridge.js'

foreach ($f in @($JAVA, $JS)) {
    if (-not (Test-Path $f)) { Write-Host "缺少文件: $f"; exit 1 }
}

# 顶层逗号切分（忽略泛型尖括号/括号内的逗号）。-Js 时额外处理字符串字面量与花括号。
function Split-Top {
    param([string]$Text, [switch]$Js)

    $out = New-Object System.Collections.ArrayList
    $depth = 0
    $cur = ''
    $i = 0
    $quote = [char]0

    while ($i -lt $Text.Length) {
        $c = $Text[$i]
        if ($Js -and $quote -ne [char]0) {
            if ($c -eq [char]92) {  # 反斜杠转义
                $take = [Math]::Min(2, $Text.Length - $i)
                $cur += $Text.Substring($i, $take)
                $i += 2
                continue
            }
            if ($c -eq $quote) { $quote = [char]0 }
            $cur += $c
        }
        elseif ($Js -and ($c -eq [char]34 -or $c -eq [char]39 -or $c -eq [char]96)) {
            $quote = $c
            $cur += $c
        }
        else {
            if ($c -eq [char]60 -or $c -eq [char]40 -or $c -eq [char]91) { $depth++ }
            elseif ($c -eq [char]62 -or $c -eq [char]41 -or $c -eq [char]93) { $depth-- }
            elseif ($Js -and $c -eq [char]123) { $depth++ }
            elseif ($Js -and $c -eq [char]125) { $depth-- }

            if ($c -eq [char]44 -and $depth -eq 0) {
                [void]$out.Add($cur)
                $cur = ''
            }
            else {
                $cur += $c
            }
        }
        $i++
    }
    if ($cur.Trim()) { [void]$out.Add($cur) }
    return $out
}

# 返回从 start（指向 openCh）开始、配对的 closeCh 下标；找不到返回 -1。
function Match-Bracket {
    param([string]$Text, [int]$Start, [char]$Open, [char]$Close)

    $depth = 0
    $i = $Start
    $quote = [char]0

    while ($i -lt $Text.Length) {
        $c = $Text[$i]
        if ($quote -ne [char]0) {
            if ($c -eq [char]92) { $i += 2; continue }
            if ($c -eq $quote) { $quote = [char]0 }
        }
        elseif ($c -eq [char]34 -or $c -eq [char]39 -or $c -eq [char]96) { $quote = $c }
        elseif ($c -eq $Open) { $depth++ }
        elseif ($c -eq $Close) {
            $depth--
            if ($depth -eq 0) { return $i }
        }
        $i++
    }
    return -1
}

# 统计一个 JS 数组字面量 `[...]` 顶层的元素个数。
function Get-JsArgCount {
    param([string]$Text)

    $s = $Text.Trim()
    if (-not ($s.StartsWith('[') -and $s.EndsWith(']'))) { return -1 }
    $inner = $s.Substring(1, $s.Length - 2).Trim()
    if (-not $inner) { return 0 }
    return (Split-Top -Text $inner -Js).Count
}

# 解析 Bridge.java：返回 @JavascriptInterface 方法 -> 参数名数组
function Get-JavaBridgeMethods {
    param([string]$Source)

    $methods = @{}
    $pattern = '@JavascriptInterface\s+public\s+\w+\s+(\w+)\s*\(([^)]*)\)'
    foreach ($m in [regex]::Matches($Source, $pattern)) {
        $name = $m.Groups[1].Value
        $params = $m.Groups[2].Value.Trim()
        $names = New-Object System.Collections.ArrayList
        if ($params) {
            foreach ($p in (Split-Top -Text $params)) {
                $t = $p.Trim()
                $pm = [regex]::Match($t, '(\w+)\s*$')
                if ($pm.Success) { [void]$names.Add($pm.Groups[1].Value) } else { [void]$names.Add($t) }
            }
        }
        $methods[$name] = $names.ToArray()
    }
    return $methods
}

$javaSrc = Get-Content -Path $JAVA -Raw -Encoding UTF8
$jsSrc = Get-Content -Path $JS -Raw -Encoding UTF8
$methods = Get-JavaBridgeMethods -Source $javaSrc

$problems = New-Object System.Collections.ArrayList
$checked = 0

# ---- 异步调用：call('name', [args], timeout) ----
foreach ($m in [regex]::Matches($jsSrc, "call\(\s*'(\w+)'\s*,\s*")) {
    $name = $m.Groups[1].Value
    $arrStart = $jsSrc.IndexOf('[', $m.Index + $m.Length)
    if ($arrStart -lt 0) {
        [void]$problems.Add("$JS : 找不到 call($name) 的参数数组")
        continue
    }
    $arrEnd = Match-Bracket -Text $jsSrc -Start $arrStart -Open ([char]91) -Close ([char]93)
    if ($arrEnd -lt 0) {
        [void]$problems.Add("$JS : 解析 call($name) 的参数数组失败")
        continue
    }
    $n = Get-JsArgCount -Text $jsSrc.Substring($arrStart, $arrEnd - $arrStart + 1)
    $checked++

    if (-not $methods.ContainsKey($name)) {
        [void]$problems.Add("JS 调用了原生不存在的异步方法 $name()")
        continue
    }
    $params = $methods[$name]
    if ($params.Count -eq 0 -or $params[0] -ne 'callId') {
        $first = if ($params.Count -gt 0) { $params[0] } else { '<无参数>' }
        [void]$problems.Add("$name() : Java 第一个参数必须是 callId，当前为 $first")
        continue
    }
    if ($n -ne ($params.Count - 1)) {
        $rest = ($params[1..($params.Count - 1)]) -join ', '
        [void]$problems.Add("$name() : 参数个数不匹配——JS 传 $n 个业务参数，Java 期望 $($params.Count - 1) 个 [$rest]")
    }
}

# ---- 同步调用：N.xxx(args) ----
$asyncNames = @{}
foreach ($m in [regex]::Matches($jsSrc, "call\(\s*'(\w+)'")) { $asyncNames[$m.Groups[1].Value] = $true }

foreach ($m in [regex]::Matches($jsSrc, '\bN\.(\w+)\s*\(')) {
    $name = $m.Groups[1].Value
    if ($asyncNames.ContainsKey($name)) { continue }
    if ($name -eq 'apply' -or $name -eq 'call') { continue }

    $parStart = $jsSrc.IndexOf('(', $m.Index + $m.Length - 1)
    if ($parStart -lt 0) { continue }
    $parEnd = Match-Bracket -Text $jsSrc -Start $parStart -Open ([char]40) -Close ([char]41)
    if ($parEnd -lt 0) { continue }

    $args = $jsSrc.Substring($parStart + 1, $parEnd - $parStart - 1).Trim()
    $n = if (-not $args) { 0 } else { (Split-Top -Text $args -Js).Count }
    $checked++

    if (-not $methods.ContainsKey($name)) {
        [void]$problems.Add("JS 调用了原生不存在的同步方法 $name()")
        continue
    }
    $params = $methods[$name]
    if ($params.Count -gt 0 -and $params[0] -eq 'callId') {
        [void]$problems.Add("$name() : 这是异步方法（首参为 callId），应当用 call() 调用")
    }
    elseif ($n -ne $params.Count) {
        [void]$problems.Add("$name() : 参数个数不匹配——JS 传 $n 个，Java 期望 $($params.Count) 个 [$($params -join ', ')]")
    }
}

# ---- 通用分发器：N[name].apply(N, ...) 必须把 id 放在参数最前 ----
$disp = [regex]::Match($jsSrc, 'N\[name\]\.apply\s*\(')
if ($disp.Success) {
    $parStart = $jsSrc.IndexOf('(', $disp.Index + $disp.Length - 1)
    $parEnd = Match-Bracket -Text $jsSrc -Start $parStart -Open ([char]40) -Close ([char]41)
    $checked++
    if ($parEnd -lt 0) {
        [void]$problems.Add('解析 N[name].apply(...) 失败')
    }
    else {
        $args = Split-Top -Text $jsSrc.Substring($parStart + 1, $parEnd - $parStart - 1) -Js
        if ($args.Count -ne 2) {
            [void]$problems.Add('N[name].apply 应当只有两个参数（thisArg 与参数数组）')
        }
        else {
            $second = $args[1].Trim()
            if (-not [regex]::IsMatch($second, '^\[\s*id\s*\]\s*\.concat\b')) {
                $head = $second.Substring(0, [Math]::Min(70, $second.Length))
                [void]$problems.Add("N[name].apply 的第二个参数必须以 [id].concat(...) 开头（callId 必须是原生方法的第一个参数），当前为: $head")
            }
        }
    }
}
else {
    [void]$problems.Add('未找到 N[name].apply 通用分发器，桥接实现可能已变更')
}

# ---- 未在 JS 中使用的原生方法（仅提示）----
$unused = @()
foreach ($k in $methods.Keys) {
    if (($jsSrc -notmatch [regex]::Escape("'$k'")) -and ($jsSrc -notmatch [regex]::Escape("N.$k"))) { $unused += $k }
}

Write-Host ("桥接契约检查：比对 {0} 处调用，原生方法 {1} 个" -f $checked, $methods.Count)
if ($unused.Count -gt 0) {
    Write-Host ("  提示：以下原生方法 JS 侧未使用 -> " + (($unused | Sort-Object) -join ', '))
}
if ($problems.Count -gt 0) {
    Write-Host ''
    foreach ($p in $problems) { Write-Host "  ✗ $p" }
    Write-Host ''
    Write-Host '契约校验失败：JS 与 Java 的方法签名不一致。'
    exit 1
}
Write-Host '  ✓ 全部一致（异步方法首参均为 callId）'
exit 0
