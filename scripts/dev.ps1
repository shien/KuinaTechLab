[CmdletBinding()]
param(
  [int]$Port = 4173,
  [switch]$NoWatch
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$SiteDir     = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$DistDir     = Join-Path $SiteDir 'dist'
$SrcDir      = Join-Path $SiteDir 'src'
$GamesDir    = Join-Path $SiteDir 'games'
$BuildScript = Join-Path $PSScriptRoot 'build.ps1'

# Initial build
& $BuildScript

$mimeTypes = @{
  '.html' = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'application/javascript; charset=utf-8'
  '.mjs'  = 'application/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.webp' = 'image/webp'
  '.ico'  = 'image/x-icon'
  '.txt'  = 'text/plain; charset=utf-8'
}

$statusPhrases = @{
  200 = 'OK'
  400 = 'Bad Request'
  403 = 'Forbidden'
  404 = 'Not Found'
  405 = 'Method Not Allowed'
}

function Get-SourceStamp([string[]]$Roots) {
  $max = [int64]0
  foreach ($r in $Roots) {
    if (-not (Test-Path $r)) { continue }
    $files = Get-ChildItem -Path $r -Recurse -File -ErrorAction SilentlyContinue
    if ($files) {
      $t = ($files | Measure-Object -Property LastWriteTimeUtc -Maximum).Maximum.Ticks
      if ($t -gt $max) { $max = $t }
    }
  }
  return $max
}

function Send-HttpResponse($Stream, [int]$StatusCode, [string]$ContentType, [byte[]]$Body, [bool]$HeadOnly) {
  $phrase = if ($statusPhrases.ContainsKey($StatusCode)) { $statusPhrases[$StatusCode] } else { 'OK' }
  $headerText = "HTTP/1.1 $StatusCode $phrase`r`n" +
                "Content-Type: $ContentType`r`n" +
                "Content-Length: $($Body.Length)`r`n" +
                "Cache-Control: no-cache`r`n" +
                "Connection: close`r`n`r`n"
  $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headerText)
  $Stream.Write($headerBytes, 0, $headerBytes.Length)
  if (-not $HeadOnly -and $Body.Length -gt 0) {
    $Stream.Write($Body, 0, $Body.Length)
  }
  $Stream.Flush()
}

$watchRoots = @($SrcDir, $GamesDir)
$lastStamp = Get-SourceStamp $watchRoots
$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
$listener.Start()

Write-Host ""
Write-Host "Dev server listening at http://127.0.0.1:$Port/ (http://localhost:$Port/)"
Write-Host "Serving static build from $DistDir"
if (-not $NoWatch) {
  Write-Host "Auto-rebuild enabled for src/ and games/ (Ctrl+C to stop)"
}

try {
  while ($true) {
    if ($listener.Pending()) {
      $client = $listener.AcceptTcpClient()
      try {
        $client.ReceiveTimeout = 3000
        $client.SendTimeout = 5000
        $stream = $client.GetStream()
        $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)
        $requestLine = $reader.ReadLine()

        if ([string]::IsNullOrWhiteSpace($requestLine)) {
          continue
        }

        # Drain request headers
        while ($true) {
          $line = $reader.ReadLine()
          if ([string]::IsNullOrEmpty($line)) { break }
        }

        $parts = $requestLine.Split(' ')
        if ($parts.Length -lt 2) {
          Send-HttpResponse $stream 400 'text/plain; charset=utf-8' ([System.Text.Encoding]::UTF8.GetBytes('Bad Request')) $false
          continue
        }

        $method = $parts[0].ToUpperInvariant()
        if ($method -ne 'GET' -and $method -ne 'HEAD') {
          Send-HttpResponse $stream 405 'text/plain; charset=utf-8' ([System.Text.Encoding]::UTF8.GetBytes('Method Not Allowed')) $false
          continue
        }

        $rawTarget = $parts[1]
        $qIdx = $rawTarget.IndexOf('?')
        $pathOnly = if ($qIdx -ge 0) { $rawTarget.Substring(0, $qIdx) } else { $rawTarget }
        $reqPath = [Uri]::UnescapeDataString($pathOnly)

        if ($reqPath -eq '/' -or $reqPath -eq '') {
          $reqPath = '/index.html'
        } elseif ($reqPath.EndsWith('/')) {
          $reqPath = $reqPath + 'index.html'
        }

        $relPath = $reqPath.TrimStart('/').Replace('/', '\')
        $fullPath = [System.IO.Path]::GetFullPath((Join-Path $DistDir $relPath))

        $statusCode = 200
        if (-not $fullPath.StartsWith($DistDir, [System.StringComparison]::OrdinalIgnoreCase)) {
          $statusCode = 403
          $fullPath = $null
        } elseif (Test-Path $fullPath -PathType Container) {
          $fullPath = Join-Path $fullPath 'index.html'
        }

        if (-not $fullPath -or -not (Test-Path $fullPath -PathType Leaf)) {
          $statusCode = 404
          $fallback404 = Join-Path $DistDir '404.html'
          $fullPath = if (Test-Path $fallback404) { $fallback404 } else { $null }
        }

        if ($fullPath) {
          $ext = [System.IO.Path]::GetExtension($fullPath).ToLowerInvariant()
          $contentType = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { 'application/octet-stream' }
          $body = [System.IO.File]::ReadAllBytes($fullPath)
          Send-HttpResponse $stream $statusCode $contentType $body ($method -eq 'HEAD')
        } else {
          $body = [System.Text.Encoding]::UTF8.GetBytes("Error $statusCode")
          Send-HttpResponse $stream $statusCode 'text/plain; charset=utf-8' $body ($method -eq 'HEAD')
        }
      } catch {
        # Ignore abrupt client disconnects
      } finally {
        $client.Close()
      }
    } else {
      Start-Sleep -Milliseconds 60
      if (-not $NoWatch) {
        $stamp = Get-SourceStamp $watchRoots
        if ($stamp -gt $lastStamp) {
          $lastStamp = $stamp
          Write-Host "[watch] Change detected — rebuilding..."
          try {
            & $BuildScript
          } catch {
            Write-Warning "Rebuild failed: $_"
          }
        }
      }
    }
  }
} finally {
  $listener.Stop()
}
