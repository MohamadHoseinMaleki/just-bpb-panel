# Builds ready-to-paste static worker.js from rewritten sub file
# Usage (after rewrite-sub.ps1):
#   powershell -ExecutionPolicy Bypass -File .\scripts\generate-static-worker.ps1

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

$fullIn = (Resolve-Path $InFile).Path
$bodyBytes = [System.IO.File]::ReadAllBytes($fullIn)
$b64 = [Convert]::ToBase64String($bodyBytes)

# Chunk base64 so source stays readable / avoids huge single-line issues
$chunkSize = 120
$chunks = New-Object System.Collections.Generic.List[string]
for ($i = 0; $i -lt $b64.Length; $i += $chunkSize) {
  $len = [Math]::Min($chunkSize, $b64.Length - $i)
  $chunks.Add($b64.Substring($i, $len))
}
$b64Joined = ($chunks | ForEach-Object { "  \"$_\"" }) -join ",`n"

$js = @"
const PARTS = [
$b64Joined
];
const BODY = new TextDecoder().decode(
  Uint8Array.from(atob(PARTS.join("")), (c) => c.charCodeAt(0))
);

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
if ($dir -and -not (Test-Path $dir)) {
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
}
$fullOut = Join-Path (Get-Location) $OutFile
[System.IO.File]::WriteAllText($fullOut, $js, [System.Text.UTF8Encoding]::new($false))

Write-Host "OK wrote $fullOut"
Write-Host "Size: $((Get-Item $fullOut).Length) bytes"
Write-Host "Next: Cloudflare -> autumn-waterfall-dce9 -> Edit code -> paste ALL of this file -> Deploy"
