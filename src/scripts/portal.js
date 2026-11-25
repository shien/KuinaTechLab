(function () {
  'use strict';

  const LANG_STORAGE_KEY = 'portal_lang_v1';

  const MEIRO_RANKS = [
    { id: 'snail', minScore: 0, name: 'カタツムリ', en: 'SNAIL', emoji: '🐌' },
    { id: 'beetle', minScore: 160, name: 'カブトムシ', en: 'BEETLE', emoji: '🪲' },
    { id: 'mouse', minScore: 380, name: 'マウス', en: 'MOUSE', emoji: '🐁' },
    { id: 'rabbit', minScore: 700, name: 'ウサギ', en: 'RABBIT', emoji: '🐇' },
    { id: 'cheetah', minScore: 1150, name: 'チーター', en: 'CHEETAH', emoji: '🐆' },
    { id: 'falcon', minScore: 1700, name: 'ハヤブサ', en: 'FALCON', emoji: '🦅' },
    { id: 'ninja', minScore: 2400, name: 'ニンジャ', en: 'NINJA', emoji: '🥷' },
    { id: 'supercomputer', minScore: 3250, name: 'スーパーコンピュータ', en: 'SUPERCOMPUTER', emoji: '🖥️' },
    { id: 'ai', minScore: 4200, name: 'AI', en: 'AI', emoji: '🤖' },
    { id: 'quantum', minScore: 5400, name: '量子コンピュータ', en: 'QUANTUM', emoji: '⚛️' },
    { id: 'tachyon', minScore: 6900, name: 'タキオン', en: 'TACHYON', emoji: '⚡' },
    { id: 'light', minScore: 8800, name: '光', en: 'SPEED OF LIGHT', emoji: '✨' }
  ];

  function resolveRank(score) {
    let idx = 0;
    for (let i = 0; i < MEIRO_RANKS.length; i++) {
      if (score >= MEIRO_RANKS[i].minScore) idx = i;
    }
    return { index: idx, rank: MEIRO_RANKS[idx] };
  }

  function readBestRecord(storageKey) {
    if (!storageKey) return null;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      const data = JSON.parse(raw);
      const score = Number(data && data.score) || 0;
      const cleared = Number(data && data.cleared) || 0;
      if (score <= 0 && cleared <= 0) return null;
      return { score, cleared };
    } catch (_) {
      return null;
    }
  }

  function refreshPersonalBestUI() {
    const activeLang = document.documentElement.getAttribute('data-active-lang') || 'ja';

    const bars = document.querySelectorAll('[data-storage-key]');
    bars.forEach((bar) => {
      const key = bar.getAttribute('data-storage-key');
      const rec = readBestRecord(key);
      const emojiEl = bar.querySelector('.pb-icon');
      const valEl = bar.querySelector('.pb-value');
      if (!valEl) return;

      if (!rec) {
        bar.classList.remove('has-record');
        if (emojiEl) emojiEl.textContent = '🏆';
        valEl.innerHTML =
          '<span data-lang="ja">まだ記録なし — 最初の5秒に挑戦しよう！</span>' +
          '<span data-lang="en">No record yet — try your first 5-second run!</span>';
        return;
      }

      const info = resolveRank(rec.score);
      bar.classList.add('has-record');
      if (emojiEl) emojiEl.textContent = info.rank.emoji;

      const formatted = rec.score.toLocaleString('en-US');
      if (activeLang === 'en') {
        valEl.textContent =
          formatted + ' pt · ' + rec.cleared + ' cleared · Rank: ' + info.rank.en;
      } else {
        valEl.textContent =
          formatted + ' pt（' + rec.cleared + '問突破）— ランク: ' + info.rank.name;
      }
    });

    // Highlight achieved rank cards on home strip & detail grid
    const rankContainers = document.querySelectorAll('[data-rank-strip], [data-rank-grid]');
    rankContainers.forEach((container) => {
      const key =
        container.getAttribute('data-rank-strip') ||
        container.getAttribute('data-rank-grid');
      const rec = readBestRecord(key);
      const cards = container.querySelectorAll('[data-rank-min]');
      cards.forEach((card) => {
        const min = Number(card.getAttribute('data-rank-min')) || 0;
        const achieved = rec !== null && rec.score >= min;
        card.classList.toggle('is-achieved', achieved);
      });
    });
  }

  function initLanguageToggle() {
    const html = document.documentElement;
    const buttons = document.querySelectorAll('[data-set-lang]');
    if (!buttons.length) return;

    function applyLang(lang) {
      const next = lang === 'en' ? 'en' : 'ja';
      html.setAttribute('data-active-lang', next);
      html.setAttribute('lang', next);
      buttons.forEach((btn) => {
        const active = btn.getAttribute('data-set-lang') === next;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', String(active));
      });
      try {
        localStorage.setItem(LANG_STORAGE_KEY, next);
      } catch (_) {}
      refreshPersonalBestUI();
    }

    let saved = 'ja';
    try {
      const stored = localStorage.getItem(LANG_STORAGE_KEY);
      if (stored === 'en' || stored === 'ja') saved = stored;
    } catch (_) {}
    applyLang(saved);

    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        applyLang(btn.getAttribute('data-set-lang'));
      });
    });
  }

  function initCatalogFilters() {
    const pills = document.querySelectorAll('[data-filter]');
    const grid = document.getElementById('catalogGrid');
    const emptyEl = document.getElementById('catalogEmpty');
    if (!pills.length || !grid) return;

    const cards = Array.from(grid.querySelectorAll('.game-card'));

    pills.forEach((pill) => {
      pill.addEventListener('click', () => {
        const filter = pill.getAttribute('data-filter') || 'all';
        pills.forEach((p) => {
          const active = p === pill;
          p.classList.toggle('is-active', active);
          p.setAttribute('aria-pressed', String(active));
        });

        let visibleCount = 0;
        cards.forEach((card) => {
          const status = card.getAttribute('data-status') || '';
          const tags = (card.getAttribute('data-tags') || '').split(',').filter(Boolean);
          const match =
            filter === 'all' ||
            (filter === 'playable' && status === 'playable') ||
            tags.includes(filter);
          card.hidden = !match;
          if (match) visibleCount++;
        });

        if (emptyEl) emptyEl.hidden = visibleCount > 0;
      });
    });
  }

  function initArcadeModal() {
    const modal = document.getElementById('arcadeModal');
    const frame = document.getElementById('arcadeFrame');
    const titleEl = document.getElementById('arcadeModalTitle');
    const extLink = document.getElementById('arcadeExternalLink');
    const closeBtn = document.getElementById('arcadeCloseBtn');
    if (!modal || !frame) return;

    let lastTrigger = null;

    function openArcade(url, title, triggerEl) {
      lastTrigger = triggerEl || document.activeElement;
      if (titleEl && title) titleEl.textContent = title;
      if (extLink) extLink.setAttribute('href', url);
      frame.setAttribute('src', url);
      modal.hidden = false;
      document.body.style.overflow = 'hidden';
      if (closeBtn) closeBtn.focus();
    }

    function closeArcade() {
      if (modal.hidden) return;
      modal.hidden = true;
      frame.setAttribute('src', 'about:blank');
      document.body.style.overflow = '';
      refreshPersonalBestUI();
      if (lastTrigger && typeof lastTrigger.focus === 'function') {
        lastTrigger.focus();
      }
    }

    document.querySelectorAll('[data-launch-game]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const url = btn.getAttribute('data-launch-game');
        const title = btn.getAttribute('data-game-title') || 'ARCADE PLAYER';
        if (url) openArcade(url, title, btn);
      });
    });

    modal.querySelectorAll('[data-close-arcade]').forEach((el) => {
      el.addEventListener('click', closeArcade);
    });

    document.addEventListener('keydown', (e) => {
      if (modal.hidden) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closeArcade();
        return;
      }
      // Simple focus trap inside modal header controls
      if (e.key === 'Tab') {
        const focusables = modal.querySelectorAll('a[href], button:not([disabled]), iframe');
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });
  }

  window.addEventListener('DOMContentLoaded', () => {
    initLanguageToggle();
    initCatalogFilters();
    initArcadeModal();
    refreshPersonalBestUI();
  });

  window.addEventListener('storage', refreshPersonalBestUI);
})();
