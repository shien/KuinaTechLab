import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const t0 = Date.now();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const siteDir = path.resolve(__dirname, '..');
const srcDir = path.join(siteDir, 'src');
const distDir = path.join(siteDir, 'dist');
const partialsDir = path.join(srcDir, 'partials');

const readUtf8 = (p) => fs.readFileSync(p, 'utf8');
const writeUtf8 = (p, content) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
};

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const shortHash = (text) =>
  crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 8);

const expandIncludes = (tpl) =>
  tpl.replace(/\{\{include:([^}]+)\}\}/g, (_, name) =>
    readUtf8(path.join(partialsDir, name.trim()))
  );

const applyTokens = (tpl, tokens) => {
  let out = tpl;
  for (const [k, v] of Object.entries(tokens)) {
    out = out.split(`{{${k}}}`).join(String(v ?? ''));
  }
  return out;
};

// 1. Clean dist/
fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(path.join(distDir, 'assets'), { recursive: true });

// 2. Load catalog
const dataPath = path.join(srcDir, 'data', 'games.json');
const rawData = readUtf8(dataPath);
const { site, games, life = [] } = JSON.parse(rawData);

// 3. Bundle CSS
const cssBundle =
  ['tokens.css', 'base.css', 'components.css']
    .map((f) => `/* === ${f} === */\n${readUtf8(path.join(srcDir, 'styles', f))}`)
    .join('\n\n') + '\n';
const cssHash = shortHash(cssBundle);
writeUtf8(path.join(distDir, 'assets', 'portal.css'), cssBundle);

// 4. Bundle JS
const jsBundle =
  ['portal.js']
    .map((f) => `/* === ${f} === */\n${readUtf8(path.join(srcDir, 'scripts', f))}`)
    .join('\n\n') + '\n';
const jsHash = shortHash(jsBundle);
writeUtf8(path.join(distDir, 'assets', 'portal.js'), jsBundle);

// 5. Sync playable game bundles (supports whole directory or explicit file list)
function copyRecursive(src, dest) {
  let count = 0;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      count += copyRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
      count++;
    }
  }
  return count;
}

function syncBundle(entry, category) {
  if (!entry.bundle) return 0;
  const sourceRoot = path.resolve(siteDir, entry.bundle.sourceDir);
  const targetDir = path.join(distDir, category, entry.slug);
  fs.mkdirSync(targetDir, { recursive: true });
  if (Array.isArray(entry.bundle.files) && entry.bundle.files.length > 0) {
    let count = 0;
    for (const f of entry.bundle.files) {
      const destFile = path.join(targetDir, f);
      fs.mkdirSync(path.dirname(destFile), { recursive: true });
      fs.copyFileSync(path.join(sourceRoot, f), destFile);
      count++;
    }
    return count;
  }
  return copyRecursive(sourceRoot, targetDir);
}

let copiedFiles = 0;
for (const g of games) {
  copiedFiles += syncBundle(g, 'games');
}
let copiedLifeFiles = 0;
for (const it of life) {
  copiedLifeFiles += syncBundle(it, 'life');
}

const buildTags = (tags = []) =>
  tags
    .map(
      (t) =>
        `<span class="tag-chip"><span data-lang="ja">${esc(t.ja)}</span><span data-lang="en">${esc(t.en)}</span></span>`
    )
    .join('\n');

const buildGameCenterCards = (allGames) =>
  allGames
    .map((g) => {
      const playable = g.status === 'playable';
      const cardClass = playable ? 'game-card' : 'game-card is-coming-soon';
      const statusClass = playable ? 'status-badge is-live' : 'status-badge is-soon';
      const dot = playable ? '<span class="pulse-dot" aria-hidden="true"></span>' : '';
      const fullTitle = esc(`${g.titleJa} — ${g.titleEn}`);

      const metricsHtml =
        g.metrics && g.metrics.length
          ? `<dl class="metrics-strip">${g.metrics
              .map(
                (m) =>
                  `<div class="metric-item"><dt class="metric-label"><span data-lang="ja">${esc(m.labelJa)}</span><span data-lang="en">${esc(m.labelEn)}</span></dt><dd class="metric-val mono">${esc(m.value)}</dd></div>`
              )
              .join('')}</dl>`
          : '';

      const pbHtml =
        playable && g.storageKey
          ? `<div class="personal-best-bar" data-storage-key="${esc(g.storageKey)}">
        <span class="pb-icon" aria-hidden="true">🏆</span>
        <div class="pb-text">
          <span class="pb-label mono"><span data-lang="ja">あなたの自己ベスト</span><span data-lang="en">YOUR PERSONAL BEST</span></span>
          <span class="pb-value"><span data-lang="ja">まだ記録なし — プレイしてみよう！</span><span data-lang="en">No record yet — start playing!</span></span>
        </div>
      </div>`
          : '';

      const actionsHtml = playable
        ? `<button type="button" class="btn btn-primary" data-launch-game="./${esc(g.playUrl)}" data-game-title="${fullTitle}"><span aria-hidden="true">▶</span><span data-lang="ja">この場でプレイ</span><span data-lang="en">Play Here</span></button>
        <a class="btn btn-secondary" href="./${esc(g.playUrl)}"><span data-lang="ja">ゲームページを開く</span><span data-lang="en">Open Game Page</span><span aria-hidden="true">↗</span></a>`
        : `<span class="btn btn-disabled" aria-disabled="true"><span data-lang="ja">準備中（games.json に追加可能）</span><span data-lang="en">Coming Soon (add via games.json)</span></span>`;

      const mechanicsHtml =
        g.mechanics && g.mechanics.length
          ? `<div class="mechanics-grid">${g.mechanics
              .map(
                (m) => `<div class="mechanic-card">
          <div class="mechanic-icon" aria-hidden="true">${m.icon}</div>
          <div>
            <h4 class="mechanic-title"><span data-lang="ja">${esc(m.titleJa)}</span><span data-lang="en">${esc(m.titleEn)}</span></h4>
            <p class="mechanic-desc"><span data-lang="ja">${esc(m.descJa)}</span><span data-lang="en">${esc(m.descEn)}</span></p>
          </div>
        </div>`
              )
              .join('')}</div>`
          : '';

      const ranksHtml =
        g.ranks && g.ranks.length
          ? `<div>
        <div class="details-subhead mono">EVALUATION RANKS (12 TIERS)</div>
        <div class="rank-strip" data-rank-strip="${esc(g.storageKey)}">${g.ranks
              .map(
                (r) => `<div class="rank-pill-card" data-rank-min="${r.minScore}" style="--rank-color: ${esc(r.color)};">
            <span class="rank-emoji" aria-hidden="true">${r.emoji}</span>
            <span class="rank-name">${esc(r.name)}</span>
            <span class="rank-score mono">${Number(r.minScore).toLocaleString('en-US')} pt+</span>
          </div>`
              )
              .join('')}</div>
      </div>`
          : '';

      const summaryJa = ranksHtml ? 'ルール・12段階ランク一覧を見る' : 'あそびかた・とくちょうを見る';
      const summaryEn = ranksHtml ? 'Show Rules &amp; 12-Rank Ladder' : 'Show How to Play &amp; Features';
      const detailsHtml =
        mechanicsHtml || ranksHtml
          ? `<details class="game-details">
    <summary class="game-details-summary"><span data-lang="ja">${summaryJa}</span><span data-lang="en">${summaryEn}</span></summary>
    <div class="game-details-body">${mechanicsHtml}${ranksHtml}</div>
  </details>`
          : '';

      return `<article class="${cardClass}" data-status="${esc(g.status)}" data-tags="${esc((g.tags || []).join(','))}" style="--card-accent: ${esc(g.accent)}; --card-accent-alt: ${esc(g.accentAlt)};">
  <div class="game-card-body">
    <div class="game-card-info">
      <div class="card-top">
        <span class="${statusClass}">${dot}<span data-lang="ja">${esc(g.statusLabelJa)}</span><span data-lang="en">${esc(g.statusLabelEn)}</span></span>
        <span class="card-subtitle mono">${esc(g.subtitleEn)}</span>
      </div>
      <h3 class="card-title"><span data-lang="ja">${esc(g.titleJa)}</span><span data-lang="en">${esc(g.titleEn)}</span><span class="card-title-sub mono">${esc(g.titleEn)}</span></h3>
      <p class="card-pitch"><span data-lang="ja">${esc(g.pitchJa)}</span><span data-lang="en">${esc(g.pitchEn)}</span></p>
      <div class="tag-row">${buildTags(g.tagLabels)}</div>
      ${metricsHtml}
      ${pbHtml}
      <div class="card-actions">${actionsHtml}</div>
    </div>
  </div>
  ${detailsHtml}
</article>`;
    })
    .join('\n');

const buildLifeCards = (items = []) =>
  items
    .map((it) => {
      const metricsHtml =
        it.metrics && it.metrics.length
          ? `<dl class="metrics-strip">${it.metrics
              .map(
                (m) =>
                  `<div class="metric-item"><dt class="metric-label"><span data-lang="ja">${esc(m.labelJa)}</span><span data-lang="en">${esc(m.labelEn)}</span></dt><dd class="metric-val mono">${esc(m.value)}</dd></div>`
              )
              .join('')}</dl>`
          : '';

      return `<article class="game-card" style="--card-accent: ${esc(it.accent)}; --card-accent-alt: ${esc(it.accentAlt)};">
  <div class="game-card-body">
    <div class="game-card-info">
      <div class="card-top">
        <span class="status-badge is-live"><span class="pulse-dot" aria-hidden="true"></span><span data-lang="ja">${esc(it.statusLabelJa)}</span><span data-lang="en">${esc(it.statusLabelEn)}</span></span>
        <span class="card-subtitle mono">${esc(it.subtitleEn)}</span>
      </div>
      <h3 class="card-title"><span data-lang="ja">${esc(it.titleJa)}</span><span data-lang="en">${esc(it.titleEn)}</span><span class="card-title-sub mono">${esc(it.titleEn)}</span></h3>
      <p class="card-pitch"><span data-lang="ja">${esc(it.pitchJa)}</span><span data-lang="en">${esc(it.pitchEn)}</span></p>
      <div class="tag-row">${buildTags(it.tagLabels)}</div>
      ${metricsHtml}
      <div class="card-actions">
        <a class="btn btn-primary" href="./${esc(it.appUrl)}"><span data-lang="ja">よていひょう を ひらく</span><span data-lang="en">Open Schedule</span><span aria-hidden="true">→</span></a>
      </div>
    </div>
  </div>
</article>`;
    })
    .join('\n');

const buildDate = new Date().toISOString().slice(0, 10);
const baseTokens = {
  cssHash,
  jsHash,
  brand: esc(site.brand),
  brandMark: esc(site.brandMark),
  brandSub: esc(site.brandSub),
  heroTitle: esc(site.heroTitle),
  heroLeadJa: esc(site.heroLeadJa),
  heroLeadEn: esc(site.heroLeadEn),
  author: esc(site.author),
  year: esc(site.year),
  buildDate
};

// 6. Single-page index.html
const indexTpl = expandIncludes(readUtf8(path.join(srcDir, 'pages', 'index.html')));
writeUtf8(
  path.join(distDir, 'index.html'),
  applyTokens(indexTpl, {
    ...baseTokens,
    root: './',
    pageTitle: esc(`${site.brand} — Game Center`),
    pageDescription: esc(site.heroLeadJa),
    totalGamesCount: games.length,
    playableGamesCount: games.filter((g) => g.status === 'playable').length,
    gameCenterCardsHtml: buildGameCenterCards(games),
    lifeCardsHtml: buildLifeCards(life)
  })
);

// 7. 404.html & games.json
const notFoundTpl = expandIncludes(readUtf8(path.join(srcDir, 'pages', '404.html')));
writeUtf8(
  path.join(distDir, '404.html'),
  applyTokens(notFoundTpl, {
    ...baseTokens,
    root: './',
    pageTitle: esc(`404 Not Found — ${site.brand}`),
    pageDescription: esc(site.heroLeadJa)
  })
);
writeUtf8(path.join(distDir, 'games.json'), rawData);
writeUtf8(path.join(distDir, '.nojekyll'), '');

console.log(
  `Build completed in ${Date.now() - t0} ms -> ${distDir} (single page, ${copiedFiles} game file(s), ${copiedLifeFiles} life file(s))`
);
