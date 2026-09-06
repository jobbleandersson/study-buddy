# build-icons.ps1 — regenerate the PWA / touch icons from assets/favicon.svg
# using headless Chrome or Edge. No npm, ImageMagick or Inkscape needed.
#
#   powershell -ExecutionPolicy Bypass -File build-icons.ps1
#
# Overwrites, in place:
#   assets/icon-192.png           192  rounded corners, transparent outside
#   assets/icon-512.png           512  rounded corners, transparent outside
#   assets/icon-maskable-512.png  512  full-bleed square (Android adaptive-icon)
#   assets/apple-touch-icon.png   180  full-bleed square (iOS applies its own mask)
#
# The book glyph sits within the centre ~55% of the frame, so it stays inside
# the maskable safe zone on every launcher shape.

$ErrorActionPreference = "Stop"
$root   = Split-Path -Parent $MyInvocation.MyCommand.Path
$assets = Join-Path $root "assets"
$src    = Join-Path $assets "favicon.svg"
if (-not (Test-Path $src)) { throw "assets/favicon.svg not found next to this script." }

# --- locate a Chromium-based browser -----------------------------------------
$candidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
)
$browser = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browser) { throw "No Chrome or Edge found. Run this on a machine that has one installed." }
Write-Host "Rasterising with: $browser"

# --- two source SVGs: the rounded original, and a full-bleed square variant ---
$rounded = Get-Content $src -Raw
$square  = $rounded -replace ' rx="16"', ''      # drop the corner radius

$work = Join-Path $env:TEMP ("sb-icons-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $work -Force | Out-Null
$roundedSvg = Join-Path $work "rounded.svg"
$squareSvg  = Join-Path $work "square.svg"
Set-Content -Path $roundedSvg -Value $rounded -Encoding UTF8
Set-Content -Path $squareSvg  -Value $square  -Encoding UTF8

function Invoke-Render {
  param([string]$SvgPath, [int]$Size, [string]$OutPath)

  $svgUrl  = "file:///" + ($SvgPath -replace '\\', '/')
  $html = @"
<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:transparent}
img{display:block;width:${Size}px;height:${Size}px}</style>
<img src="$svgUrl">
"@
  $htmlPath = Join-Path $work "wrap-$Size-$([IO.Path]::GetFileNameWithoutExtension($OutPath)).html"
  Set-Content -Path $htmlPath -Value $html -Encoding UTF8
  $htmlUrl = "file:///" + ($htmlPath -replace '\\', '/')

  if (Test-Path $OutPath) { Remove-Item $OutPath -Force }

  $common = "--disable-gpu --no-sandbox --no-first-run --no-default-browser-check " +
            "--hide-scrollbars --force-device-scale-factor=1 --virtual-time-budget=2000 " +
            "--default-background-color=00000000 --user-data-dir=`"$work\profile`" " +
            "--window-size=$Size,$Size --screenshot=`"$OutPath`" `"$htmlUrl`""

  foreach ($mode in @("--headless=new", "--headless")) {
    Start-Process -FilePath $browser -ArgumentList "$mode $common" -Wait -NoNewWindow
    if (Test-Path $OutPath) { return }
  }
  throw "headless render produced no file for $OutPath"
}

$targets = @(
  @{ Svg = $roundedSvg; Size = 192; Out = "icon-192.png" },
  @{ Svg = $roundedSvg; Size = 512; Out = "icon-512.png" },
  @{ Svg = $squareSvg;  Size = 512; Out = "icon-maskable-512.png" },
  @{ Svg = $squareSvg;  Size = 180; Out = "apple-touch-icon.png" }
)

Add-Type -AssemblyName System.Drawing
Write-Host ""
foreach ($t in $targets) {
  $out = Join-Path $assets $t.Out
  Invoke-Render -SvgPath $t.Svg -Size $t.Size -OutPath $out
  $img = [System.Drawing.Image]::FromFile($out)
  $ok  = ($img.Width -eq $t.Size -and $img.Height -eq $t.Size)
  "{0} {1,-24} {2}x{3}  {4:N0} bytes" -f $(if ($ok) { "[ok] " } else { "[!!] " }), $t.Out, $img.Width, $img.Height, (Get-Item $out).Length
  $img.Dispose()
}

Remove-Item $work -Recurse -Force
Write-Host ""
Write-Host "Done. Eyeball the four files in assets/, then commit."
