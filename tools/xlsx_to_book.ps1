<#
  xlsx_to_book.ps1 —— 把 xlsx 词书转成乐学英语可导入的词书 JSON

  用法：
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\xlsx_to_book.ps1 `
        -Path "D:\词库\7.雅思" -Out "D:\词库\雅思.json"

  参数：
    -Path      xlsx 文件，或目录（递归找 *.xlsx；每个文件生成一本词书）
    -Out       输出的 JSON 文件（默认：与 -Path 同目录的 <目录名>.json）
    -WithSentence  把例句一并塞进释义末尾（默认不塞）

  说明：
    1. 只读 xlsx 的文本，不依赖 Excel / Python / 任何第三方库（纯 PowerShell + .NET）。
    2. 表头靠「单词/Word」和「释义/Definition」自动认列，多认几个常见别名；
       音标列找不到就留空，不影响导入。
    3. 同一本词书内按小写单词去重；空单词、空释义的行丢掉。
    4. 输出格式：
         {"v":1,"kind":"wp-books","books":[{"name":"…","desc":"…","color":"#…",
           "words":[["word","/fəˈnetɪk/","n. 释义"], …]}]}
       在 App 的「词书」页点「导入词书（JSON 文件）」直接选这个文件即可。

  注意：转换出来的数据属于你导入的那份词书的版权方，请只自己用，
        不要提交到仓库、不要随 APK 分发（详见仓库 THIRD_PARTY_NOTICES.md）。
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [string]$Out = '',
  [switch]$WithSentence
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$COLORS = @('#3d5a80', '#4c956c', '#2a9d8f', '#5c6bc0', '#7b5ea7',
            '#c9803a', '#b5651d', '#8d5a5a', '#2f6f4e', '#6b7280')

function Get-ColIndex([string]$ref) {
  # "BC12" -> 55（0 基）
  $letters = ($ref -replace '[^A-Za-z]', '').ToUpperInvariant()
  $n = 0
  foreach ($ch in $letters.ToCharArray()) { $n = $n * 26 + ([int][char]$ch - 64) }
  return $n - 1
}

function Read-SharedStrings($zip, [string]$name) {
  $list = New-Object System.Collections.ArrayList
  $entry = $zip.GetEntry($name)
  if (-not $entry) { return $list }
  $sr = New-Object System.IO.StreamReader($entry.Open(), [Text.Encoding]::UTF8)
  try { $xmlText = $sr.ReadToEnd() } finally { $sr.Dispose() }
  $doc = New-Object System.Xml.XmlDocument
  $doc.LoadXml($xmlText)
  foreach ($si in $doc.GetElementsByTagName('si')) {
    $sb = New-Object System.Text.StringBuilder
    foreach ($t in $si.GetElementsByTagName('t')) { [void]$sb.Append($t.InnerText) }
    [void]$list.Add($sb.ToString())
  }
  return $list
}

function Read-SheetRows($zip, [string]$name, $shared) {
  $rows = New-Object System.Collections.ArrayList
  $entry = $zip.GetEntry($name)
  if (-not $entry) { return $rows }
  $sr = New-Object System.IO.StreamReader($entry.Open(), [Text.Encoding]::UTF8)
  try { $xmlText = $sr.ReadToEnd() } finally { $sr.Dispose() }
  $doc = New-Object System.Xml.XmlDocument
  $doc.LoadXml($xmlText)
  foreach ($row in $doc.GetElementsByTagName('row')) {
    $cells = @{}
    $maxIdx = -1
    foreach ($c in $row.GetElementsByTagName('c')) {
      $r = $c.GetAttribute('r')
      $idx = if ($r) { Get-ColIndex $r } else { $maxIdx + 1 }
      $type = $c.GetAttribute('t')
      $val = ''
      if ($type -eq 'inlineStr') {
        $sb = New-Object System.Text.StringBuilder
        foreach ($t in $c.GetElementsByTagName('t')) { [void]$sb.Append($t.InnerText) }
        $val = $sb.ToString()
      }
      else {
        $vNode = $null
        foreach ($child in $c.ChildNodes) { if ($child.LocalName -eq 'v') { $vNode = $child; break } }
        if ($vNode) {
          $raw = $vNode.InnerText
          if ($type -eq 's') {
            $si = 0
            if ([int]::TryParse($raw, [ref]$si) -and $si -ge 0 -and $si -lt $shared.Count) {
              $val = $shared[$si]
            }
          }
          else { $val = $raw }
        }
      }
      $cells[$idx] = ([string]$val).Trim()
      if ($idx -gt $maxIdx) { $maxIdx = $idx }
    }
    $arr = New-Object string[] ($maxIdx + 1)
    for ($i = 0; $i -le $maxIdx; $i++) {
      $arr[$i] = if ($cells.ContainsKey($i)) { $cells[$i] } else { '' }
    }
    [void]$rows.Add($arr)
  }
  return $rows
}

function Find-Header($rows) {
  # 在前 10 行里找表头，返回 @{ Row = 行号; Word = 列; Phon = 列; Def = 列; Sent = 列 }
  $wordKeys = @('word', '单词', '單詞', '词汇', '詞彙', 'english', '英文')
  $phonKeys = @('phonetic', '英音', '美音', '音标', '音標', 'ipa', 'pron', '读音', '發音', '发音')
  $defKeys  = @('definition', '释义', '釋義', '中文', '意思', '词义', '詞義', 'meaning')
  $sentKeys = @('sentence', '例句', 'example', '例')
  $limit = [Math]::Min(10, $rows.Count)
  for ($r = 0; $r -lt $limit; $r++) {
    $row = $rows[$r]
    $map = @{ Word = -1; Phon = -1; Def = -1; Sent = -1 }
    for ($c = 0; $c -lt $row.Count; $c++) {
      $v = ([string]$row[$c]).Trim().ToLowerInvariant()
      if (-not $v) { continue }
      if ($map.Word -lt 0 -and ($wordKeys -contains $v)) { $map.Word = $c; continue }
      if ($map.Phon -lt 0 -and ($phonKeys -contains $v)) { $map.Phon = $c; continue }
      if ($map.Def  -lt 0 -and ($defKeys  -contains $v)) { $map.Def  = $c; continue }
      if ($map.Sent -lt 0 -and ($sentKeys -contains $v)) { $map.Sent = $c; continue }
    }
    if ($map.Word -ge 0 -and $map.Def -ge 0) {
      $map.Row = $r
      return $map
    }
  }
  # 没有表头就按 A=单词 B=音标 C=释义 的常见排布兜底
  return @{ Row = -1; Word = 0; Phon = 1; Def = 2; Sent = -1 }
}

function Convert-OneFile([string]$file) {
  $zip = [IO.Compression.ZipFile]::OpenRead($file)
  try {
    $shared = Read-SharedStrings $zip 'xl/sharedStrings.xml'
    # 找出第一张工作表的实际路径
    $sheetPath = 'xl/worksheets/sheet1.xml'
    $wbEntry = $zip.GetEntry('xl/workbook.xml')
    if ($wbEntry) {
      $sr = New-Object System.IO.StreamReader($wbEntry.Open(), [Text.Encoding]::UTF8)
      try { $wbXml = $sr.ReadToEnd() } finally { $sr.Dispose() }
      $wb = New-Object System.Xml.XmlDocument
      $wb.LoadXml($wbXml)
      $sheets = $wb.GetElementsByTagName('sheet')
      if ($sheets.Count -gt 0) {
        $rid = $sheets[0].GetAttribute('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
        $relEntry = $zip.GetEntry('xl/_rels/workbook.xml.rels')
        if ($rid -and $relEntry) {
          $sr2 = New-Object System.IO.StreamReader($relEntry.Open(), [Text.Encoding]::UTF8)
          try { $relXml = $sr2.ReadToEnd() } finally { $sr2.Dispose() }
          $rel = New-Object System.Xml.XmlDocument
          $rel.LoadXml($relXml)
          foreach ($relNode in $rel.GetElementsByTagName('Relationship')) {
            if ($relNode.GetAttribute('Id') -eq $rid) {
              $target = $relNode.GetAttribute('Target')
              $target = $target -replace '^/xl/', '' -replace '^\.\./', ''
              if ($target -notmatch '^xl/') { $target = 'xl/' + $target }
              $sheetPath = $target
              break
            }
          }
        }
      }
    }
    $rows = Read-SheetRows $zip $sheetPath $shared
  }
  finally { $zip.Dispose() }

  if ($rows.Count -eq 0) { return $null }
  $h = Find-Header $rows

  $words = New-Object System.Collections.ArrayList
  $seen = @{}
  for ($r = $h.Row + 1; $r -lt $rows.Count; $r++) {
    $row = $rows[$r]
    $w = if ($h.Word -lt $row.Count) { ([string]$row[$h.Word]).Trim() } else { '' }
    $d = if ($h.Def -lt $row.Count) { ([string]$row[$h.Def]).Trim() } else { '' }
    if (-not $w -or -not $d) { continue }
    if ($w.Length -gt 60) { continue }
    # 释义里常有换行（一个词性一行），界面上按行显示不好看，压成「；」分隔
    $d = ($d -replace '\s*[\r\n]+\s*', '；') -replace '；{2,}', '；'
    $d = $d.Trim('；', ' ', "`t")
    $p = if ($h.Phon -ge 0 -and $h.Phon -lt $row.Count) { ([string]$row[$h.Phon]).Trim() } else { '' }
    # 词书里的音标常写成 [bʊk]，App 里显示时会自己加方括号，这里去掉
    $p = $p.Trim('[', ']', ' ')
    if ($WithSentence -and $h.Sent -ge 0 -and $h.Sent -lt $row.Count) {
      $s = ([string]$row[$h.Sent]).Trim()
      if ($s) { $d = $d + '（例：' + $s + '）' }
    }
    $key = $w.ToLowerInvariant()
    if ($seen.ContainsKey($key)) { continue }
    $seen[$key] = 1
    [void]$words.Add(@($w, $p, $d))
  }

  if ($words.Count -eq 0) { return $null }
  $name = [IO.Path]::GetFileNameWithoutExtension($file)
  return [pscustomobject]@{
    name  = $name
    desc  = ('导入词书 · ' + $words.Count + ' 词')
    color = $COLORS[$script:colorIdx % $COLORS.Count]
    words = $words
  }
}

# ------------------------------ 主流程 ------------------------------
$target = (Resolve-Path -LiteralPath $Path).Path
$files = @()
if (Test-Path -LiteralPath $target -PathType Container) {
  $files = Get-ChildItem -LiteralPath $target -Recurse -Filter *.xlsx -File |
           Where-Object { $_.Name -notlike '~$*' } | Sort-Object FullName | ForEach-Object { $_.FullName }
  if (-not $Out) { $Out = Join-Path (Split-Path -Parent $target) ((Split-Path -Leaf $target) + '.json') }
}
else {
  $files = @($target)
  if (-not $Out) { $Out = [IO.Path]::ChangeExtension($target, '.json') }
}

$books = New-Object System.Collections.ArrayList
$script:colorIdx = 0
foreach ($f in $files) {
  Write-Host ('读取 ' + [IO.Path]::GetFileName($f))
  $b = Convert-OneFile $f
  if ($b) {
    if ($b.words.Count -gt 0) {
      [void]$books.Add($b)
      Write-Host ('  -> ' + $b.words.Count + ' 词')
    }
  }
  else { Write-Host '  -> 跳过（没认到单词/释义列）' }
  $script:colorIdx++
}

if ($books.Count -eq 0) { Write-Host '没有转换出任何词书。'; exit 1 }

$payload = [pscustomobject]@{
  v         = 1
  kind      = 'wp-books'
  generator = 'tools/xlsx_to_book.ps1'
  note      = '仅本地个人使用；数据版权归原词书版权方，请勿提交到仓库或随 APK 分发。'
  books     = $books
}

$json = $payload | ConvertTo-Json -Depth 6 -Compress
$enc = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($Out, $json, $enc)
$mb = [Math]::Round((Get-Item -LiteralPath $Out).Length / 1MB, 2)
Write-Host ''
Write-Host ('输出：' + $Out)
Write-Host ('词书 ' + $books.Count + ' 本，' + $mb + ' MB')
if ($mb -gt 3.5) { Write-Host '注意：文件超过 3.5 MB，App 读取上限是 4 MB，建议分批转换。' }
