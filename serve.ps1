# StudyBuddy local dev server (no dependencies — uses built-in Windows PowerShell).
# Usage:  right-click -> "Run with PowerShell",  or:  powershell -ExecutionPolicy Bypass -File serve.ps1
# Then open the URL it prints (default http://localhost:8000).

param([int]$Port = 8000)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

$mime = @{
  ".html"="text/html; charset=utf-8"; ".js"="text/javascript; charset=utf-8";
  ".mjs"="text/javascript; charset=utf-8"; ".css"="text/css; charset=utf-8";
  ".json"="application/json; charset=utf-8"; ".svg"="image/svg+xml";
  ".png"="image/png"; ".jpg"="image/jpeg"; ".jpeg"="image/jpeg"; ".gif"="image/gif";
  ".woff2"="font/woff2"; ".woff"="font/woff"; ".ttf"="font/ttf"; ".ico"="image/x-icon";
  ".map"="application/json"
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
try { $listener.Start() }
catch {
  Write-Host "Could not start on port $Port. Try another port:  .\serve.ps1 -Port 8001" -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "  StudyBuddy running at  http://localhost:$Port" -ForegroundColor Green
Write-Host "  Serving:               $root"
Write-Host "  Press Ctrl+C to stop."
Write-Host ""

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    try {
      $rel = [Uri]::UnescapeDataString($req.Url.AbsolutePath.TrimStart("/"))
      if ($rel -eq "") { $rel = "index.html" }
      $path = Join-Path $root $rel
      $full = [System.IO.Path]::GetFullPath($path)
      if (-not $full.StartsWith([System.IO.Path]::GetFullPath($root))) {
        $res.StatusCode = 403; $res.Close(); continue
      }
      if (Test-Path $full -PathType Leaf) {
        $ext = [System.IO.Path]::GetExtension($full).ToLower()
        $ct = $mime[$ext]; if (-not $ct) { $ct = "application/octet-stream" }
        $bytes = [System.IO.File]::ReadAllBytes($full)
        $res.ContentType = $ct
        $res.Headers.Add("Cache-Control", "no-store, must-revalidate")
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
        Write-Host ("  200  {0}" -f $rel)
      } else {
        $res.StatusCode = 404
        $msg = [Text.Encoding]::UTF8.GetBytes("404 Not Found: $rel")
        $res.OutputStream.Write($msg, 0, $msg.Length)
        Write-Host ("  404  {0}" -f $rel) -ForegroundColor DarkYellow
      }
    } catch {
      $res.StatusCode = 500
      Write-Host ("  500  {0}  {1}" -f $rel, $_.Exception.Message) -ForegroundColor Red
    } finally {
      $res.OutputStream.Close()
    }
  }
} finally {
  $listener.Stop()
}
