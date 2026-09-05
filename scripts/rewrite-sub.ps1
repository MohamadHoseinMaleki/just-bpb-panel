# secureVpn sub rewriter with country flag
# powershell -ExecutionPolicy Bypass -File .\scripts\rewrite-sub.ps1 -SubUrl "https://.../sub/raw?app=xray"

param(
  [Parameter(Mandatory = $true)]
  [string]$SubUrl,
  [string]$OutFile = "output\securevpn-sub.txt",
  [string]$ProfileName = "secureVpn",
  [switch]$NoGeo
)

$ErrorActionPreference = "Stop"

$dir = Split-Path -Parent $OutFile
if ($dir -and -not (Test-Path $dir)) {
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
}

# ISO country -> emoji flag
function Get-Flag([string]$code) {
  if (-not $code -or $code.Length -ne 2) { return "" }
  $code = $code.ToUpper()
  $chars = $code.ToCharArray()
  $sb = New-Object System.Text.StringBuilder
  foreach ($c in $chars) {
    $cp = 0x1F1E6 + [int][char]$c - [int][char]'A'
    [void]$sb.Append([char]::ConvertFromUtf32($cp))
  }
  return $sb.ToString()
}

$geoCache = @{}

function Resolve-Geo([string]$hostOrIp) {
  if ($NoGeo) { return $null }
  if ([string]::IsNullOrWhiteSpace($hostOrIp)) { return $null }
  if ($geoCache.ContainsKey($hostOrIp)) { return $geoCache[$hostOrIp] }

  # only plain IPv4 for free API
  if ($hostOrIp -notmatch '^\d{1,3}(\.\d{1,3}){3}$') {
    $geoCache[$hostOrIp] = $null
    return $null
  }

  try {
    $url = "http://ip-api.com/json/$hostOrIp`?fields=status,country,countryCode"
    $resp = Invoke-RestMethod -Uri $url -TimeoutSec 5
    Start-Sleep -Milliseconds 200
    if ($resp.status -eq "success") {
      $flag = Get-Flag $resp.countryCode
      $label = if ($flag) { "$flag $($resp.country)" } else { $resp.country }
      $geoCache[$hostOrIp] = $label
      return $label
    }
  } catch { }
  $geoCache[$hostOrIp] = $null
  return $null
}

function Get-HostFromLine([string]$line) {
  $base = ($line -split "#")[0]
  if ($base -match '@([^:/?]+)') { return $Matches[1] }
  if ($base -match '://([^:/?]+)') { return $Matches[1] }
  return ""
}

Write-Host "Downloading subscription..."
$wc = New-Object System.Net.WebClient
$wc.Encoding = [System.Text.Encoding]::UTF8
$wc.Headers.Add("User-Agent", "v2rayNG/1.10.23")
$raw = $wc.DownloadString($SubUrl.Trim())

function Decode-Base64Utf8([string]$s) {
  $bytes = [Convert]::FromBase64String(($s -replace "\s", ""))
  return [System.Text.Encoding]::UTF8.GetString($bytes)
}
function Encode-Base64Utf8([string]$s) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($s)
  return [Convert]::ToBase64String($bytes)
}

$wasBase64 = $false
$text = $raw.Trim()
$lines = @()
if ($text -match '^(vless|vmess|trojan|ss)://') {
  $lines = $text -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" }
} else {
  try {
    $decoded = Decode-Base64Utf8 $text
    if ($decoded -match '://') {
      $wasBase64 = $true
      $lines = $decoded -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" }
    } else {
      $lines = $text -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" }
    }
  } catch {
    $lines = $text -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" }
  }
}

function Get-Name([string]$remark, [int]$index, [string]$line) {
  $hostName = Get-HostFromLine $line
  $geo = Resolve-Geo $hostName
  if ($geo) { return "$ProfileName | $geo" }

  if ($hostName -match 'workers\.dev|pages\.dev') {
    return "$ProfileName | Cloudflare"
  }

  $r = [string]$remark
  if ($r -match 'Clean\s*IP') { return "$ProfileName | Clean IP" }
  if ($r -match 'Domain') { return "$ProfileName | Cloudflare" }
  if ($r -match 'IPv6') { return "$ProfileName | IPv6" }
  if ($r -match 'IPv4') { return "$ProfileName | IPv4" }
  if ($r -match 'Best\s*Ping') { return "$ProfileName | Best Ping" }
  if ($r -match 'Upstream') { return "$ProfileName | Upstream" }

  if ($hostName -and $hostName -notmatch '^\d') {
    $short = ($hostName -split '\.')[0]
    if ($short) { return "$ProfileName | $short" }
  }

  return "$ProfileName | $index"
}

$outLines = New-Object System.Collections.Generic.List[string]
$i = 0
foreach ($line in $lines) {
  if ([string]::IsNullOrWhiteSpace($line)) { continue }
  if ($line.StartsWith("#")) { continue }
  $i++

  if (($line -match '^(vless|trojan|ss)://') -and $line.Contains("#")) {
    $idx = $line.IndexOf("#")
    $base = $line.Substring(0, $idx)
    $old = $line.Substring($idx + 1)
    try { $old = [Uri]::UnescapeDataString($old) } catch {}
    $name = Get-Name $old $i $line
    $outLines.Add($base + "#" + [Uri]::EscapeDataString($name))
    continue
  }

  if ($line -match '^vmess://') {
    try {
      $b64 = $line.Substring(8)
      $json = (Decode-Base64Utf8 $b64) | ConvertFrom-Json
      $old = [string]$json.ps
      $json.ps = Get-Name $old $i $line
      $outLines.Add("vmess://" + (Encode-Base64Utf8 ($json | ConvertTo-Json -Compress)))
    } catch {
      $outLines.Add($line)
    }
    continue
  }

  $outLines.Add($line)
}

$body = ($outLines -join "`n")
if ($wasBase64) { $body = Encode-Base64Utf8 $body }

$fullPath = Join-Path (Get-Location) $OutFile
[System.IO.File]::WriteAllText($fullPath, $body, [System.Text.UTF8Encoding]::new($false))
Write-Host "OK wrote $fullPath"
Write-Host "Configs: $($outLines.Count)"
Write-Host "Geo lookups cached: $($geoCache.Count)"
