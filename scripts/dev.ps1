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
$LifeDir     = Join-Path $SiteDir 'life'
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
  201 = 'Created'
  400 = 'Bad Request'
  403 = 'Forbidden'
  404 = 'Not Found'
  405 = 'Method Not Allowed'
  413 = 'Payload Too Large'
}

# Local in-memory store mirroring Cloudflare Durable Objects (/api/schedule/*)
$localRooms = @{}

function New-LocalRoomId {
  $bytes = New-Object byte[] 12
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return [Convert]::ToBase64String($bytes).Replace('+','-').Replace('/','_').TrimEnd('=')
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

$watchRoots = @($SrcDir, $GamesDir, $LifeDir)
$lastStamp = Get-SourceStamp $watchRoots
$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
$listener.Start()

Write-Host ""
Write-Host "Dev server listening at http://127.0.0.1:$Port/ (http://localhost:$Port/)"
Write-Host "Serving static build from $DistDir"
if (-not $NoWatch) {
  Write-Host "Auto-rebuild enabled for src/, games/, and life/ (Ctrl+C to stop)"
}

try {
  while ($true) {
    if ($listener.Pending()) {
      $client = $listener.AcceptTcpClient()
      try {
        $client.ReceiveTimeout = 3000
        $client.SendTimeout = 5000
        $stream = $client.GetStream()
        $ms = New-Object System.IO.MemoryStream
        $tmp = New-Object byte[] 4096
        $headerEnd = -1
        while ($headerEnd -lt 0) {
          $n = $stream.Read($tmp, 0, $tmp.Length)
          if ($n -le 0) { break }
          $ms.Write($tmp, 0, $n)
          $allBytes = $ms.ToArray()
          for ($k = 0; $k -le $allBytes.Length - 4; $k++) {
            if ($allBytes[$k] -eq 13 -and $allBytes[$k+1] -eq 10 -and $allBytes[$k+2] -eq 13 -and $allBytes[$k+3] -eq 10) {
              $headerEnd = $k
              break
            }
          }
          if ($allBytes.Length -gt 81920) { break }
        }

        if ($headerEnd -lt 0) {
          continue
        }

        $rawBytes = $ms.ToArray()
        $headerStr = [System.Text.Encoding]::ASCII.GetString($rawBytes, 0, $headerEnd)
        $headerLines = $headerStr -split "`r`n"
        $requestLine = $headerLines[0]
        if ([string]::IsNullOrWhiteSpace($requestLine)) {
          continue
        }

        $contentLength = 0
        for ($hi = 1; $hi -lt $headerLines.Length; $hi++) {
          if ($headerLines[$hi] -match '^Content-Length:\s*(\d+)$') {
            $contentLength = [int]$Matches[1]
          }
        }

        $bodyStart = $headerEnd + 4
        if ($contentLength -gt 0 -and $contentLength -le 65536) {
          while (($ms.Length - $bodyStart) -lt $contentLength) {
            $n = $stream.Read($tmp, 0, $tmp.Length)
            if ($n -le 0) { break }
            $ms.Write($tmp, 0, $n)
          }
          $rawBytes = $ms.ToArray()
        }

        $parts = $requestLine.Split(' ')
        if ($parts.Length -lt 2) {
          Send-HttpResponse $stream 400 'text/plain; charset=utf-8' ([System.Text.Encoding]::UTF8.GetBytes('Bad Request')) $false
          continue
        }

        $method = $parts[0].ToUpperInvariant()
        $rawTarget = $parts[1]
        $qIdx = $rawTarget.IndexOf('?')
        $pathOnly = if ($qIdx -ge 0) { $rawTarget.Substring(0, $qIdx) } else { $rawTarget }
        $reqPath = [Uri]::UnescapeDataString($pathOnly)

        # Handle /api/schedule/* locally for end-to-end testing
        if ($reqPath.StartsWith('/api/schedule')) {
          $bodyText = ''
          if ($contentLength -gt 0 -and ($rawBytes.Length - $bodyStart) -ge $contentLength) {
            $bodyText = [System.Text.Encoding]::UTF8.GetString($rawBytes, $bodyStart, $contentLength)
          }

          if ($reqPath -eq '/api/schedule/create' -and $method -eq 'POST') {
            $rid = New-LocalRoomId
            $ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
            $localRooms[$rid] = @{ payload = $bodyText; updatedAt = $ts }
            $respJson = "{`"roomId`":`"$rid`",`"updatedAt`":$ts}"
            Send-HttpResponse $stream 201 'application/json; charset=utf-8' ([System.Text.Encoding]::UTF8.GetBytes($respJson)) $false
            continue
          }

          if ($reqPath -match '^/api/schedule/([A-Za-z0-9_-]{10,48})$') {
            $rid = $Matches[1]
            if ($method -eq 'GET') {
              if (-not $localRooms.ContainsKey($rid)) {
                Send-HttpResponse $stream 404 'application/json; charset=utf-8' ([System.Text.Encoding]::UTF8.GetBytes('{"error":"room_not_found"}')) $false
                continue
              }
              $rec = $localRooms[$rid]
              $obj = $rec.payload | ConvertFrom-Json
              $outObj = @{ roomId = $rid; slot = $obj.slot; schedules = $obj.schedules; updatedAt = $rec.updatedAt }
              $json = $outObj | ConvertTo-Json -Depth 10 -Compress
              Send-HttpResponse $stream 200 'application/json; charset=utf-8' ([System.Text.Encoding]::UTF8.GetBytes($json)) $false
              continue
            }
            if ($method -eq 'PUT') {
              $ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
              $localRooms[$rid] = @{ payload = $bodyText; updatedAt = $ts }
              $respJson = "{`"ok`":true,`"roomId`":`"$rid`",`"updatedAt`":$ts}"
              Send-HttpResponse $stream 200 'application/json; charset=utf-8' ([System.Text.Encoding]::UTF8.GetBytes($respJson)) $false
              continue
            }
          }

          Send-HttpResponse $stream 404 'application/json; charset=utf-8' ([System.Text.Encoding]::UTF8.GetBytes('{"error":"not_found"}')) $false
          continue
        }

        if ($method -ne 'GET' -and $method -ne 'HEAD') {
          Send-HttpResponse $stream 405 'text/plain; charset=utf-8' ([System.Text.Encoding]::UTF8.GetBytes('Method Not Allowed')) $false
          continue
        }

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
