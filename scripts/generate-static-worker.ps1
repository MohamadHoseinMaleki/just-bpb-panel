# Builds a ready-to-paste static worker.js from rewritten sub file
# Usage:
#   1) run rewrite-sub.ps1 first
#   2) powershell -ExecutionPolicy Bypass -File .\scripts\generate-static-worker.ps1

param(
  [string]$InFile = "output\securevpn-sub.txt",
  [string]$OutFile = "output\static-worker.js",
  [string]$ProfileName = "secureVpn"
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path $InFile)) {
  Write-Host "Missing $InFile - run rewrite-sub.ps1 first"
  exit 1
}

$body = [System.IO.File]::ReadAllText((Resolve-Path $InFile).Path)
# escape for JS template literal
$escaped = $body.Replace("\\", "\\\\").Replace("`", "\\`").Replace("\$", "\\$")

$js = @"
const BODY = `$escaped`;

export default {
  async fetch() {
    return new Response(BODY, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Profile-Title": "base64:" + btoa(unescape(encodeURIComponent("$ProfileName"))),
        "Cache-Control": "no-store",
      },
    });
  },
};
"@

$dir = Split-Path -Parent $OutFile
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
$full = Join-Path (Get-Location) $OutFile
[System.IO.File]::WriteAllText($full, $js, [System.Text.UTF8Encoding]::new($false))
Write-Host "OK wrote $full"
Write-Host "Copy ALL of this file into Cloudflare Worker Edit code, then Deploy."
