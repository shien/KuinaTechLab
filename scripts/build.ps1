[CmdletBinding()]
param(
  [switch]$Quiet
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$sw = [System.Diagnostics.Stopwatch]::StartNew()

$SiteDir   = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$SrcDir    = Join-Path $SiteDir 'src'
$DistDir   = Join-Path $SiteDir 'dist'
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Read-Utf8([string]$Path) {
  return [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
}

function Write-Utf8([string]$Path, [string]$Content) {
  $dir = Split-Path -Parent $Path
  if (-not (Test-Path $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  [System.IO.File]::WriteAllText($Path, $Content, $Utf8NoBom)
}

function Escape-Html([string]$Text) {
  if ($null -eq $Text) { return '' }
  return [System.Net.WebUtility]::HtmlEncode($Text)
}

function Get-ShortHash([string]$Text) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = $Utf8NoBom.GetBytes($Text)
    $hashBytes = $sha.ComputeHash($bytes)
    $hex = -join ($hashBytes | ForEach-Object { $_.ToString('x2') })
    return $hex.Substring(0, 8)
  } finally {
    $sha.Dispose()
  }
}

function Expand-Includes([string]$Template, [string]$PartialsDir) {
  $pattern = '\{\{include:([^\}]+)\}\}'
  return [regex]::Replace($Template, $pattern, {
    param($m)
    $partialName = $m.Groups[1].Value.Trim()
    $partialPath = Join-Path $PartialsDir $partialName
    if (-not (Test-Path $partialPath)) {
      throw "Missing HTML partial: $partialPath"
    }
    return Read-Utf8 $partialPath
  })
}

function Apply-Tokens([string]$Template, [hashtable]$Tokens) {
  $result = $Template
  foreach ($k in $Tokens.Keys) {
    $val = if ($null -eq $Tokens[$k]) { '' } else { [string]$Tokens[$k] }
    $result = $result.Replace("{{$k}}", $val)
  }
  return $result
}

# 1. Clean dist/
if (Test-Path $DistDir) {
  Remove-Item -Path $DistDir -Recurse -Force
}
New-Item -ItemType Directory -Path (Join-Path $DistDir 'assets') -Force | Out-Null

# 2. Load catalog data
$dataPath = Join-Path $SrcDir 'data\games.json'
$catalog = (Read-Utf8 $dataPath) | ConvertFrom-Json
$site = $catalog.site
$games = @($catalog.games)
$lifeItems = if ($catalog.PSObject.Properties['life'] -and $catalog.life) { @($catalog.life) } else { @() }

# 3. Bundle CSS
$cssFiles = @('tokens.css', 'base.css', 'components.css')
$cssParts = foreach ($f in $cssFiles) {
  $p = Join-Path $SrcDir "styles\$f"
  "/* === $f === */`n" + (Read-Utf8 $p)
}
$cssBundle = ($cssParts -join "`n`n") + "`n"
$cssHash = Get-ShortHash $cssBundle
Write-Utf8 (Join-Path $DistDir 'assets\portal.css') $cssBundle

# 4. Bundle JS
$jsFiles = @('portal.js')
$jsParts = foreach ($f in $jsFiles) {
  $p = Join-Path $SrcDir "scripts\$f"
  "/* === $f === */`n" + (Read-Utf8 $p)
}
$jsBundle = ($jsParts -join "`n`n") + "`n"
$jsHash = Get-ShortHash $jsBundle
Write-Utf8 (Join-Path $DistDir 'assets\portal.js') $jsBundle

# 5. Copy playable game & life app bundles into dist/games/<slug>/ and dist/life/<slug>/
$copiedGameFiles = 0
function Copy-Bundle($entry, [string]$CategoryDir) {
  if (-not ($entry.PSObject.Properties['bundle'] -and $entry.bundle)) { return 0 }
  $count = 0
  $sourceRoot = (Resolve-Path (Join-Path $SiteDir $entry.bundle.sourceDir)).Path
  $targetDir = Join-Path $DistDir ($CategoryDir + '\' + $entry.slug)
  New-Item -ItemType Directory -Path $targetDir -Force | Out-Null

  $hasExplicitFiles = ($entry.bundle.PSObject.Properties['files'] -and $entry.bundle.files -and $entry.bundle.files.Count -gt 0)
  if ($hasExplicitFiles) {
    foreach ($file in $entry.bundle.files) {
      $srcFile = Join-Path $sourceRoot $file
      if (-not (Test-Path $srcFile)) {
        throw "Missing bundle file: $srcFile"
      }
      $destFile = Join-Path $targetDir $file
      $destParent = Split-Path -Parent $destFile
      if (-not (Test-Path $destParent)) { New-Item -ItemType Directory -Path $destParent -Force | Out-Null }
      Copy-Item -Path $srcFile -Destination $destFile -Force
      $count++
    }
  } else {
    $allFiles = Get-ChildItem -Path $sourceRoot -Recurse -File
    foreach ($f in $allFiles) {
      $rel = $f.FullName.Substring($sourceRoot.Length).TrimStart('\', '/')
      $destFile = Join-Path $targetDir $rel
      $destParent = Split-Path -Parent $destFile
      if (-not (Test-Path $destParent)) { New-Item -ItemType Directory -Path $destParent -Force | Out-Null }
      Copy-Item -Path $f.FullName -Destination $destFile -Force
      $count++
    }
  }
  return $count
}

foreach ($game in $games) {
  $copiedGameFiles += Copy-Bundle $game 'games'
}
$copiedLifeFiles = 0
foreach ($item in $lifeItems) {
  $copiedLifeFiles += Copy-Bundle $item 'life'
}

# 6. Build Game Center Cards (all inline on single page)
function Build-TagsHtml($tagLabels) {
  $sb = New-Object System.Text.StringBuilder
  foreach ($t in $tagLabels) {
    [void]$sb.AppendLine('<span class="tag-chip"><span data-lang="ja">' + (Escape-Html $t.ja) + '</span><span data-lang="en">' + (Escape-Html $t.en) + '</span></span>')
  }
  return $sb.ToString()
}

function Build-GameCenterCardsHtml($allGames) {
  $sb = New-Object System.Text.StringBuilder
  foreach ($g in $allGames) {
    $isPlayable = ($g.status -eq 'playable')
    $cardClass = if ($isPlayable) { 'game-card' } else { 'game-card is-coming-soon' }
    $statusClass = if ($isPlayable) { 'status-badge is-live' } else { 'status-badge is-soon' }
    $tagsAttr = ($g.tags -join ',')
    $accent = Escape-Html $g.accent
    $accentAlt = Escape-Html $g.accentAlt
    $fullTitle = Escape-Html ($g.titleJa + ' — ' + $g.titleEn)

    [void]$sb.AppendLine("<article class=`"$cardClass`" data-status=`"$(Escape-Html $g.status)`" data-tags=`"$(Escape-Html $tagsAttr)`" style=`"--card-accent: $accent; --card-accent-alt: $accentAlt;`">")
    [void]$sb.AppendLine('  <div class="game-card-body">')
    [void]$sb.AppendLine('    <div class="game-card-info">')
    [void]$sb.AppendLine('      <div class="card-top">')
    [void]$sb.AppendLine("        <span class=`"$statusClass`">" + ($(if ($isPlayable) { '<span class="pulse-dot" aria-hidden="true"></span>' } else { '' })) + '<span data-lang="ja">' + (Escape-Html $g.statusLabelJa) + '</span><span data-lang="en">' + (Escape-Html $g.statusLabelEn) + '</span></span>')
    [void]$sb.AppendLine('        <span class="card-subtitle mono">' + (Escape-Html $g.subtitleEn) + '</span>')
    [void]$sb.AppendLine('      </div>')
    [void]$sb.AppendLine('      <h3 class="card-title"><span data-lang="ja">' + (Escape-Html $g.titleJa) + '</span><span data-lang="en">' + (Escape-Html $g.titleEn) + '</span><span class="card-title-sub mono">' + (Escape-Html $g.titleEn) + '</span></h3>')
    [void]$sb.AppendLine('      <p class="card-pitch"><span data-lang="ja">' + (Escape-Html $g.pitchJa) + '</span><span data-lang="en">' + (Escape-Html $g.pitchEn) + '</span></p>')
    [void]$sb.AppendLine('      <div class="tag-row">' + (Build-TagsHtml $g.tagLabels) + '</div>')

    if ($g.metrics -and $g.metrics.Count -gt 0) {
      [void]$sb.AppendLine('      <dl class="metrics-strip">')
      foreach ($m in $g.metrics) {
        [void]$sb.AppendLine('        <div class="metric-item"><dt class="metric-label"><span data-lang="ja">' + (Escape-Html $m.labelJa) + '</span><span data-lang="en">' + (Escape-Html $m.labelEn) + '</span></dt><dd class="metric-val mono">' + (Escape-Html $m.value) + '</dd></div>')
      }
      [void]$sb.AppendLine('      </dl>')
    }

    if ($isPlayable -and $g.PSObject.Properties['storageKey'] -and $g.storageKey) {
      [void]$sb.AppendLine("      <div class=`"personal-best-bar`" data-storage-key=`"$(Escape-Html $g.storageKey)`">")
      [void]$sb.AppendLine('        <span class="pb-icon" aria-hidden="true">🏆</span>')
      [void]$sb.AppendLine('        <div class="pb-text">')
      [void]$sb.AppendLine('          <span class="pb-label mono"><span data-lang="ja">あなたの自己ベスト</span><span data-lang="en">YOUR PERSONAL BEST</span></span>')
      [void]$sb.AppendLine('          <span class="pb-value"><span data-lang="ja">まだ記録なし — プレイしてみよう！</span><span data-lang="en">No record yet — start playing!</span></span>')
      [void]$sb.AppendLine('        </div>')
      [void]$sb.AppendLine('      </div>')
    }

    [void]$sb.AppendLine('      <div class="card-actions">')
    if ($isPlayable) {
      [void]$sb.AppendLine("        <button type=`"button`" class=`"btn btn-primary`" data-launch-game=`"./$(Escape-Html $g.playUrl)`" data-game-title=`"$fullTitle`"><span aria-hidden=`"true`">▶</span><span data-lang=`"ja`">この場でプレイ</span><span data-lang=`"en`">Play Here</span></button>")
      [void]$sb.AppendLine("        <a class=`"btn btn-secondary`" href=`"./$(Escape-Html $g.playUrl)`"><span data-lang=`"ja`">ゲームページを開く</span><span data-lang=`"en`">Open Game Page</span><span aria-hidden=`"true`">↗</span></a>")
    } else {
      [void]$sb.AppendLine('        <span class="btn btn-disabled" aria-disabled="true"><span data-lang="ja">準備中（games.json に追加可能）</span><span data-lang="en">Coming Soon (add via games.json)</span></span>')
    }
    [void]$sb.AppendLine('      </div>')
    [void]$sb.AppendLine('    </div>')
    [void]$sb.AppendLine('  </div>')

    # Inline pure-HTML <details> for rules & 12 ranks (keeps everything on 1 page)
    $hasMechanics = ($g.PSObject.Properties['mechanics'] -and $g.mechanics -and $g.mechanics.Count -gt 0)
    $hasRanks = ($g.PSObject.Properties['ranks'] -and $g.ranks -and $g.ranks.Count -gt 0)
    if ($hasMechanics -or $hasRanks) {
      $summaryJa = if ($hasRanks) { 'ルール・12段階ランク一覧を見る' } else { 'あそびかた・とくちょうを見る' }
      $summaryEn = if ($hasRanks) { 'Show Rules &amp; 12-Rank Ladder' } else { 'Show How to Play &amp; Features' }
      [void]$sb.AppendLine('  <details class="game-details">')
      [void]$sb.AppendLine("    <summary class=`"game-details-summary`"><span data-lang=`"ja`">$summaryJa</span><span data-lang=`"en`">$summaryEn</span></summary>")
      [void]$sb.AppendLine('    <div class="game-details-body">')

      if ($hasMechanics) {
        [void]$sb.AppendLine('      <div class="mechanics-grid">')
        foreach ($m in $g.mechanics) {
          [void]$sb.AppendLine('        <div class="mechanic-card">')
          [void]$sb.AppendLine('          <div class="mechanic-icon" aria-hidden="true">' + $m.icon + '</div>')
          [void]$sb.AppendLine('          <div>')
          [void]$sb.AppendLine('            <h4 class="mechanic-title"><span data-lang="ja">' + (Escape-Html $m.titleJa) + '</span><span data-lang="en">' + (Escape-Html $m.titleEn) + '</span></h4>')
          [void]$sb.AppendLine('            <p class="mechanic-desc"><span data-lang="ja">' + (Escape-Html $m.descJa) + '</span><span data-lang="en">' + (Escape-Html $m.descEn) + '</span></p>')
          [void]$sb.AppendLine('          </div>')
          [void]$sb.AppendLine('        </div>')
        }
        [void]$sb.AppendLine('      </div>')
      }

      if ($hasRanks) {
        $storageAttr = Escape-Html $g.storageKey
        [void]$sb.AppendLine('      <div>')
        [void]$sb.AppendLine('        <div class="details-subhead mono">EVALUATION RANKS (12 TIERS)</div>')
        [void]$sb.AppendLine("        <div class=`"rank-strip`" data-rank-strip=`"$storageAttr`">")
        foreach ($r in $g.ranks) {
          $pts = ([int]$r.minScore).ToString('N0', [System.Globalization.CultureInfo]::InvariantCulture)
          [void]$sb.AppendLine("          <div class=`"rank-pill-card`" data-rank-min=`"$($r.minScore)`" style=`"--rank-color: $(Escape-Html $r.color);`">")
          [void]$sb.AppendLine('            <span class="rank-emoji" aria-hidden="true">' + $r.emoji + '</span>')
          [void]$sb.AppendLine('            <span class="rank-name">' + (Escape-Html $r.name) + '</span>')
          [void]$sb.AppendLine("            <span class=`"rank-score mono`">$pts pt+</span>")
          [void]$sb.AppendLine('          </div>')
        }
        [void]$sb.AppendLine('        </div>')
        [void]$sb.AppendLine('      </div>')
      }

      [void]$sb.AppendLine('    </div>')
      [void]$sb.AppendLine('  </details>')
    }

    [void]$sb.AppendLine('</article>')
  }
  return $sb.ToString()
}

function Build-LifeCardsHtml($items) {
  $sb = New-Object System.Text.StringBuilder
  foreach ($it in $items) {
    $accent = Escape-Html $it.accent
    $accentAlt = Escape-Html $it.accentAlt
    $url = Escape-Html $it.appUrl
    [void]$sb.AppendLine("<article class=`"game-card`" style=`"--card-accent: $accent; --card-accent-alt: $accentAlt;`">")
    [void]$sb.AppendLine('  <div class="game-card-body">')
    [void]$sb.AppendLine('    <div class="game-card-info">')
    [void]$sb.AppendLine('      <div class="card-top">')
    [void]$sb.AppendLine('        <span class="status-badge is-live"><span class="pulse-dot" aria-hidden="true"></span><span data-lang="ja">' + (Escape-Html $it.statusLabelJa) + '</span><span data-lang="en">' + (Escape-Html $it.statusLabelEn) + '</span></span>')
    [void]$sb.AppendLine('        <span class="card-subtitle mono">' + (Escape-Html $it.subtitleEn) + '</span>')
    [void]$sb.AppendLine('      </div>')
    [void]$sb.AppendLine('      <h3 class="card-title"><span data-lang="ja">' + (Escape-Html $it.titleJa) + '</span><span data-lang="en">' + (Escape-Html $it.titleEn) + '</span><span class="card-title-sub mono">' + (Escape-Html $it.titleEn) + '</span></h3>')
    [void]$sb.AppendLine('      <p class="card-pitch"><span data-lang="ja">' + (Escape-Html $it.pitchJa) + '</span><span data-lang="en">' + (Escape-Html $it.pitchEn) + '</span></p>')
    [void]$sb.AppendLine('      <div class="tag-row">' + (Build-TagsHtml $it.tagLabels) + '</div>')
    if ($it.metrics -and $it.metrics.Count -gt 0) {
      [void]$sb.AppendLine('      <dl class="metrics-strip">')
      foreach ($m in $it.metrics) {
        [void]$sb.AppendLine('        <div class="metric-item"><dt class="metric-label"><span data-lang="ja">' + (Escape-Html $m.labelJa) + '</span><span data-lang="en">' + (Escape-Html $m.labelEn) + '</span></dt><dd class="metric-val mono">' + (Escape-Html $m.value) + '</dd></div>')
      }
      [void]$sb.AppendLine('      </dl>')
    }
    [void]$sb.AppendLine('      <div class="card-actions">')
    [void]$sb.AppendLine("        <a class=`"btn btn-primary`" href=`"./$url`"><span data-lang=`"ja`">よていひょう を ひらく</span><span data-lang=`"en`">Open Schedule</span><span aria-hidden=`"true`">→</span></a>")
    [void]$sb.AppendLine('      </div>')
    [void]$sb.AppendLine('    </div>')
    [void]$sb.AppendLine('  </div>')
    [void]$sb.AppendLine('</article>')
  }
  return $sb.ToString()
}

# 7. Render Single Page (dist/index.html)
$partialsDir = Join-Path $SrcDir 'partials'
$buildDate = (Get-Date).ToString('yyyy-MM-dd')
$playableCount = @($games | Where-Object { $_.status -eq 'playable' }).Count

$indexRaw = Expand-Includes (Read-Utf8 (Join-Path $SrcDir 'pages\index.html')) $partialsDir
$indexHtml = Apply-Tokens $indexRaw @{
  root                = './'
  pageTitle           = Escape-Html "$($site.brand) — Game Center"
  pageDescription     = Escape-Html $site.heroLeadJa
  cssHash             = $cssHash
  jsHash              = $jsHash
  brand               = Escape-Html $site.brand
  brandMark           = Escape-Html $site.brandMark
  brandSub            = Escape-Html $site.brandSub
  heroTitle           = Escape-Html $site.heroTitle
  heroLeadJa          = Escape-Html $site.heroLeadJa
  heroLeadEn          = Escape-Html $site.heroLeadEn
  author              = Escape-Html $site.author
  year                = Escape-Html $site.year
  buildDate           = $buildDate
  totalGamesCount     = $games.Count
  playableGamesCount  = $playableCount
  gameCenterCardsHtml = Build-GameCenterCardsHtml $games
  lifeCardsHtml       = Build-LifeCardsHtml $lifeItems
}
Write-Utf8 (Join-Path $DistDir 'index.html') $indexHtml

# 8. Render 404 Page
$notFoundRaw = Expand-Includes (Read-Utf8 (Join-Path $SrcDir 'pages\404.html')) $partialsDir
$notFoundHtml = Apply-Tokens $notFoundRaw @{
  root            = './'
  pageTitle       = Escape-Html "404 Not Found — $($site.brand)"
  pageDescription = Escape-Html $site.heroLeadJa
  cssHash         = $cssHash
  jsHash          = $jsHash
  brand           = Escape-Html $site.brand
  brandMark       = Escape-Html $site.brandMark
  brandSub        = Escape-Html $site.brandSub
  heroLeadJa      = Escape-Html $site.heroLeadJa
  heroLeadEn      = Escape-Html $site.heroLeadEn
  author          = Escape-Html $site.author
  year            = Escape-Html $site.year
  buildDate       = $buildDate
}
Write-Utf8 (Join-Path $DistDir '404.html') $notFoundHtml

# 9. Emit Public Catalog JSON Manifest & GitHub Pages .nojekyll
Write-Utf8 (Join-Path $DistDir 'games.json') (Read-Utf8 $dataPath)
Write-Utf8 (Join-Path $DistDir '.nojekyll') ''

$sw.Stop()
if (-not $Quiet) {
  $cssKb = [Math]::Round($Utf8NoBom.GetByteCount($cssBundle) / 1024, 1)
  $jsKb  = [Math]::Round($Utf8NoBom.GetByteCount($jsBundle) / 1024, 1)
  Write-Host "Build completed in $($sw.ElapsedMilliseconds) ms -> $DistDir"
  Write-Host "  Pages:   index.html (single page), 404.html"
  Write-Host "  Assets:  portal.css ($cssKb KB, #$cssHash), portal.js ($jsKb KB, #$jsHash)"
  Write-Host "  Games:   $copiedGameFiles playable game file(s) synced into dist/games/"
  Write-Host "  Life:    $copiedLifeFiles life tool file(s) synced into dist/life/"
}
