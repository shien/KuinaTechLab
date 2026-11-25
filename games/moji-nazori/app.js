(function (global) {
  'use strict';

  const { SERIES, pickQuestion, WarmSound } = global.MojiNazori;
  const sound = new WarmSound();

  const STORAGE_DONE_KEY = 'moji_nazori_done_v1';
  const STORAGE_PREFS_KEY = 'moji_nazori_prefs_v1';

  const PRAISE_MESSAGES = [
    'はなまる！ すごーい！',
    'とっても じょうず！',
    'ばっちり かけたね！',
    'ぴかぴか の もじだね！',
    'やったね！ だいせいこう！'
  ];

  // DOM References
  const dom = {
    doneCount: document.getElementById('doneCount'),
    btnSpeak: document.getElementById('btnSpeak'),
    btnSound: document.getElementById('btnSound'),
    btnSettings: document.getElementById('btnSettings'),

    seriesFromBadge: document.getElementById('seriesFromBadge'),
    scriptBadge: document.getElementById('scriptBadge'),
    pencilOnlyBadge: document.getElementById('pencilOnlyBadge'),
    charNameRow: document.getElementById('charNameRow'),
    targetCharInline: document.getElementById('targetCharInline'),

    paperFrame: document.getElementById('paperFrame'),
    guideCanvas: document.getElementById('guideCanvas'),
    drawCanvas: document.getElementById('drawCanvas'),
    softToast: document.getElementById('softToast'),

    hanamaruOverlay: document.getElementById('hanamaruOverlay'),
    praiseText: document.getElementById('praiseText'),
    btnOverlayRetry: document.getElementById('btnOverlayRetry'),
    btnOverlayNext: document.getElementById('btnOverlayNext'),

    btnClear: document.getElementById('btnClear'),
    btnCheck: document.getElementById('btnCheck'),
    btnNext: document.getElementById('btnNext'),

    settingsModal: document.getElementById('settingsModal'),
    btnCloseSettings: document.getElementById('btnCloseSettings'),
    btnApplySettings: document.getElementById('btnApplySettings'),
    seriesChips: document.getElementById('seriesChips'),
    chkPencilOnly: document.getElementById('chkPencilOnly')
  };

  const guideCtx = dom.guideCanvas.getContext('2d');
  const drawCtx = dom.drawCanvas.getContext('2d');

  // Offscreen sampling canvas for gentle tracing progress check
  const sampleCanvas = document.createElement('canvas');
  const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
  const SAMPLE_SIZE = 160;
  sampleCanvas.width = SAMPLE_SIZE;
  sampleCanvas.height = SAMPLE_SIZE;

  const state = {
    doneCount: 0,
    scriptMode: 'random', // 'random' | 'hiragana' | 'katakana'
    seriesFilter: 'all',
    guideAlpha: 0.30,
    pencilOnly: false,
    penColor: '#4a2e1b',

    question: null,
    cssSize: 420,
    dpr: Math.min(window.devicePixelRatio || 1, 2),

    // Pointer drawing state (supports Finger, Apple Pencil with pressure, Mouse)
    isDrawing: false,
    activePointerId: null,
    strokes: [], // array of stroke point lists: [{x, y, w}, ...]
    currentStroke: null,

    // Target character sampled guide points (in normalized 0..1 coordinates)
    guidePoints: [],
    coveredFlags: [],
    coverageRatio: 0,
    celebratedForCurrent: false,
    toastTimer: null
  };

  function loadPersistence() {
    try {
      const done = Number(localStorage.getItem(STORAGE_DONE_KEY)) || 0;
      state.doneCount = Math.max(0, done);
      const rawPrefs = localStorage.getItem(STORAGE_PREFS_KEY);
      if (rawPrefs) {
        const p = JSON.parse(rawPrefs);
        if (p.scriptMode === 'random' || p.scriptMode === 'hiragana' || p.scriptMode === 'katakana') {
          state.scriptMode = p.scriptMode;
        }
        if (typeof p.seriesFilter === 'string') {
          state.seriesFilter = p.seriesFilter;
        }
        if (typeof p.guideAlpha === 'number' && p.guideAlpha >= 0.1 && p.guideAlpha <= 0.6) {
          state.guideAlpha = p.guideAlpha;
        }
        if (typeof p.pencilOnly === 'boolean') {
          state.pencilOnly = p.pencilOnly;
        }
      }
    } catch (_) {}
  }

  function saveDoneCount() {
    try {
      localStorage.setItem(STORAGE_DONE_KEY, String(state.doneCount));
    } catch (_) {}
  }

  function savePrefs() {
    try {
      localStorage.setItem(
        STORAGE_PREFS_KEY,
        JSON.stringify({
          scriptMode: state.scriptMode,
          seriesFilter: state.seriesFilter,
          guideAlpha: state.guideAlpha,
          pencilOnly: state.pencilOnly
        })
      );
    } catch (_) {}
  }

  function updateHeaderUI() {
    dom.doneCount.textContent = String(state.doneCount);
    dom.btnSound.textContent = sound.muted ? '🔇' : '🔊';
    dom.pencilOnlyBadge.classList.toggle('hidden', !state.pencilOnly);
    if (!('speechSynthesis' in window)) {
      dom.btnSpeak.classList.add('hidden');
    }
  }

  function showSoftToast(text, durationMs) {
    dom.softToast.textContent = text;
    dom.softToast.classList.remove('hidden');
    if (state.toastTimer) clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () {
      dom.softToast.classList.add('hidden');
    }, durationMs || 2200);
  }

  function speakCurrentName() {
    if (!state.question || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(
        state.question.displayName + ' の、' + state.question.targetChar
      );
      utt.lang = 'ja-JP';
      utt.rate = 0.88;
      utt.pitch = 1.1;
      window.speechSynthesis.speak(utt);
    } catch (_) {}
  }

  // Build huge textbook-style character font string
  function getTraceFont(pxSize) {
    return (
      '600 ' +
      Math.round(pxSize) +
      'px "Klee One", "UD Digi Kyokasho N-R", "YuKyokasho", "Hiragino Maru Gothic ProN", serif'
    );
  }

  // Sample target character pixels on offscreen canvas so we know where the strokes lie
  function buildGuideSamples(char) {
    sampleCtx.clearRect(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    sampleCtx.fillStyle = '#000000';
    sampleCtx.textAlign = 'center';
    sampleCtx.textBaseline = 'middle';
    sampleCtx.font = getTraceFont(SAMPLE_SIZE * 0.78);
    sampleCtx.fillText(char, SAMPLE_SIZE * 0.5, SAMPLE_SIZE * 0.52);

    const img = sampleCtx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
    const pts = [];
    const STEP = 4; // downsample grid for fast hit checks

    for (let y = STEP; y < SAMPLE_SIZE; y += STEP) {
      for (let x = STEP; x < SAMPLE_SIZE; x += STEP) {
        const alpha = img[(y * SAMPLE_SIZE + x) * 4 + 3];
        if (alpha > 80) {
          pts.push({ nx: x / SAMPLE_SIZE, ny: y / SAMPLE_SIZE });
        }
      }
    }

    state.guidePoints = pts;
    state.coveredFlags = new Array(pts.length).fill(false);
    state.coverageRatio = 0;
  }

  function markCoverageAt(normX, normY) {
    if (!state.guidePoints.length) return;
    // Generous kid-friendly hit radius (~8.5% of box size)
    const radiusSq = 0.085 * 0.085;
    let covered = 0;

    for (let i = 0; i < state.guidePoints.length; i++) {
      if (state.coveredFlags[i]) {
        covered++;
        continue;
      }
      const dx = state.guidePoints[i].nx - normX;
      const dy = state.guidePoints[i].ny - normY;
      if (dx * dx + dy * dy <= radiusSq) {
        state.coveredFlags[i] = true;
        covered++;
      }
    }

    state.coverageRatio = covered / state.guidePoints.length;
    dom.btnCheck.classList.toggle('is-ready', state.coverageRatio >= 0.58 && !state.celebratedForCurrent);
  }

  // Render notebook cross-guides + oversized model character
  function renderGuideCanvas() {
    const size = state.cssSize;
    const dpr = state.dpr;
    guideCtx.save();
    guideCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    guideCtx.clearRect(0, 0, size, size);

    // Subtle warm paper inner border
    const pad = Math.max(12, size * 0.04);
    guideCtx.strokeStyle = 'rgba(232, 165, 112, 0.35)';
    guideCtx.lineWidth = 2;
    guideCtx.strokeRect(pad, pad, size - pad * 2, size - pad * 2);

    // Kokugo notebook dashed center cross lines
    guideCtx.save();
    guideCtx.strokeStyle = 'rgba(224, 152, 96, 0.42)';
    guideCtx.lineWidth = 2;
    guideCtx.setLineDash([8, 8]);
    guideCtx.beginPath();
    guideCtx.moveTo(size * 0.5, pad);
    guideCtx.lineTo(size * 0.5, size - pad);
    guideCtx.moveTo(pad, size * 0.5);
    guideCtx.lineTo(size - pad, size * 0.5);
    guideCtx.stroke();
    guideCtx.restore();

    // Very large, crisp traceable model character (~78% of the square!)
    if (state.question) {
      guideCtx.save();
      guideCtx.textAlign = 'center';
      guideCtx.textBaseline = 'middle';
      guideCtx.font = getTraceFont(size * 0.78);
      guideCtx.fillStyle = 'rgba(130, 88, 56, ' + state.guideAlpha + ')';
      guideCtx.fillText(state.question.targetChar, size * 0.5, size * 0.52);

      // Faint soft outline to make stroke edges extra clear for young children
      guideCtx.lineWidth = Math.max(1.5, size * 0.004);
      guideCtx.strokeStyle = 'rgba(194, 120, 68, ' + Math.min(0.45, state.guideAlpha + 0.12) + ')';
      guideCtx.strokeText(state.question.targetChar, size * 0.5, size * 0.52);
      guideCtx.restore();
    }

    guideCtx.restore();
  }

  // Re-render all child strokes cleanly (preserves drawings across resizes)
  function renderDrawCanvas() {
    const size = state.cssSize;
    const dpr = state.dpr;
    drawCtx.save();
    drawCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawCtx.clearRect(0, 0, size, size);

    for (let s = 0; s < state.strokes.length; s++) {
      const stroke = state.strokes[s];
      drawSingleStroke(stroke, size);
    }

    drawCtx.restore();
  }

  function drawSingleStroke(stroke, size) {
    const pts = stroke.points;
    if (!pts || pts.length === 0) return;

    drawCtx.lineCap = 'round';
    drawCtx.lineJoin = 'round';
    drawCtx.strokeStyle = stroke.color;
    drawCtx.fillStyle = stroke.color;

    if (pts.length === 1) {
      const p0 = pts[0];
      drawCtx.beginPath();
      drawCtx.arc(p0.nx * size, p0.ny * size, (p0.nw * size) * 0.5, 0, Math.PI * 2);
      drawCtx.fill();
      return;
    }

    // Smooth quadratic midpoint segments with pressure-aware stroke width
    for (let i = 1; i < pts.length; i++) {
      const pPrev = pts[i - 1];
      const pCurr = pts[i];
      const midX = ((pPrev.nx + pCurr.nx) * 0.5) * size;
      const midY = ((pPrev.ny + pCurr.ny) * 0.5) * size;

      drawCtx.lineWidth = Math.max(6, pCurr.nw * size);
      drawCtx.beginPath();
      if (i === 1) {
        drawCtx.moveTo(pPrev.nx * size, pPrev.ny * size);
        drawCtx.lineTo(midX, midY);
      } else {
        const pPrev2 = pts[i - 2];
        const prevMidX = ((pPrev2.nx + pPrev.nx) * 0.5) * size;
        const prevMidY = ((pPrev2.ny + pPrev.ny) * 0.5) * size;
        drawCtx.moveTo(prevMidX, prevMidY);
        drawCtx.quadraticCurveTo(pPrev.nx * size, pPrev.ny * size, midX, midY);
      }
      drawCtx.stroke();
    }

    // Final tip
    const last = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    drawCtx.lineWidth = Math.max(6, last.nw * size);
    drawCtx.beginPath();
    drawCtx.moveTo(((prev.nx + last.nx) * 0.5) * size, ((prev.ny + last.ny) * 0.5) * size);
    drawCtx.lineTo(last.nx * size, last.ny * size);
    drawCtx.stroke();
  }

  function resizeCanvases() {
    const rect = dom.paperFrame.getBoundingClientRect();
    const size = Math.max(220, Math.floor(Math.min(rect.width, rect.height)));
    state.cssSize = size;
    state.dpr = Math.min(window.devicePixelRatio || 1, 2);

    [dom.guideCanvas, dom.drawCanvas].forEach(function (c) {
      c.width = Math.round(size * state.dpr);
      c.height = Math.round(size * state.dpr);
    });

    renderGuideCanvas();
    renderDrawCanvas();
  }

  function clearDrawing(playSound) {
    state.strokes = [];
    state.currentStroke = null;
    state.isDrawing = false;
    state.activePointerId = null;
    state.celebratedForCurrent = false;
    state.coveredFlags = new Array(state.guidePoints.length).fill(false);
    state.coverageRatio = 0;
    dom.btnCheck.classList.remove('is-ready');
    dom.hanamaruOverlay.classList.add('hidden');
    renderDrawCanvas();
    if (playSound) sound.playErase();
  }

  function loadNewQuestion(playSound) {
    const q = pickQuestion({
      scriptMode: state.scriptMode,
      seriesFilter: state.seriesFilter,
      lastKey: state.question ? state.question.key : ''
    });
    state.question = q;

    // Update series "（作品名）より" & script badge
    dom.seriesFromBadge.textContent = q.fromText;
    dom.scriptBadge.textContent = q.scriptLabel;
    dom.scriptBadge.classList.toggle('is-katakana', q.script === 'katakana');

    // Render character name tiles with the target letter highlighted
    dom.charNameRow.innerHTML = '';
    q.chars.forEach(function (ch, idx) {
      const span = document.createElement('span');
      span.className = idx === q.targetIndex ? 'name-char is-target' : 'name-char';
      span.textContent = ch;
      if (idx === q.targetIndex) {
        span.setAttribute('aria-label', ch + '（なぞる もじ）');
      }
      dom.charNameRow.appendChild(span);
    });

    dom.targetCharInline.textContent = q.targetChar;

    buildGuideSamples(q.targetChar);
    clearDrawing(false);
    renderGuideCanvas();

    if (playSound) sound.playNext();
  }

  function triggerHanamaru() {
    if (state.strokes.length === 0) {
      sound.playEncourage();
      showSoftToast('まずは ゆび や ぺん で なぞってみよう！');
      return;
    }

    // Gentle threshold for early elementary kids: even a decent attempt gets praised,
    // only ask for a little more if barely touched (< 32%).
    if (state.coverageRatio < 0.32) {
      sound.playEncourage();
      showSoftToast('もう少し おてほん の うえを なぞってみよう！');
      return;
    }

    if (!state.celebratedForCurrent) {
      state.celebratedForCurrent = true;
      state.doneCount += 1;
      saveDoneCount();
      updateHeaderUI();
    }

    dom.btnCheck.classList.remove('is-ready');
    dom.praiseText.textContent =
      PRAISE_MESSAGES[Math.floor(Math.random() * PRAISE_MESSAGES.length)];

    // Restart SVG hanamaru stroke animation cleanly
    dom.hanamaruOverlay.classList.add('hidden');
    void dom.hanamaruOverlay.offsetWidth;
    dom.hanamaruOverlay.classList.remove('hidden');

    sound.playHanamaru();
  }

  // Pointer helpers (Apple Pencil / Finger / Mouse)
  function getNormalizedPoint(e) {
    const rect = dom.drawCanvas.getBoundingClientRect();
    const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const ny = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    // Kid-friendly bold brush width (~4.8% of canvas); responsive to Apple Pencil pressure
    let baseWidth = 0.048;
    if (e.pointerType === 'pen' && typeof e.pressure === 'number' && e.pressure > 0) {
      const clamped = Math.max(0.25, Math.min(1, e.pressure));
      baseWidth = 0.032 + clamped * 0.032;
    }
    return { nx: nx, ny: ny, nw: baseWidth };
  }

  function isPointerAllowed(e) {
    if (state.pencilOnly && e.pointerType !== 'pen') {
      return false;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) {
      return false;
    }
    return true;
  }

  function onPointerDown(e) {
    if (!dom.hanamaruOverlay.classList.contains('hidden')) return;
    if (!isPointerAllowed(e)) {
      if (state.pencilOnly && e.pointerType === 'touch') {
        showSoftToast('いまは Apple Pencil だけ モードだよ', 1600);
      }
      return;
    }

    e.preventDefault();
    if (state.isDrawing) return;

    state.isDrawing = true;
    state.activePointerId = e.pointerId;
    try {
      dom.drawCanvas.setPointerCapture(e.pointerId);
    } catch (_) {}

    const pt = getNormalizedPoint(e);
    state.currentStroke = {
      color: state.penColor,
      points: [pt]
    };
    state.strokes.push(state.currentStroke);
    markCoverageAt(pt.nx, pt.ny);
    renderDrawCanvas();
  }

  function onPointerMove(e) {
    if (!state.isDrawing || e.pointerId !== state.activePointerId || !state.currentStroke) {
      return;
    }
    e.preventDefault();

    // Use high-frequency coalesced events for buttery Apple Pencil smoothness
    const events =
      typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
    const list = events && events.length > 0 ? events : [e];

    let added = false;
    for (let i = 0; i < list.length; i++) {
      const pt = getNormalizedPoint(list[i]);
      const pts = state.currentStroke.points;
      const last = pts[pts.length - 1];
      const dx = pt.nx - last.nx;
      const dy = pt.ny - last.ny;
      if (dx * dx + dy * dy >= 0.000018) {
        pts.push(pt);
        markCoverageAt(pt.nx, pt.ny);
        added = true;
      }
    }

    if (added) {
      renderDrawCanvas();
    }
  }

  function endStroke(e) {
    if (!state.isDrawing || e.pointerId !== state.activePointerId) return;
    state.isDrawing = false;
    state.activePointerId = null;
    state.currentStroke = null;
  }

  // Settings Modal Wiring
  function renderSeriesChips() {
    dom.seriesChips.innerHTML = '';

    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = 'setting-chip' + (state.seriesFilter === 'all' ? ' is-active' : '');
    allBtn.textContent = 'ぜんぶ（6さくひん）';
    allBtn.setAttribute('data-series', 'all');
    dom.seriesChips.appendChild(allBtn);

    SERIES.forEach(function (s) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'setting-chip' + (state.seriesFilter === s.id ? ' is-active' : '');
      btn.textContent = s.label;
      btn.setAttribute('data-series', s.id);
      dom.seriesChips.appendChild(btn);
    });
  }

  function syncSettingsUI() {
    document.querySelectorAll('[data-script-mode]').forEach(function (btn) {
      btn.classList.toggle(
        'is-active',
        btn.getAttribute('data-script-mode') === state.scriptMode
      );
    });

    document.querySelectorAll('[data-guide-alpha]').forEach(function (btn) {
      const val = Number(btn.getAttribute('data-guide-alpha'));
      btn.classList.toggle('is-active', Math.abs(val - state.guideAlpha) < 0.03);
    });

    dom.seriesChips.querySelectorAll('[data-series]').forEach(function (btn) {
      btn.classList.toggle(
        'is-active',
        btn.getAttribute('data-series') === state.seriesFilter
      );
    });

    dom.chkPencilOnly.checked = state.pencilOnly;
  }

  function openSettings() {
    syncSettingsUI();
    dom.settingsModal.classList.remove('hidden');
  }

  function closeSettings() {
    dom.settingsModal.classList.add('hidden');
  }

  function initEvents() {
    // Canvas pointer listeners
    dom.drawCanvas.addEventListener('pointerdown', onPointerDown, { passive: false });
    dom.drawCanvas.addEventListener('pointermove', onPointerMove, { passive: false });
    dom.drawCanvas.addEventListener('pointerup', endStroke);
    dom.drawCanvas.addEventListener('pointercancel', endStroke);

    // Prevent iOS Safari bounce / gesture zoom on canvas
    dom.drawCanvas.addEventListener(
      'touchstart',
      function (e) {
        e.preventDefault();
      },
      { passive: false }
    );

    // Crayon colors
    document.querySelectorAll('.crayon-dot').forEach(function (dot) {
      dot.addEventListener('click', function () {
        state.penColor = dot.getAttribute('data-color') || '#4a2e1b';
        document.querySelectorAll('.crayon-dot').forEach(function (d) {
          const active = d === dot;
          d.classList.toggle('is-active', active);
          d.setAttribute('aria-pressed', String(active));
        });
        sound.playPop();
      });
    });

    // Main action buttons
    dom.btnClear.addEventListener('click', function () {
      clearDrawing(true);
    });

    dom.btnCheck.addEventListener('click', triggerHanamaru);

    dom.btnNext.addEventListener('click', function () {
      loadNewQuestion(true);
    });

    dom.btnOverlayRetry.addEventListener('click', function () {
      clearDrawing(true);
    });

    dom.btnOverlayNext.addEventListener('click', function () {
      loadNewQuestion(true);
    });

    dom.btnSpeak.addEventListener('click', function () {
      speakCurrentName();
    });

    dom.btnSound.addEventListener('click', function () {
      sound.toggleMute();
      updateHeaderUI();
      if (!sound.muted) sound.playPop();
    });

    // Settings modal
    dom.btnSettings.addEventListener('click', openSettings);
    dom.btnCloseSettings.addEventListener('click', closeSettings);
    dom.btnApplySettings.addEventListener('click', closeSettings);
    dom.settingsModal.addEventListener('click', function (e) {
      if (e.target === dom.settingsModal) closeSettings();
    });

    document.querySelectorAll('[data-script-mode]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.scriptMode = btn.getAttribute('data-script-mode');
        savePrefs();
        syncSettingsUI();
        loadNewQuestion(true);
      });
    });

    document.querySelectorAll('[data-guide-alpha]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.guideAlpha = Number(btn.getAttribute('data-guide-alpha')) || 0.30;
        savePrefs();
        syncSettingsUI();
        renderGuideCanvas();
        sound.playPop();
      });
    });

    dom.seriesChips.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-series]');
      if (!btn) return;
      state.seriesFilter = btn.getAttribute('data-series');
      savePrefs();
      syncSettingsUI();
      loadNewQuestion(true);
    });

    dom.chkPencilOnly.addEventListener('change', function () {
      state.pencilOnly = dom.chkPencilOnly.checked;
      savePrefs();
      updateHeaderUI();
      sound.playPop();
    });

    window.addEventListener('resize', resizeCanvases);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !dom.settingsModal.classList.contains('hidden')) {
        closeSettings();
      }
    });
  }

  function bootstrap() {
    loadPersistence();
    renderSeriesChips();
    updateHeaderUI();
    initEvents();
    resizeCanvases();
    loadNewQuestion(false);

    // Re-render guide character once Google Font "Klee One" finishes loading
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        if (state.question) {
          buildGuideSamples(state.question.targetChar);
          renderGuideCanvas();
        }
      });
    }
  }

  window.addEventListener('DOMContentLoaded', bootstrap);
})(window);
