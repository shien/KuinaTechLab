(function (global) {
  'use strict';

  const { SERIES, pickQuestion, getStrokeOrder, WarmSound } = global.MojiNazori;
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

  const CIRCLED_NUMS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];

  // DOM References
  const dom = {
    doneCount: document.getElementById('doneCount'),
    btnSpeak: document.getElementById('btnSpeak'),
    btnSound: document.getElementById('btnSound'),
    btnSettings: document.getElementById('btnSettings'),

    seriesFromBadge: document.getElementById('seriesFromBadge'),
    scriptBadge: document.getElementById('scriptBadge'),
    strokeCountBadge: document.getElementById('strokeCountBadge'),
    pencilOnlyBadge: document.getElementById('pencilOnlyBadge'),
    charNameRow: document.getElementById('charNameRow'),
    targetCharInline: document.getElementById('targetCharInline'),
    nextStrokeHint: document.getElementById('nextStrokeHint'),
    charImageSearchLink: document.getElementById('charImageSearchLink'),

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
    chkStrokeOrder: document.getElementById('chkStrokeOrder'),
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
    showStrokeOrder: true,
    pencilOnly: false,
    penColor: '#4a2e1b',

    question: null,
    strokeOrder: [], // array of strokes from stroke-order.js
    cssSize: 420,
    dpr: Math.min(window.devicePixelRatio || 1, 2),

    // Pointer drawing state
    isDrawing: false,
    activePointerId: null,
    strokes: [],
    currentStroke: null,

    // Target character sampled guide points
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
        if (typeof p.showStrokeOrder === 'boolean') {
          state.showStrokeOrder = p.showStrokeOrder;
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
          showStrokeOrder: state.showStrokeOrder,
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

  function updateStrokeHintText() {
    const total = state.strokeOrder.length;
    if (!dom.nextStrokeHint) return;
    if (!state.showStrokeOrder || total === 0) {
      dom.nextStrokeHint.textContent = 'ゆっくり';
      return;
    }
    const nextIdx = state.strokes.length;
    if (nextIdx < total) {
      const numLabel = CIRCLED_NUMS[nextIdx] || (nextIdx + 1) + 'かくめ';
      dom.nextStrokeHint.textContent = numLabel + ' から';
    } else {
      dom.nextStrokeHint.textContent = 'ぜんぶ かいたら できた！をおしてね —';
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

  function getTraceFont(pxSize) {
    return (
      '600 ' +
      Math.round(pxSize) +
      'px "Klee One", "UD Digi Kyokasho N-R", "YuKyokasho", "Hiragino Maru Gothic ProN", serif'
    );
  }

  function buildGuideSamples(char) {
    sampleCtx.clearRect(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    sampleCtx.fillStyle = '#000000';
    sampleCtx.textAlign = 'center';
    sampleCtx.textBaseline = 'middle';
    sampleCtx.font = getTraceFont(SAMPLE_SIZE * 0.78);
    sampleCtx.fillText(char, SAMPLE_SIZE * 0.5, SAMPLE_SIZE * 0.52);

    const img = sampleCtx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
    const pts = [];
    const STEP = 4;

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
    dom.btnCheck.classList.toggle('is-ready', state.coverageRatio >= 0.55 && !state.celebratedForCurrent);
  }

  // Draw stroke order numbers (1, 2, 3...) + subtle directional arrows
  function drawStrokeOrderOverlay(ctx, size) {
    if (!state.showStrokeOrder || !state.strokeOrder || state.strokeOrder.length === 0) return;

    const currentIdx = state.strokes.length;
    const baseRadius = Math.max(11, Math.min(18, size * 0.036));

    // Slight nudge when two stroke starts are very close so badges never collide
    const placed = [];

    for (let i = 0; i < state.strokeOrder.length; i++) {
      const pts = state.strokeOrder[i];
      if (!pts || pts.length < 2) continue;

      const isCurrent = i === currentIdx;
      const isDone = i < currentIdx;

      let sx = pts[0][0] * size;
      let sy = pts[0][1] * size;
      const nx = pts[1][0] * size;
      const ny = pts[1][1] * size;
      const angle = Math.atan2(ny - sy, nx - sx);

      // Avoid badge overlap with earlier stroke badges
      for (let p = 0; p < placed.length; p++) {
        const dx = sx - placed[p].x;
        const dy = sy - placed[p].y;
        const minGap = baseRadius * 2.15;
        if (dx * dx + dy * dy < minGap * minGap) {
          sx += Math.cos(angle + Math.PI * 0.5) * (baseRadius * 1.45);
          sy += Math.sin(angle + Math.PI * 0.5) * (baseRadius * 1.45);
        }
      }
      placed.push({ x: sx, y: sy });

      // Short direction arrow from start toward second point
      const arrowLen = Math.max(18, size * 0.068);
      const ax1 = pts[0][0] * size + Math.cos(angle) * (baseRadius * 0.9);
      const ay1 = pts[0][1] * size + Math.sin(angle) * (baseRadius * 0.9);
      const ax2 = pts[0][0] * size + Math.cos(angle) * (baseRadius * 0.9 + arrowLen);
      const ay2 = pts[0][1] * size + Math.sin(angle) * (baseRadius * 0.9 + arrowLen);

      ctx.save();
      ctx.strokeStyle = isCurrent
        ? 'rgba(234, 88, 12, 0.88)'
        : isDone
          ? 'rgba(180, 140, 110, 0.35)'
          : 'rgba(234, 88, 12, 0.48)';
      ctx.lineWidth = isCurrent ? Math.max(3, size * 0.008) : Math.max(2, size * 0.0055);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(ax1, ay1);
      ctx.lineTo(ax2, ay2);
      // Arrowhead
      const head = Math.max(6, size * 0.018);
      ctx.lineTo(ax2 - head * Math.cos(angle - 0.55), ay2 - head * Math.sin(angle - 0.55));
      ctx.moveTo(ax2, ay2);
      ctx.lineTo(ax2 - head * Math.cos(angle + 0.55), ay2 - head * Math.sin(angle + 0.55));
      ctx.stroke();

      // Number circle badge
      const r = isCurrent ? baseRadius * 1.16 : baseRadius * 0.96;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = isCurrent ? '#ef4444' : isDone ? '#e7d5c5' : '#fb923c';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#fffdf9';
      ctx.stroke();

      // Number text
      ctx.fillStyle = isDone ? '#8a6b52' : '#ffffff';
      ctx.font = '800 ' + Math.round(r * 1.2) + 'px "M PLUS Rounded 1c", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), sx, sy + 0.5);
      ctx.restore();
    }
  }

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

    // Very large traceable model character (~78% of the square)
    if (state.question) {
      guideCtx.save();
      guideCtx.textAlign = 'center';
      guideCtx.textBaseline = 'middle';
      guideCtx.font = getTraceFont(size * 0.78);
      guideCtx.fillStyle = 'rgba(130, 88, 56, ' + state.guideAlpha + ')';
      guideCtx.fillText(state.question.targetChar, size * 0.5, size * 0.52);

      guideCtx.lineWidth = Math.max(1.5, size * 0.004);
      guideCtx.strokeStyle = 'rgba(194, 120, 68, ' + Math.min(0.45, state.guideAlpha + 0.12) + ')';
      guideCtx.strokeText(state.question.targetChar, size * 0.5, size * 0.52);
      guideCtx.restore();

      drawStrokeOrderOverlay(guideCtx, size);
    }

    guideCtx.restore();
  }

  function renderDrawCanvas() {
    const size = state.cssSize;
    const dpr = state.dpr;
    drawCtx.save();
    drawCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawCtx.clearRect(0, 0, size, size);

    for (let s = 0; s < state.strokes.length; s++) {
      drawSingleStroke(state.strokes[s], size);
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

    const last = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    drawCtx.lineWidth = Math.max(6, last.nw * size);
    drawCtx.beginPath();
    drawCtx.moveTo(((prev.nx + last.nx) * 0.5) * size, ((prev.ny + last.ny) * 0.5) * size);
    drawCtx.lineTo(last.nx * size, last.ny * size);
    drawCtx.stroke();
  }

  function resizeCanvases() {
    const stage = dom.paperFrame.parentElement;
    const stageRect = stage ? stage.getBoundingClientRect() : dom.paperFrame.getBoundingClientRect();
    const maxAllowed = 760;
    const side = Math.max(
      140,
      Math.floor(Math.min(stageRect.width, stageRect.height, maxAllowed))
    );

    // Explicitly lock paperFrame to an exact square that fits both width and height
    dom.paperFrame.style.width = side + 'px';
    dom.paperFrame.style.height = side + 'px';

    // Measure actual inner content box (excluding 4px border on each side)
    const innerSize = Math.max(160, Math.floor(dom.paperFrame.clientWidth || side - 8));
    state.cssSize = innerSize;
    state.dpr = Math.min(window.devicePixelRatio || 1, 2);

    [dom.guideCanvas, dom.drawCanvas].forEach(function (c) {
      c.width = Math.round(innerSize * state.dpr);
      c.height = Math.round(innerSize * state.dpr);
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
    updateStrokeHintText();
    renderGuideCanvas();
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
    state.strokeOrder = typeof getStrokeOrder === 'function' ? getStrokeOrder(q.targetChar) : [];

    dom.seriesFromBadge.textContent = q.fromText;
    dom.scriptBadge.textContent = q.scriptLabel;
    dom.scriptBadge.classList.toggle('is-katakana', q.script === 'katakana');
    if (dom.strokeCountBadge) {
      if (state.strokeOrder.length > 0) {
        dom.strokeCountBadge.textContent = state.strokeOrder.length + 'かく';
        dom.strokeCountBadge.classList.remove('hidden');
      } else {
        dom.strokeCountBadge.classList.add('hidden');
      }
    }

    dom.charNameRow.innerHTML = '';
    dom.charNameRow.style.setProperty('--name-len', String(Math.max(1, q.chars.length)));
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

    if (dom.charImageSearchLink) {
      const query = q.displayName + ' ' + q.seriesLabel + ' キャラクター';
      dom.charImageSearchLink.href =
        'https://www.google.com/search?tbm=isch&safe=active&q=' +
        encodeURIComponent(query);
      dom.charImageSearchLink.setAttribute(
        'aria-label',
        q.displayName + '（' + q.seriesLabel + '）の Google 画像検索を新しいタブでひらく'
      );
    }

    buildGuideSamples(q.targetChar);
    clearDrawing(false);

    if (playSound) sound.playNext();
  }

  function triggerHanamaru() {
    if (state.strokes.length === 0) {
      sound.playEncourage();
      showSoftToast('まずは ゆび や ぺん で なぞってみよう！');
      return;
    }

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

    dom.hanamaruOverlay.classList.add('hidden');
    void dom.hanamaruOverlay.offsetWidth;
    dom.hanamaruOverlay.classList.remove('hidden');

    sound.playHanamaru();
  }

  function getNormalizedPoint(e) {
    const rect = dom.drawCanvas.getBoundingClientRect();
    const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const ny = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

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
    // Highlight the next stroke number after finishing this stroke
    updateStrokeHintText();
    renderGuideCanvas();
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
      btn.textContent = s.label + '（' + s.characters.length + '）';
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

    dom.chkStrokeOrder.checked = state.showStrokeOrder;
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
    dom.drawCanvas.addEventListener('pointerdown', onPointerDown, { passive: false });
    dom.drawCanvas.addEventListener('pointermove', onPointerMove, { passive: false });
    dom.drawCanvas.addEventListener('pointerup', endStroke);
    dom.drawCanvas.addEventListener('pointercancel', endStroke);

    dom.drawCanvas.addEventListener(
      'touchstart',
      function (e) {
        e.preventDefault();
      },
      { passive: false }
    );

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

    if (dom.charImageSearchLink) {
      dom.charImageSearchLink.addEventListener('click', function (e) {
        const url = dom.charImageSearchLink.href;
        if (!url) return;
        const winW = Math.min(580, Math.max(380, Math.round(window.screen.availWidth * 0.42)));
        const winH = Math.min(680, Math.max(460, Math.round(window.screen.availHeight * 0.72)));
        const left = Math.max(20, Math.round((window.screen.availWidth - winW) * 0.85));
        const top = Math.max(20, Math.round((window.screen.availHeight - winH) * 0.5));
        const features =
          'popup=yes,width=' + winW +
          ',height=' + winH +
          ',left=' + left +
          ',top=' + top +
          ',resizable=yes,scrollbars=yes';
        const popup = window.open(url, 'mojiCharSearch', features);
        if (popup) {
          e.preventDefault();
          try {
            popup.opener = null;
            popup.focus();
          } catch (_) {}
        }
      });
    }

    dom.btnSound.addEventListener('click', function () {
      sound.toggleMute();
      updateHeaderUI();
      if (!sound.muted) sound.playPop();
    });

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

    dom.chkStrokeOrder.addEventListener('change', function () {
      state.showStrokeOrder = dom.chkStrokeOrder.checked;
      savePrefs();
      updateStrokeHintText();
      renderGuideCanvas();
      sound.playPop();
    });

    dom.chkPencilOnly.addEventListener('change', function () {
      state.pencilOnly = dom.chkPencilOnly.checked;
      savePrefs();
      updateHeaderUI();
      sound.playPop();
    });

    window.addEventListener('resize', resizeCanvases);
    window.addEventListener('orientationchange', function () {
      setTimeout(resizeCanvases, 120);
    });
    if (typeof ResizeObserver === 'function' && dom.paperFrame.parentElement) {
      const ro = new ResizeObserver(function () {
        resizeCanvases();
      });
      ro.observe(dom.paperFrame.parentElement);
    }
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
