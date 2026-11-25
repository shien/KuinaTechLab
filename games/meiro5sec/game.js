(function (global) {
  'use strict';

  const { RANKS, getRankForScore, generateMaze, hasPassage, SoundEngine } = global.Meiro5;

  const BASE_TIME_LIMIT = 5.0;
  const START_INTRO_DURATION = 1.15;
  const TIME_FREEZE_DURATION = 0.30;
  const BEST_STORAGE_KEY = 'meiro5_best_v1';
  const BEST_BY_DIFF_KEY = 'meiro5_best_by_diff_v2';
  const DIFF_STORAGE_KEY = 'meiro5_difficulty_v1';

  const DIFFICULTIES = {
    normal: {
      id: 'normal',
      label: 'ノーマル',
      en: 'NORMAL',
      maxStages: 10,
      allClearBonus: 200
    },
    hard: {
      id: 'hard',
      label: 'ハード',
      en: 'HARD',
      maxStages: null,
      allClearBonus: 0
    }
  };

  const sound = new SoundEngine();

  // DOM references
  const dom = {
    screenFx: document.getElementById('screenFx'),
    hudDiffBadge: document.getElementById('hudDiffBadge'),
    stageNum: document.getElementById('stageNum'),
    gridBadge: document.getElementById('gridBadge'),
    timerText: document.getElementById('timerText'),
    bonusCarryBadge: document.getElementById('bonusCarryBadge'),
    timerBarTrack: document.querySelector('.timer-bar-track'),
    timerBarFill: document.getElementById('timerBarFill'),
    timerBarBonus: document.getElementById('timerBarBonus'),
    liveRankEmoji: document.getElementById('liveRankEmoji'),
    liveRankName: document.getElementById('liveRankName'),
    scoreText: document.getElementById('scoreText'),
    btnRanksHud: document.getElementById('btnRanksHud'),
    btnFullscreen: document.getElementById('btnFullscreen'),
    btnSound: document.getElementById('btnSound'),
    boardFrame: document.getElementById('boardFrame'),
    canvas: document.getElementById('mazeCanvas'),
    clearBanner: document.getElementById('clearBanner'),
    clearPoints: document.getElementById('clearPoints'),
    clearBonus: document.getElementById('clearBonus'),
    canvasToast: document.getElementById('canvasToast'),
    btnBackToResult: document.getElementById('btnBackToResult'),
    itemStatusPill: document.getElementById('itemStatusPill'),
    itemStatusText: document.getElementById('itemStatusText'),
    healStatusPill: document.getElementById('healStatusPill'),
    healStatusText: document.getElementById('healStatusText'),

    titleModal: document.getElementById('titleModal'),
    btnDiffNormal: document.getElementById('btnDiffNormal'),
    btnDiffHard: document.getElementById('btnDiffHard'),
    titleBestBox: document.getElementById('titleBestBox'),
    titleBestValue: document.getElementById('titleBestValue'),
    btnStart: document.getElementById('btnStart'),
    btnStartLabel: document.getElementById('btnStartLabel'),
    btnTitleRanks: document.getElementById('btnTitleRanks'),

    resultModal: document.getElementById('resultModal'),
    resultStatusBadge: document.getElementById('resultStatusBadge'),
    resultDiffBadge: document.getElementById('resultDiffBadge'),
    newRecordBadge: document.getElementById('newRecordBadge'),
    rankShowcase: document.getElementById('rankShowcase'),
    resultRankEmoji: document.getElementById('resultRankEmoji'),
    resultHeading: document.getElementById('resultHeading'),
    resultRankEn: document.getElementById('resultRankEn'),
    resultRankComment: document.getElementById('resultRankComment'),
    resultScore: document.getElementById('resultScore'),
    resultCleared: document.getElementById('resultCleared'),
    resultItems: document.getElementById('resultItems'),
    nextRankHint: document.getElementById('nextRankHint'),
    resultLadder: document.getElementById('resultLadder'),
    btnRetry: document.getElementById('btnRetry'),
    btnRetryLabel: document.getElementById('btnRetryLabel'),
    btnPeekMaze: document.getElementById('btnPeekMaze'),
    btnSwitchDifficulty: document.getElementById('btnSwitchDifficulty'),

    ranksModal: document.getElementById('ranksModal'),
    ranksList: document.getElementById('ranksList'),
    btnCloseRanks: document.getElementById('btnCloseRanks')
  };

  const ctx = dom.canvas.getContext('2d');

  // Best record & difficulty persistence
  function loadSavedDifficulty() {
    try {
      const saved = localStorage.getItem(DIFF_STORAGE_KEY);
      if (saved === 'normal' || saved === 'hard') return saved;
    } catch (_) {}
    return 'normal';
  }

  function saveDifficulty(diffId) {
    try {
      localStorage.setItem(DIFF_STORAGE_KEY, diffId);
    } catch (_) {}
  }

  function loadBestRecords() {
    const empty = {
      normal: { score: 0, cleared: 0 },
      hard: { score: 0, cleared: 0 }
    };
    try {
      const rawV2 = localStorage.getItem(BEST_BY_DIFF_KEY);
      if (rawV2) {
        const parsed = JSON.parse(rawV2);
        return {
          normal: {
            score: Number(parsed?.normal?.score) || 0,
            cleared: Number(parsed?.normal?.cleared) || 0
          },
          hard: {
            score: Number(parsed?.hard?.score) || 0,
            cleared: Number(parsed?.hard?.cleared) || 0
          }
        };
      }
      // Migrate legacy v1 best record into Hard (previous default difficulty)
      const rawV1 = localStorage.getItem(BEST_STORAGE_KEY);
      if (rawV1) {
        const parsed = JSON.parse(rawV1);
        empty.hard = {
          score: Number(parsed.score) || 0,
          cleared: Number(parsed.cleared) || 0
        };
      }
    } catch (_) {}
    return empty;
  }

  function saveBestRecords(records) {
    try {
      localStorage.setItem(BEST_BY_DIFF_KEY, JSON.stringify(records));
    } catch (_) {}
  }

  // Game state
  const state = {
    mode: 'title', // 'title' | 'playing' | 'clearing' | 'gameover'
    difficulty: loadSavedDifficulty(), // 'normal' | 'hard'
    didAllClear: false,
    stage: 1,
    score: 0,
    stagesCleared: 0,
    itemsCollected: 0,
    pendingBonusSeconds: 0, // carried over from previous stage's item
    stageMaxTime: BASE_TIME_LIMIT,
    timeLeft: BASE_TIME_LIMIT,
    maze: null,

    // Drawing state
    isDrawing: false,
    activePointerId: null,
    path: [],
    itemCollectedInStroke: false,
    pointerPos: null,
    lastPointerPos: null,

    // Visual juice & feedback
    arenaW: 520,
    arenaH: 520,
    boardW: 480,
    boardH: 480,
    pad: 18,
    cellSize: 80,
    particles: [],
    dissolveLines: [],
    floatingTexts: [],
    shockwaves: [],
    healFlashTimer: 0,
    timeFreezeTimer: 0,
    timeFreezeKind: null, // 'heal' | 'next'
    screenFxTimer: null,
    nextItemFreezeUsedThisStage: false,
    healsCollectedThisStage: 0,
    startIntroTimer: 0,
    startPulseBoost: 0,
    lastWallBumpAt: 0,
    lastUrgentSecond: -1,
    toastTimer: null,
    clearTimeout: null,
    peekingMaze: false
  };

  let bestRecords = loadBestRecords();

  function getCurrentDifficultyConfig() {
    return DIFFICULTIES[state.difficulty] || DIFFICULTIES.hard;
  }

  function getCurrentBest() {
    return bestRecords[state.difficulty] || { score: 0, cleared: 0 };
  }

  function setDifficulty(diffId, refreshPreview = true) {
    if (diffId !== 'normal' && diffId !== 'hard') return;
    state.difficulty = diffId;
    saveDifficulty(diffId);

    const cfg = getCurrentDifficultyConfig();
    if (dom.btnDiffNormal && dom.btnDiffHard) {
      dom.btnDiffNormal.classList.toggle('active', diffId === 'normal');
      dom.btnDiffNormal.setAttribute('aria-pressed', String(diffId === 'normal'));
      dom.btnDiffHard.classList.toggle('active', diffId === 'hard');
      dom.btnDiffHard.setAttribute('aria-pressed', String(diffId === 'hard'));
    }
    if (dom.btnStartLabel) {
      dom.btnStartLabel.textContent = `${cfg.label}で挑戦する`;
    }

    updateTitleBest();
    if (refreshPreview && state.mode === 'title') {
      state.maze = generateMaze(1, getPreferredAspectRatio(), state.difficulty);
      resizeCanvas();
    }
    updateHudStatic();
  }

  // ---- Layout & Coordinate Helpers ----
  function measureArena() {
    const wrap = dom.boardFrame.parentElement;
    if (!wrap) return { w: 480, h: 480 };
    const rect = wrap.getBoundingClientRect();
    const cs = window.getComputedStyle(wrap);
    const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const w = Math.max(200, Math.floor(Math.min(rect.width - padX - 4, 1120)));
    const h = Math.max(200, Math.floor(Math.min(rect.height - padY - 4, 820)));
    state.arenaW = w;
    state.arenaH = h;
    return { w, h };
  }

  function getPreferredAspectRatio() {
    const { w, h } = measureArena();
    if (h <= 0) return 1;
    return w / h;
  }

  function resizeCanvas() {
    const { w, h } = measureArena();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);

    if (state.maze) {
      const { rows, cols } = state.maze;
      const minSide = Math.min(w, h);
      state.pad = Math.max(10, Math.floor(minSide * 0.03));
      const maxCellW = (w - state.pad * 2) / cols;
      const maxCellH = (h - state.pad * 2) / rows;
      state.cellSize = Math.max(12, Math.floor(Math.min(maxCellW, maxCellH)));
      state.boardW = Math.round(cols * state.cellSize + state.pad * 2);
      state.boardH = Math.round(rows * state.cellSize + state.pad * 2);
    } else {
      const sq = Math.min(w, h);
      state.boardW = sq;
      state.boardH = sq;
    }

    dom.canvas.style.width = `${state.boardW}px`;
    dom.canvas.style.height = `${state.boardH}px`;
    dom.canvas.width = Math.round(state.boardW * dpr);
    dom.canvas.height = Math.round(state.boardH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function recomputeMetrics() {
    resizeCanvas();
  }

  function cellCenter(r, c) {
    return {
      x: state.pad + (c + 0.5) * state.cellSize,
      y: state.pad + (r + 0.5) * state.cellSize
    };
  }

  function pointToCell(x, y) {
    const c = Math.floor((x - state.pad) / state.cellSize);
    const r = Math.floor((y - state.pad) / state.cellSize);
    return {
      r: Math.max(0, Math.min(state.maze.rows - 1, r)),
      c: Math.max(0, Math.min(state.maze.cols - 1, c))
    };
  }

  function getCanvasPos(e) {
    const rect = dom.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }

  // ---- UI Feedback Helpers ----
  function showToast(text, variant = '', durationMs = 1100) {
    dom.canvasToast.textContent = text;
    dom.canvasToast.className = `canvas-toast ${variant}`.trim();
    if (state.toastTimer) clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => {
      dom.canvasToast.classList.add('hidden');
    }, durationMs);
  }

  function hideToast() {
    if (state.toastTimer) clearTimeout(state.toastTimer);
    dom.canvasToast.classList.add('hidden');
  }

  function updateSoundButton() {
    dom.btnSound.textContent = sound.muted ? '🔇' : '🔊';
    dom.btnSound.title = sound.muted ? 'サウンドONにする' : 'ミュートにする';
  }

  function updateTitleBest() {
    const best = getCurrentBest();
    const cfg = getCurrentDifficultyConfig();
    if (best.score > 0) {
      const { rank } = getRankForScore(best.score);
      const clearSuffix = cfg.maxStages
        ? `${best.cleared}/${cfg.maxStages}問`
        : `${best.cleared}問クリア`;
      dom.titleBestValue.textContent = `[${cfg.label}] ${rank.emoji} ${rank.name} — ${best.score.toLocaleString()} pt (${clearSuffix})`;
      dom.titleBestBox.classList.remove('hidden');
    } else {
      dom.titleBestBox.classList.add('hidden');
    }
  }

  function updateHudStatic() {
    const cfg = getCurrentDifficultyConfig();
    if (dom.hudDiffBadge) {
      dom.hudDiffBadge.textContent = cfg.en;
      dom.hudDiffBadge.className = `diff-pill diff-${cfg.id} mono`;
    }

    const stageStr = String(state.stage).padStart(2, '0');
    dom.stageNum.textContent = cfg.maxStages ? `${stageStr}/${cfg.maxStages}` : stageStr;
    if (state.maze) {
      dom.gridBadge.textContent = `${state.maze.cols}×${state.maze.rows}`;
    }

    const { rank } = getRankForScore(state.score);
    dom.liveRankEmoji.textContent = rank.emoji;
    dom.liveRankName.textContent = rank.name;
    dom.liveRankName.style.color = rank.color;
    dom.scoreText.textContent = `${state.score.toLocaleString()} pt`;

    if (state.pendingBonusSeconds > 0) {
      dom.bonusCarryBadge.textContent = `+${state.pendingBonusSeconds}s 延長`;
      dom.bonusCarryBadge.classList.remove('hidden');
    } else {
      dom.bonusCarryBadge.classList.add('hidden');
    }

    updateItemStatusBar();
  }

  function updateItemStatusBar() {
    if (!state.maze || !state.maze.item) return;
    const sec = state.maze.item.bonusSeconds;
    if (state.itemCollectedInStroke) {
      dom.itemStatusPill.classList.add('collected');
      dom.itemStatusText.textContent = `● 次 +${sec}秒 確保中！このままゴールへ`;
    } else {
      dom.itemStatusPill.classList.remove('collected');
      dom.itemStatusText.textContent = `● 別ルートに 次 +${sec}秒`;
    }

    const heals = state.maze.healItems || [];
    if (heals.length > 0) {
      const remaining = heals.filter((h) => !h.used).length;
      dom.healStatusPill.classList.remove('hidden');
      if (remaining > 0) {
        dom.healStatusText.textContent = `◆ 今回回復 残り ${remaining}/${heals.length}個（+1〜3秒）`;
      } else {
        dom.healStatusText.textContent = `◆ 今回回復 すべて回収済！`;
      }
    } else {
      dom.healStatusPill.classList.add('hidden');
    }
  }

  function updateTimerHud() {
    const t = Math.max(0, state.timeLeft);
    dom.timerText.innerHTML = `${t.toFixed(2)}<span class="timer-unit">s</span>`;

    const isFrozen = state.mode === 'playing' && state.timeFreezeTimer > 0;
    const isBonusZone = t > BASE_TIME_LIMIT;
    const isCritical = t <= 1.5 && !isFrozen;
    const isWarn = t <= 2.5 && !isCritical && !isFrozen;

    dom.timerText.classList.toggle('bonus-active', isBonusZone);
    dom.timerText.classList.toggle('warn', isWarn);
    dom.timerText.classList.toggle('critical', isCritical);
    dom.timerText.classList.toggle('heal-flash', state.healFlashTimer > 0);
    dom.timerText.classList.toggle('time-frozen', isFrozen);
    dom.timerText.classList.toggle('fx-heal', isFrozen && state.timeFreezeKind === 'heal');
    dom.timerText.classList.toggle('fx-next', isFrozen && state.timeFreezeKind === 'next');

    if (dom.timerBarTrack) {
      dom.timerBarTrack.classList.toggle('time-frozen', isFrozen);
    }
    dom.timerBarFill.classList.toggle('warn', isWarn);
    dom.timerBarFill.classList.toggle('critical', isCritical);
    dom.boardFrame.classList.toggle('critical', state.mode === 'playing' && isCritical);

    // Segmented progress bar: total width represents stageMaxTime
    const maxT = Math.max(BASE_TIME_LIMIT, state.stageMaxTime);
    const baseRemaining = Math.min(t, BASE_TIME_LIMIT);
    const bonusRemaining = Math.max(0, t - BASE_TIME_LIMIT);

    dom.timerBarFill.style.width = `${(baseRemaining / maxT) * 100}%`;
    dom.timerBarBonus.style.width = `${(bonusRemaining / maxT) * 100}%`;
  }

  // ---- Particles & Visual Effects ----
  function spawnFloatingText(x, y, text, color) {
    state.floatingTexts.push({
      x,
      y,
      text,
      color,
      life: 0.85,
      maxLife: 0.85
    });
  }

  function triggerTimePickupCelebration({ x, y, kind, bonusSeconds, freezeTime }) {
    const isHeal = kind === 'heal';
    const isSuperNext = !isHeal && bonusSeconds >= 3;
    const primaryColor = isHeal ? '#4ade80' : isSuperNext ? '#f472b6' : '#fbbf24';
    const secondaryColor = isHeal ? '#38bdf8' : '#fde047';

    // 1. 0.30s time freeze (hitstop on timer while keeping drawing silky smooth)
    if (freezeTime) {
      state.timeFreezeTimer = TIME_FREEZE_DURATION;
      state.timeFreezeKind = kind;
    }

    // 2. Full-viewport non-blocking edge flash + diagonal light sweep + 4-corner burst
    if (dom.screenFx) {
      dom.screenFx.classList.remove('active', 'fx-heal', 'fx-next', 'fx-next-3');
      void dom.screenFx.offsetWidth;
      const fxClass = isHeal ? 'fx-heal' : isSuperNext ? 'fx-next-3' : 'fx-next';
      dom.screenFx.classList.add('active', fxClass);
    }

    dom.boardFrame.classList.remove('fx-heal', 'fx-next');
    dom.boardFrame.classList.add(isHeal ? 'fx-heal' : 'fx-next');

    if (state.screenFxTimer) clearTimeout(state.screenFxTimer);
    state.screenFxTimer = setTimeout(() => {
      if (dom.screenFx) dom.screenFx.classList.remove('active', 'fx-heal', 'fx-next', 'fx-next-3');
      dom.boardFrame.classList.remove('fx-heal', 'fx-next');
      state.screenFxTimer = null;
    }, 660);

    // 3. Full-board expanding shockwaves & radial speed-rays on canvas
    const rayAngles = [];
    const rayCount = 14;
    for (let i = 0; i < rayCount; i++) {
      rayAngles.push((Math.PI * 2 * i) / rayCount + (Math.random() - 0.5) * 0.22);
    }
    state.shockwaves.push({
      x,
      y,
      primaryColor,
      secondaryColor,
      label: isHeal ? `+${bonusSeconds}s` : `NEXT +${bonusSeconds}s`,
      rayAngles,
      life: 0.62,
      maxLife: 0.62
    });

    // 4. Dual-tone wide celebratory spark burst
    spawnBurst(x, y, primaryColor, 20, 260);
    spawnBurst(x, y, secondaryColor, 14, 320);
    spawnBurst(x, y, '#ffffff', 10, 210);
  }
  function spawnBurst(x, y, color, count = 14, speed = 150) {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.45;
      const spd = speed * (0.45 + Math.random() * 0.75);
      state.particles.push({
        x,
        y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        life: 0.42 + Math.random() * 0.25,
        maxLife: 0.65,
        radius: 2.2 + Math.random() * 2.8,
        color
      });
    }
  }

  function spawnEraseDissolve(pathCells) {
    if (!pathCells || pathCells.length === 0) return;
    const points = pathCells.map((cell) => cellCenter(cell.r, cell.c));
    state.dissolveLines.push({
      points,
      life: 0.28,
      maxLife: 0.28
    });

    const step = Math.max(1, Math.floor(points.length / 10));
    for (let i = 0; i < points.length; i += step) {
      spawnBurst(points[i].x, points[i].y, '#38bdf8', 3, 75);
    }
  }

  function triggerBoardShake() {
    dom.boardFrame.classList.remove('shake');
    void dom.boardFrame.offsetWidth;
    dom.boardFrame.classList.add('shake');
  }

  // ---- Stage Lifecycle ----
  function startNewGame() {
    if (state.clearTimeout) {
      clearTimeout(state.clearTimeout);
      state.clearTimeout = null;
    }
    dom.titleModal.classList.add('hidden');
    dom.resultModal.classList.add('hidden');
    dom.ranksModal.classList.add('hidden');
    dom.btnBackToResult.classList.add('hidden');
    dom.clearBanner.classList.add('hidden');
    hideToast();

    state.stage = 1;
    state.score = 0;
    state.stagesCleared = 0;
    state.itemsCollected = 0;
    state.didAllClear = false;
    state.pendingBonusSeconds = 0;
    state.particles = [];
    state.dissolveLines = [];
    state.floatingTexts = [];
    state.shockwaves = [];
    state.healFlashTimer = 0;
    state.timeFreezeTimer = 0;
    state.timeFreezeKind = null;
    state.nextItemFreezeUsedThisStage = false;
    state.healsCollectedThisStage = 0;
    state.peekingMaze = false;

    loadStage(1, 0);
  }

  function loadStage(stageNumber, bonusSeconds) {
    const cfg = getCurrentDifficultyConfig();
    state.stage = stageNumber;
    state.pendingBonusSeconds = bonusSeconds;
    state.stageMaxTime = BASE_TIME_LIMIT + bonusSeconds;
    state.timeLeft = state.stageMaxTime;
    state.maze = generateMaze(stageNumber, getPreferredAspectRatio(), state.difficulty);
    state.isDrawing = false;
    state.activePointerId = null;
    state.path = [];
    state.itemCollectedInStroke = false;
    state.healsCollectedThisStage = 0;
    state.healFlashTimer = 0;
    state.timeFreezeTimer = 0;
    state.timeFreezeKind = null;
    state.nextItemFreezeUsedThisStage = false;
    state.floatingTexts = [];
    state.shockwaves = [];
    state.pointerPos = null;
    state.lastPointerPos = null;
    state.lastUrgentSecond = -1;
    state.startIntroTimer = START_INTRO_DURATION;
    state.startPulseBoost = 1.0;
    state.mode = 'playing';

    dom.boardFrame.classList.remove('drawing', 'critical', 'fx-heal', 'fx-next');
    if (dom.screenFx) dom.screenFx.classList.remove('active', 'fx-heal', 'fx-next', 'fx-next-3');
    dom.clearBanner.classList.add('hidden');
    dom.btnRanksHud.disabled = true;
    dom.btnRanksHud.style.opacity = '0.45';

    recomputeMetrics();
    updateHudStatic();
    updateTimerHud();

    const healCount = (state.maze.healItems || []).length;
    const isFinalStage = cfg.maxStages && stageNumber === cfg.maxStages;
    if (isFinalStage) {
      const bonusText = bonusSeconds > 0 ? `（+${bonusSeconds}秒延長）` : '';
      showToast(`🔥 FINAL STAGE ${stageNumber}/${cfg.maxStages}${bonusText} — クリアで完走！`, 'item', 2000);
    } else if (bonusSeconds > 0 && healCount > 0) {
      showToast(`⏳ +${bonusSeconds}秒延長 & 💚 今回回復◆×${healCount} 出現！`, 'item', 1600);
    } else if (bonusSeconds > 0) {
      showToast(`⏳ 延長ボーナス +${bonusSeconds}秒（制限時間 ${state.stageMaxTime.toFixed(0)}秒）`, 'item', 1400);
    } else if (stageNumber === 4 && healCount > 0) {
      showToast(`💚 今回回復アイテム（◆）登場！触れると即 +1〜3秒 回復！`, 'heal', 1800);
    }
  }

  function releaseActiveCapture() {
    if (state.activePointerId !== null) {
      try {
        if (dom.canvas.hasPointerCapture(state.activePointerId)) {
          dom.canvas.releasePointerCapture(state.activePointerId);
        }
      } catch (_) {}
      state.activePointerId = null;
    }
  }

  function finalizeRunRecord() {
    const currentBest = getCurrentBest();
    const isNewRecord = state.score > currentBest.score;
    if (isNewRecord) {
      bestRecords[state.difficulty] = { score: state.score, cleared: state.stagesCleared };
      saveBestRecords(bestRecords);
      updateTitleBest();
    }
    return isNewRecord;
  }

  function handleNormalAllClear(goalPos) {
    state.mode = 'gameover';
    state.didAllClear = true;
    state.isDrawing = false;
    releaseActiveCapture();
    dom.boardFrame.classList.remove('drawing', 'critical');
    dom.btnRanksHud.disabled = false;
    dom.btnRanksHud.style.opacity = '1';
    hideToast();

    // Big celebratory burst
    spawnBurst(goalPos.x, goalPos.y, '#34d399', 28, 250);
    spawnBurst(goalPos.x, goalPos.y, '#fde047', 24, 290);
    spawnBurst(goalPos.x, goalPos.y, '#38bdf8', 20, 220);

    const isNewRecord = finalizeRunRecord();
    renderResultModal(isNewRecord);

    state.clearTimeout = setTimeout(() => {
      state.clearTimeout = null;
      dom.clearBanner.classList.add('hidden');
      if (state.mode === 'gameover' && !state.peekingMaze) {
        dom.resultModal.classList.remove('hidden');
      }
    }, 950);
  }

  function handleStageClear() {
    if (state.mode !== 'playing') return;
    state.mode = 'clearing';
    state.isDrawing = false;
    releaseActiveCapture();
    dom.boardFrame.classList.remove('drawing', 'critical');

    const cfg = getCurrentDifficultyConfig();
    const isFinalNormalStage = cfg.maxStages !== null && state.stage >= cfg.maxStages;
    const gotItem = state.itemCollectedInStroke;
    const itemBonusSec = gotItem ? state.maze.item.bonusSeconds : 0;

    // Score calculation (Normal calibrated so Stage 10 ALL CLEAR = スーパーコンピュータ level)
    let stageBase, timeBonus, itemScore, clearBonus = 0;
    if (state.difficulty === 'normal') {
      stageBase = 85 + (state.stage - 1) * 30;
      timeBonus = Math.round(Math.min(5.0, Math.max(0, state.timeLeft)) * 35);
      itemScore = itemBonusSec * 40;
      if (isFinalNormalStage) clearBonus = cfg.allClearBonus;
    } else {
      stageBase = 100 + (state.stage - 1) * 35;
      timeBonus = Math.round(Math.max(0, state.timeLeft) * 40);
      itemScore = itemBonusSec * 50;
    }
    const gained = stageBase + timeBonus + itemScore + clearBonus;

    state.score += gained;
    state.stagesCleared += 1;
    if (gotItem) state.itemsCollected += 1;

    sound.playClear(gotItem || isFinalNormalStage);
    const goalPos = cellCenter(state.maze.goal.r, state.maze.goal.c);
    spawnBurst(goalPos.x, goalPos.y, '#34d399', 22, 210);
    if (gotItem) {
      spawnBurst(goalPos.x, goalPos.y, '#fbbf24', 18, 240);
    }

    updateHudStatic();

    // Show snappy clear banner
    const clearTitleEl = dom.clearBanner.querySelector('.clear-title');
    if (clearTitleEl) {
      clearTitleEl.textContent = isFinalNormalStage ? 'ALL CLEAR!' : 'CLEAR!';
    }
    dom.clearPoints.textContent = `+${gained.toLocaleString()} pt`;
    if (isFinalNormalStage) {
      dom.clearBonus.textContent = `🏆 ノーマル全${cfg.maxStages}問 制覇！（+${clearBonus}pt）`;
      dom.clearBonus.classList.remove('hidden');
    } else if (gotItem) {
      dom.clearBonus.textContent = `⏳ 次の迷路 +${itemBonusSec}秒 延長！`;
      dom.clearBonus.classList.remove('hidden');
    } else {
      dom.clearBonus.classList.add('hidden');
    }
    dom.clearBanner.classList.remove('hidden');

    if (isFinalNormalStage) {
      handleNormalAllClear(goalPos);
      return;
    }

    state.clearTimeout = setTimeout(() => {
      state.clearTimeout = null;
      loadStage(state.stage + 1, itemBonusSec);
    }, 680);
  }

  function handleGameOver() {
    if (state.mode !== 'playing') return;
    state.mode = 'gameover';
    state.didAllClear = false;
    state.timeLeft = 0;
    state.isDrawing = false;
    releaseActiveCapture();
    dom.boardFrame.classList.remove('drawing', 'critical');
    dom.btnRanksHud.disabled = false;
    dom.btnRanksHud.style.opacity = '1';
    hideToast();

    updateTimerHud();
    sound.playGameOver();
    triggerBoardShake();

    const isNewRecord = finalizeRunRecord();
    renderResultModal(isNewRecord);
    setTimeout(() => {
      if (state.mode === 'gameover' && !state.peekingMaze) {
        dom.resultModal.classList.remove('hidden');
      }
    }, 420);
  }

  // ---- Result & Ranks Modals ----
  function renderResultModal(isNewRecord) {
    const { index, rank, next, pointsToNext } = getRankForScore(state.score);
    const cfg = getCurrentDifficultyConfig();

    if (dom.resultStatusBadge) {
      if (state.didAllClear) {
        dom.resultStatusBadge.textContent = `ALL CLEAR! — 全${cfg.maxStages}問制覇`;
        dom.resultStatusBadge.className = 'timeup-badge all-clear mono';
      } else {
        dom.resultStatusBadge.textContent = 'TIME UP — GAME OVER';
        dom.resultStatusBadge.className = 'timeup-badge mono';
      }
    }

    if (dom.resultDiffBadge) {
      dom.resultDiffBadge.textContent = `難易度：${cfg.label} (${cfg.en})`;
      dom.resultDiffBadge.className = `result-diff-badge diff-${cfg.id}`;
    }

    dom.newRecordBadge.classList.toggle('hidden', !isNewRecord);
    dom.resultRankEmoji.textContent = rank.emoji;
    dom.resultHeading.textContent = rank.name;
    dom.resultHeading.style.color = rank.color;
    dom.resultHeading.style.textShadow = `0 0 24px ${rank.glow}`;
    dom.rankShowcase.style.borderColor = rank.color;
    dom.rankShowcase.style.boxShadow = `0 0 28px ${rank.glow}`;
    dom.resultRankEn.textContent = rank.en;
    dom.resultRankComment.textContent = rank.comment;

    dom.resultScore.textContent = `${state.score.toLocaleString()} pt`;
    dom.resultCleared.textContent = cfg.maxStages
      ? `${state.stagesCleared} / ${cfg.maxStages} 問`
      : `${state.stagesCleared} 問`;
    dom.resultItems.textContent = `${state.itemsCollected} 個`;

    if (state.didAllClear && state.difficulty === 'normal') {
      dom.nextRankHint.textContent = '🎉 ノーマル完走！さらに上の「🤖 AI〜✨ 光」はハードモードで挑戦できます！';
    } else if (next) {
      dom.nextRankHint.textContent = `次のランク「${next.emoji} ${next.name}」まで あと ${pointsToNext.toLocaleString()} pt！`;
    } else {
      dom.nextRankHint.textContent = '🌟 最高評価ランク「光」に到達しました！完璧です！';
    }

    if (dom.btnRetryLabel) {
      dom.btnRetryLabel.textContent = `${cfg.label}で再挑戦`;
    }
    if (dom.btnSwitchDifficulty) {
      if (state.difficulty === 'normal') {
        dom.btnSwitchDifficulty.textContent = '🔥 ハードモード（エンドレス）に挑戦する';
      } else {
        dom.btnSwitchDifficulty.textContent = '🟢 ノーマルモード（全10問）に切り替える';
      }
    }

    dom.resultLadder.innerHTML = '';
    RANKS.forEach((r, i) => {
      const pill = document.createElement('div');
      pill.className = 'ladder-pill';
      if (i < index) pill.classList.add('passed');
      if (i === index) pill.classList.add('current');
      pill.title = `${r.name} (${r.minScore.toLocaleString()} pt〜)`;
      pill.innerHTML = `<span>${r.emoji}</span><span class="ladder-pill-name">${r.name}</span>`;
      dom.resultLadder.appendChild(pill);
    });
  }

  function openRanksModal() {
    if (state.mode === 'playing') return;
    dom.ranksList.innerHTML = '';
    const highestAchieved = Math.max(
      bestRecords.normal.score,
      bestRecords.hard.score,
      state.score
    );

    RANKS.forEach((r) => {
      const row = document.createElement('div');
      row.className = 'rank-row';
      if (highestAchieved >= r.minScore) {
        row.classList.add('unlocked');
      }
      row.innerHTML = `
        <div class="rank-row-emoji">${r.emoji}</div>
        <div>
          <div class="rank-row-name" style="color:${r.color}">${r.name}</div>
          <div class="rank-row-comment">${r.comment}</div>
        </div>
        <div class="rank-row-score mono">${r.minScore.toLocaleString()} pt〜</div>
      `;
      dom.ranksList.appendChild(row);
    });
    dom.ranksModal.classList.remove('hidden');
  }

  // ---- Drawing & Maze Traversal Mechanics ----
  function syncItemInStroke() {
    if (!state.maze || !state.maze.item) return;
    const item = state.maze.item;
    const onPath = state.path.some((p) => p.r === item.r && p.c === item.c);
    if (onPath && !state.itemCollectedInStroke) {
      state.itemCollectedInStroke = true;
      sound.playItemPickup(item.bonusSeconds);
      const pos = cellCenter(item.r, item.c);
      const shouldFreeze = !state.nextItemFreezeUsedThisStage;
      if (shouldFreeze) {
        state.nextItemFreezeUsedThisStage = true;
      }
      triggerTimePickupCelebration({
        x: pos.x,
        y: pos.y,
        kind: 'next',
        bonusSeconds: item.bonusSeconds,
        freezeTime: shouldFreeze
      });
      spawnFloatingText(pos.x, pos.y - 6, `次 +${item.bonusSeconds}s`, '#fde047');
      showToast(`⏳ 次の迷路 +${item.bonusSeconds}秒 確保！このままゴールへ！`, 'item', 1300);
      updateTimerHud();
      updateItemStatusBar();
    } else if (!onPath && state.itemCollectedInStroke) {
      // Player backtracked off the item cell
      state.itemCollectedInStroke = false;
      updateItemStatusBar();
    }
  }

  function checkHealPickup(nr, nc) {
    const heals = state.maze && state.maze.healItems;
    if (!heals || heals.length === 0) return;

    for (const heal of heals) {
      if (!heal.used && heal.r === nr && heal.c === nc) {
        heal.used = true;
        state.timeLeft += heal.bonusSeconds;
        if (state.timeLeft > state.stageMaxTime) {
          state.stageMaxTime = state.timeLeft;
        }
        state.healsCollectedThisStage += 1;
        state.itemsCollected += 1;
        state.healFlashTimer = 0.55;
        state.lastUrgentSecond = -1;

        sound.playHealPickup(heal.bonusSeconds);
        const pos = cellCenter(heal.r, heal.c);
        triggerTimePickupCelebration({
          x: pos.x,
          y: pos.y,
          kind: 'heal',
          bonusSeconds: heal.bonusSeconds,
          freezeTime: true
        });
        spawnFloatingText(pos.x, pos.y - 6, `+${heal.bonusSeconds}s 回復!`, '#4ade80');
        showToast(`💚 制限時間を +${heal.bonusSeconds}秒 回復！`, 'heal', 1100);
        updateTimerHud();
        updateItemStatusBar();
        break;
      }
    }
  }

  function stepIntoCell(nr, nc) {
    const existingIdx = state.path.findIndex((p) => p.r === nr && p.c === nc);
    if (existingIdx !== -1) {
      // Backtracking or trimming a loop cleanly
      if (existingIdx < state.path.length - 1) {
        state.path = state.path.slice(0, existingIdx + 1);
        sound.playBacktrack();
        syncItemInStroke();
      }
      return;
    }

    state.path.push({ r: nr, c: nc });
    sound.playStep(state.path.length);
    checkHealPickup(nr, nc);
    syncItemInStroke();

    if (nr === state.maze.goal.r && nc === state.maze.goal.c) {
      handleStageClear();
    }
  }

  function notifyWallBump(headCell, blockedR, blockedC) {
    const now = performance.now();
    if (now - state.lastWallBumpAt < 230) return;
    state.lastWallBumpAt = now;
    sound.playWallBump();

    const p1 = cellCenter(headCell.r, headCell.c);
    const p2 = cellCenter(blockedR, blockedC);
    spawnBurst((p1.x + p2.x) * 0.5, (p1.y + p2.y) * 0.5, '#fb7185', 5, 65);
  }

  function advancePathTowardPoint(px, py) {
    if (!state.isDrawing || state.mode !== 'playing' || state.path.length === 0) return;

    const target = pointToCell(px, py);
    const maxHops = 6;

    for (let hop = 0; hop < maxHops; hop++) {
      if (state.mode !== 'playing' || !state.isDrawing) break;
      const head = state.path[state.path.length - 1];
      if (head.r === target.r && head.c === target.c) break;

      const dr = target.r - head.r;
      const dc = target.c - head.c;
      const manhattan = Math.abs(dr) + Math.abs(dc);

      // 1. Direct orthogonal neighbor
      if (manhattan === 1) {
        if (hasPassage(state.maze.grid, head.r, head.c, target.r, target.c)) {
          stepIntoCell(target.r, target.c);
        } else {
          notifyWallBump(head, target.r, target.c);
        }
        break;
      }

      // 2. Diagonal corner-assist (1 cell each axis)
      if (Math.abs(dr) === 1 && Math.abs(dc) === 1) {
        const viaRowOpen =
          hasPassage(state.maze.grid, head.r, head.c, target.r, head.c) &&
          hasPassage(state.maze.grid, target.r, head.c, target.r, target.c);
        const viaColOpen =
          hasPassage(state.maze.grid, head.r, head.c, head.r, target.c) &&
          hasPassage(state.maze.grid, head.r, target.c, target.r, target.c);

        if (viaRowOpen && !viaColOpen) {
          stepIntoCell(target.r, head.c);
          if (state.mode === 'playing') stepIntoCell(target.r, target.c);
          break;
        } else if (viaColOpen && !viaRowOpen) {
          stepIntoCell(head.r, target.c);
          if (state.mode === 'playing') stepIntoCell(target.r, target.c);
          break;
        } else if (viaRowOpen && viaColOpen) {
          // Pick whichever corner cell center is closer to pointer
          const cRow = cellCenter(target.r, head.c);
          const cCol = cellCenter(head.r, target.c);
          const dRow = Math.hypot(px - cRow.x, py - cRow.y);
          const dCol = Math.hypot(px - cCol.x, py - cCol.y);
          if (dRow <= dCol) {
            stepIntoCell(target.r, head.c);
          } else {
            stepIntoCell(head.r, target.c);
          }
          if (state.mode === 'playing') stepIntoCell(target.r, target.c);
          break;
        } else {
          // Maybe one axis step is open even if the second turn is blocked
          const stepRowOpen = hasPassage(state.maze.grid, head.r, head.c, target.r, head.c);
          const stepColOpen = hasPassage(state.maze.grid, head.r, head.c, head.r, target.c);
          if (stepRowOpen && !stepColOpen) {
            stepIntoCell(target.r, head.c);
          } else if (stepColOpen && !stepRowOpen) {
            stepIntoCell(head.r, target.c);
          } else {
            break;
          }
          continue;
        }
      }

      // 3. Fast swipe across multiple cells: greedily step toward target along open passages
      const stepR = dr === 0 ? 0 : dr > 0 ? 1 : -1;
      const stepC = dc === 0 ? 0 : dc > 0 ? 1 : -1;
      const candidates = [];
      if (stepR !== 0 && hasPassage(state.maze.grid, head.r, head.c, head.r + stepR, head.c)) {
        const pos = cellCenter(head.r + stepR, head.c);
        candidates.push({ r: head.r + stepR, c: head.c, dist: Math.hypot(px - pos.x, py - pos.y) });
      }
      if (stepC !== 0 && hasPassage(state.maze.grid, head.r, head.c, head.r, head.c + stepC)) {
        const pos = cellCenter(head.r, head.c + stepC);
        candidates.push({ r: head.r, c: head.c + stepC, dist: Math.hypot(px - pos.x, py - pos.y) });
      }
      if (candidates.length === 0) break;
      candidates.sort((a, b) => a.dist - b.dist);
      stepIntoCell(candidates[0].r, candidates[0].c);
    }
  }

  function releaseStroke(showFeedback = true) {
    if (!state.isDrawing) return;
    const hadPath = state.path.length > 0;
    if (hadPath) {
      spawnEraseDissolve(state.path);
    }
    state.isDrawing = false;
    state.activePointerId = null;
    state.path = [];
    state.itemCollectedInStroke = false;
    state.pointerPos = null;
    state.lastPointerPos = null;
    dom.boardFrame.classList.remove('drawing');
    updateItemStatusBar();

    if (showFeedback && state.mode === 'playing' && hadPath) {
      sound.playReleaseErase();
      showToast('離したので線が消えました！Sから引き直そう', 'erase', 1000);
    }
  }

  // Pointer event handlers
  dom.canvas.addEventListener('pointerdown', (e) => {
    if (state.mode !== 'playing') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return; // Left click only for mouse
    if (state.isDrawing) return;

    e.preventDefault();
    sound.ensureContext();

    const pos = getCanvasPos(e);
    const startCenter = cellCenter(state.maze.start.r, state.maze.start.c);
    const distToStart = Math.hypot(pos.x - startCenter.x, pos.y - startCenter.y);
    const isTouch = e.pointerType === 'touch';
    const grabRadius = isTouch
      ? Math.max(state.cellSize * 1.35, 44)
      : Math.max(state.cellSize * 1.15, 34);

    if (distToStart <= grabRadius) {
      state.isDrawing = true;
      state.activePointerId = e.pointerId;
      state.path = [{ r: state.maze.start.r, c: state.maze.start.c }];
      state.itemCollectedInStroke = false;
      state.startIntroTimer = 0;
      state.pointerPos = pos;
      state.lastPointerPos = pos;
      dom.boardFrame.classList.add('drawing');
      sound.playStartStroke();
      spawnBurst(startCenter.x, startCenter.y, '#34d399', 10, 110);
      updateItemStatusBar();
      try {
        dom.canvas.setPointerCapture(e.pointerId);
      } catch (_) {}
    } else {
      state.startIntroTimer = Math.max(state.startIntroTimer, 0.7);
      state.startPulseBoost = 1.0;
      showToast('緑の「S」から押しっぱなしで引いてね！', '', 1100);
      sound.playWallBump();
    }
  });

  dom.canvas.addEventListener('pointermove', (e) => {
    if (state.mode !== 'playing' || !state.isDrawing) return;
    if (e.pointerId !== state.activePointerId) return;
    if (e.pointerType === 'mouse' && (e.buttons & 1) === 0) {
      // Mouse button was released outside capture
      releaseStroke(true);
      return;
    }

    e.preventDefault();
    const pos = getCanvasPos(e);
    const prev = state.lastPointerPos || pos;
    const dist = Math.hypot(pos.x - prev.x, pos.y - prev.y);
    const stepLen = Math.max(4, state.cellSize * 0.28);
    const steps = Math.min(36, Math.max(1, Math.ceil(dist / stepLen)));

    for (let i = 1; i <= steps; i++) {
      if (!state.isDrawing || state.mode !== 'playing') break;
      const t = i / steps;
      const ix = prev.x + (pos.x - prev.x) * t;
      const iy = prev.y + (pos.y - prev.y) * t;
      advancePathTowardPoint(ix, iy);
    }

    state.pointerPos = pos;
    state.lastPointerPos = pos;
  });

  function onPointerRelease(e) {
    if (!state.isDrawing || e.pointerId !== state.activePointerId) return;
    e.preventDefault();
    try {
      if (dom.canvas.hasPointerCapture(e.pointerId)) {
        dom.canvas.releasePointerCapture(e.pointerId);
      }
    } catch (_) {}
    releaseStroke(true);
  }

  dom.canvas.addEventListener('pointerup', onPointerRelease);
  dom.canvas.addEventListener('pointercancel', onPointerRelease);
  dom.canvas.addEventListener('lostpointercapture', (e) => {
    if (state.isDrawing && e.pointerId === state.activePointerId) {
      releaseStroke(true);
    }
  });
  dom.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('blur', () => {
    if (state.isDrawing) releaseStroke(true);
  });

  // ---- Rendering ----
  function drawRouteHint(route, strokeStyle, lineDash, lineWidth) {
    if (!route || route.length < 2) return;
    ctx.save();
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash(lineDash);
    ctx.beginPath();
    route.forEach((cell, idx) => {
      const p = cellCenter(cell.r, cell.c);
      if (idx === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
    ctx.restore();
  }

  function renderMaze(nowSec) {
    const boardW = state.boardW;
    const boardH = state.boardH;
    const maxDim = Math.max(boardW, boardH);
    const minDim = Math.min(boardW, boardH);
    ctx.clearRect(0, 0, boardW, boardH);

    // Background fill
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(0, 0, boardW, boardH);

    if (!state.maze) return;

    const { rows, cols, grid, start, goal, item } = state.maze;
    const cs = state.cellSize;
    const pad = state.pad;

    // Floor board area
    ctx.fillStyle = '#111930';
    ctx.fillRect(pad, pad, cols * cs, rows * cs);

    // Subtle blueprint tile lines
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.055)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let r = 1; r < rows; r++) {
      const y = pad + r * cs;
      ctx.moveTo(pad, y);
      ctx.lineTo(pad + cols * cs, y);
    }
    for (let c = 1; c < cols; c++) {
      const x = pad + c * cs;
      ctx.moveTo(x, pad);
      ctx.lineTo(x, pad + rows * cs);
    }
    ctx.stroke();

    // If Game Over, reveal shortest route (cyan) and item route (gold)
    if (state.mode === 'gameover') {
      drawRouteHint(state.maze.itemRoute, 'rgba(251, 191, 36, 0.65)', [6, 6], Math.max(3, cs * 0.16));
      drawRouteHint(state.maze.shortestPath, 'rgba(56, 189, 248, 0.72)', [8, 5], Math.max(3, cs * 0.14));
    }

    // Start Cell Beacon
    const sPos = cellCenter(start.r, start.c);
    const pulse = 0.5 + 0.5 * Math.sin(nowSec * 5.2);
    if (!state.isDrawing && state.mode === 'playing') {
      const ringR = cs * (0.38 + pulse * 0.16 + state.startPulseBoost * 0.2);
      ctx.save();
      ctx.strokeStyle = `rgba(52, 211, 153, ${0.55 - pulse * 0.25 + state.startPulseBoost * 0.3})`;
      ctx.lineWidth = Math.max(2, cs * 0.06);
      ctx.beginPath();
      ctx.arc(sPos.x, sPos.y, ringR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    const padBox = Math.max(9, cs * 0.4);
    ctx.save();
    ctx.fillStyle = 'rgba(16, 185, 129, 0.24)';
    ctx.strokeStyle = '#34d399';
    ctx.lineWidth = Math.max(1.6, cs * 0.055);
    ctx.beginPath();
    ctx.arc(sPos.x, sPos.y, padBox, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ecfdf5';
    ctx.font = `900 ${Math.max(11, Math.floor(cs * 0.45))}px 'JetBrains Mono', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('S', sPos.x, sPos.y + 0.5);
    ctx.restore();

    // Goal Cell Beacon
    const gPos = cellCenter(goal.r, goal.c);
    const gPulse = 0.5 + 0.5 * Math.sin(nowSec * 6.0 + 1.2);
    ctx.save();
    ctx.fillStyle = `rgba(244, 63, 94, ${0.18 + gPulse * 0.14})`;
    ctx.beginPath();
    ctx.arc(gPos.x, gPos.y, Math.max(11, cs * (0.43 + gPulse * 0.08)), 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(244, 63, 94, 0.3)';
    ctx.strokeStyle = '#fb7185';
    ctx.lineWidth = Math.max(1.6, cs * 0.06);
    ctx.beginPath();
    ctx.arc(gPos.x, gPos.y, padBox, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#fff1f2';
    ctx.font = `900 ${Math.max(11, Math.floor(cs * 0.45))}px 'JetBrains Mono', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('G', gPos.x, gPos.y + 0.5);
    ctx.restore();

    // Next-Stage Time Bonus Item on alternate route (Gold Circle ●)
    if (item) {
      const iPos = cellCenter(item.r, item.c);
      const bob = Math.sin(nowSec * 4.8) * Math.min(2.5, cs * 0.05);
      const itemColor = item.bonusSeconds === 3 ? '#f472b6' : '#fbbf24';
      const itemGlow =
        item.bonusSeconds === 3
          ? 'rgba(244, 114, 182, 0.42)'
          : 'rgba(251, 191, 36, 0.38)';

      ctx.save();
      if (state.itemCollectedInStroke) {
        // Captured hollow ring indicator
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.58)';
        ctx.lineWidth = Math.max(1.5, cs * 0.05);
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(iPos.x, iPos.y, Math.max(8, cs * 0.34), 0, Math.PI * 2);
        ctx.stroke();
      } else {
        // Radiant floating gold circle badge
        const badgeR = Math.max(11, cs * 0.41);
        ctx.fillStyle = itemGlow;
        ctx.beginPath();
        ctx.arc(iPos.x, iPos.y + bob, badgeR * (1.16 + pulse * 0.14), 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#1c1507';
        ctx.strokeStyle = itemColor;
        ctx.lineWidth = Math.max(1.8, cs * 0.065);
        ctx.beginPath();
        ctx.arc(iPos.x, iPos.y + bob, badgeR, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = itemColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (cs >= 28) {
          ctx.font = `900 ${Math.max(7, Math.floor(cs * 0.18))}px 'Noto Sans JP', sans-serif`;
          ctx.fillText('次', iPos.x, iPos.y + bob - badgeR * 0.48);
          ctx.font = `800 ${Math.max(10, Math.floor(cs * 0.31))}px 'JetBrains Mono', sans-serif`;
          ctx.fillText(`+${item.bonusSeconds}s`, iPos.x, iPos.y + bob + badgeR * 0.22);
        } else {
          ctx.font = `800 ${Math.max(10, Math.floor(cs * 0.34))}px 'JetBrains Mono', sans-serif`;
          ctx.fillText(`+${item.bonusSeconds}s`, iPos.x, iPos.y + bob + 0.5);
        }
      }
      ctx.restore();
    }

    // Current-Stage Time Recovery Items (Emerald Diamond ◆, Stage 4+)
    const healItems = state.maze.healItems || [];
    for (let idx = 0; idx < healItems.length; idx++) {
      const h = healItems[idx];
      if (h.used) continue;
      const hPos = cellCenter(h.r, h.c);
      const hBob = Math.sin(nowSec * 5.2 + idx * 1.4) * Math.min(2.5, cs * 0.05);
      const hPulse = 0.5 + 0.5 * Math.sin(nowSec * 5.6 + idx * 1.1);
      const rDia = Math.max(11.5, cs * 0.43);

      ctx.save();
      ctx.translate(hPos.x, hPos.y + hBob);

      // Soft emerald outer halo
      const haloR = rDia * (1.18 + hPulse * 0.14);
      ctx.fillStyle = 'rgba(74, 222, 128, 0.32)';
      ctx.beginPath();
      ctx.moveTo(0, -haloR);
      ctx.lineTo(haloR, 0);
      ctx.lineTo(0, haloR);
      ctx.lineTo(-haloR, 0);
      ctx.closePath();
      ctx.fill();

      // Main diamond body
      ctx.fillStyle = '#052e16';
      ctx.strokeStyle = '#4ade80';
      ctx.lineWidth = Math.max(1.8, cs * 0.065);
      ctx.beginPath();
      ctx.moveTo(0, -rDia);
      ctx.lineTo(rDia, 0);
      ctx.lineTo(0, rDia);
      ctx.lineTo(-rDia, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#bbf7d0';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (cs >= 30) {
        ctx.font = `900 ${Math.max(7, Math.floor(cs * 0.17))}px 'Noto Sans JP', sans-serif`;
        ctx.fillStyle = '#4ade80';
        ctx.fillText('今', 0, -rDia * 0.42);
        ctx.fillStyle = '#ecfdf5';
        ctx.font = `800 ${Math.max(9.5, Math.floor(cs * 0.28))}px 'JetBrains Mono', sans-serif`;
        ctx.fillText(`+${h.bonusSeconds}s`, 0, rDia * 0.18);
      } else {
        ctx.font = `800 ${Math.max(9.5, Math.floor(cs * 0.31))}px 'JetBrains Mono', sans-serif`;
        ctx.fillText(`+${h.bonusSeconds}s`, 0, 0.5);
      }
      ctx.restore();
    }

    // Dissolving lines (fade-out effect when user releases mouse/finger)
    for (const dl of state.dissolveLines) {
      const alpha = Math.max(0, dl.life / dl.maxLife);
      ctx.save();
      ctx.strokeStyle = `rgba(56, 189, 248, ${alpha * 0.7})`;
      ctx.lineWidth = Math.max(3, cs * 0.24 * alpha);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      dl.points.forEach((p, idx) => {
        if (idx === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
      ctx.restore();
    }

    // Active Drawn Path
    if (state.path.length > 0) {
      const strokeColor = state.itemCollectedInStroke ? '#fbbf24' : '#38bdf8';
      const glowColor = state.itemCollectedInStroke
        ? 'rgba(251, 191, 36, 0.65)'
        : 'rgba(56, 189, 248, 0.65)';
      const lineW = Math.max(4, cs * 0.28);

      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = Math.max(10, cs * 0.35);

      const pts = state.path.map((cell) => cellCenter(cell.r, cell.c));

      // Draw smooth rounded polyline
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = lineW;
      ctx.beginPath();
      if (pts.length === 1) {
        ctx.moveTo(pts[0].x, pts[0].y);
        ctx.lineTo(pts[0].x + 0.1, pts[0].y + 0.1);
      } else {
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length - 1; i++) {
          const midX = (pts[i].x + pts[i + 1].x) * 0.5;
          const midY = (pts[i].y + pts[i + 1].y) * 0.5;
          ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
        }
        ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
      }
      ctx.stroke();

      // Inner bright core
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(1.8, lineW * 0.32);
      ctx.stroke();

      // Tip dot
      const tip = pts[pts.length - 1];
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, Math.max(3.5, lineW * 0.55), 0, Math.PI * 2);
      ctx.fill();

      // Subtle dashed tether if pointer is currently blocked behind a wall
      if (state.isDrawing && state.pointerPos) {
        const tetherDist = Math.hypot(state.pointerPos.x - tip.x, state.pointerPos.y - tip.y);
        if (tetherDist > cs * 0.65) {
          ctx.strokeStyle = 'rgba(248, 250, 252, 0.28)';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(tip.x, tip.y);
          ctx.lineTo(state.pointerPos.x, state.pointerPos.y);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // Maze Walls
    const wallWidth = Math.max(2.2, Math.min(5.2, cs * 0.115));
    ctx.save();
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = wallWidth;
    ctx.lineCap = 'round';
    ctx.beginPath();

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = grid[r][c];
        const x = pad + c * cs;
        const y = pad + r * cs;
        if (cell.N) {
          ctx.moveTo(x, y);
          ctx.lineTo(x + cs, y);
        }
        if (cell.W) {
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + cs);
        }
        if (r === rows - 1 && cell.S) {
          ctx.moveTo(x, y + cs);
          ctx.lineTo(x + cs, y + cs);
        }
        if (c === cols - 1 && cell.E) {
          ctx.moveTo(x + cs, y);
          ctx.lineTo(x + cs, y + cs);
        }
      }
    }
    ctx.stroke();
    ctx.restore();

    // Start Intro Spotlight (briefly highlights S right after stage starts)
    if (state.mode === 'playing' && !state.isDrawing && state.startIntroTimer > 0) {
      const p = 1 - state.startIntroTimer / START_INTRO_DURATION; // 0 -> 1
      const fade = Math.min(1, state.startIntroTimer / 0.32);

      ctx.save();

      // 1. Bright radial emerald spotlight around S
      const glowR = Math.max(cs * 2.5, 78);
      const radGrad = ctx.createRadialGradient(sPos.x, sPos.y, cs * 0.15, sPos.x, sPos.y, glowR);
      radGrad.addColorStop(0, `rgba(52, 211, 153, ${0.46 * fade})`);
      radGrad.addColorStop(0.5, `rgba(16, 185, 129, ${0.18 * fade})`);
      radGrad.addColorStop(1, 'rgba(16, 185, 129, 0)');
      ctx.fillStyle = radGrad;
      ctx.beginPath();
      ctx.arc(sPos.x, sPos.y, glowR, 0, Math.PI * 2);
      ctx.fill();

      // 2. Two expanding radar shockwave rings
      for (let w = 0; w < 2; w++) {
        const waveP = (p * 1.45 - w * 0.34);
        if (waveP > 0 && waveP < 1) {
          const easeOut = 1 - Math.pow(1 - waveP, 2.2);
          const ringR = Math.max(cs * 0.45, 12) + easeOut * Math.max(cs * 2.2, 66);
          const ringAlpha = (1 - waveP) * 0.9 * fade;
          ctx.strokeStyle = `rgba(110, 231, 183, ${ringAlpha})`;
          ctx.lineWidth = Math.max(2.2, 4.2 * (1 - waveP));
          ctx.beginPath();
          ctx.arc(sPos.x, sPos.y, ringR, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // 3. Contracting target reticle (4 crisp corner brackets locking onto S)
      const lockEase = 1 - Math.pow(1 - Math.min(1, p * 2.1), 3);
      const boxHalf = Math.max(cs * 0.56, 14) + (1 - lockEase) * Math.max(cs * 1.2, 34);
      const arm = Math.max(7, Math.min(14, cs * 0.32));
      ctx.strokeStyle = `rgba(236, 253, 245, ${0.95 * fade})`;
      ctx.lineWidth = 2.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      // Top-left
      ctx.moveTo(sPos.x - boxHalf, sPos.y - boxHalf + arm);
      ctx.lineTo(sPos.x - boxHalf, sPos.y - boxHalf);
      ctx.lineTo(sPos.x - boxHalf + arm, sPos.y - boxHalf);
      // Top-right
      ctx.moveTo(sPos.x + boxHalf - arm, sPos.y - boxHalf);
      ctx.lineTo(sPos.x + boxHalf, sPos.y - boxHalf);
      ctx.lineTo(sPos.x + boxHalf, sPos.y - boxHalf + arm);
      // Bottom-right
      ctx.moveTo(sPos.x + boxHalf, sPos.y + boxHalf - arm);
      ctx.lineTo(sPos.x + boxHalf, sPos.y + boxHalf);
      ctx.lineTo(sPos.x + boxHalf - arm, sPos.y + boxHalf);
      // Bottom-left
      ctx.moveTo(sPos.x - boxHalf + arm, sPos.y + boxHalf);
      ctx.lineTo(sPos.x - boxHalf, sPos.y + boxHalf);
      ctx.lineTo(sPos.x - boxHalf, sPos.y + boxHalf - arm);
      ctx.stroke();

      // 4. Temporarily enlarged, glowing S core on top of walls
      const popScale = 1 + 0.34 * (1 - Math.min(1, p * 1.5));
      const popR = padBox * popScale;
      ctx.shadowColor = 'rgba(52, 211, 153, 0.95)';
      ctx.shadowBlur = 18;
      ctx.fillStyle = `rgba(16, 185, 129, ${0.92 * fade})`;
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.95 * fade})`;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(sPos.x, sPos.y, popR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.shadowBlur = 0;
      ctx.fillStyle = `rgba(255, 255, 255, ${fade})`;
      ctx.font = `900 ${Math.max(12, Math.floor(cs * 0.46 * popScale))}px 'JetBrains Mono', sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('S', sPos.x, sPos.y + 0.5);

      // 5. Floating "START!" badge anchored inward so it never clips outside canvas
      const dirX = sPos.x < boardW * 0.5 ? 1 : -1;
      const dirY = sPos.y < boardH * 0.5 ? 1 : -1;
      const pillW = 74;
      const pillH = 24;
      const labelX = Math.max(
        pillW * 0.5 + 8,
        Math.min(boardW - pillW * 0.5 - 8, sPos.x + dirX * (Math.max(cs * 0.85, 24) + pillW * 0.38))
      );
      const labelY = Math.max(
        pillH * 0.5 + 8,
        Math.min(boardH - pillH * 0.5 - 8, sPos.y + dirY * Math.max(cs * 0.72, 24))
      );

      ctx.globalAlpha = fade;
      ctx.fillStyle = '#052e16';
      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(labelX - pillW * 0.5, labelY - pillH * 0.5, pillW, pillH, 999);
      } else {
        ctx.rect(labelX - pillW * 0.5, labelY - pillH * 0.5, pillW, pillH);
      }
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#ecfdf5';
      ctx.font = `900 12px 'JetBrains Mono', sans-serif`;
      ctx.fillText('START!', labelX, labelY + 0.5);

      ctx.restore();
    }

    // Full-board Shockwaves & Starburst Rays on Time Item Pickup
    for (const sw of state.shockwaves) {
      const p = 1 - sw.life / sw.maxLife; // 0 -> 1
      const easeOut = 1 - Math.pow(1 - p, 2.6);
      const fade = Math.max(0, 1 - p);

      ctx.save();

      // 1. Primary expanding shockwave ring across the whole board
      const r1 = easeOut * maxDim * 1.15;
      ctx.strokeStyle = sw.primaryColor;
      ctx.globalAlpha = fade * 0.72;
      ctx.lineWidth = Math.max(2, 10 * fade);
      ctx.shadowColor = sw.primaryColor;
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, r1, 0, Math.PI * 2);
      ctx.stroke();

      // 2. Secondary trailing ring
      if (p > 0.12) {
        const p2 = (p - 0.12) / 0.88;
        const r2 = (1 - Math.pow(1 - p2, 2.2)) * maxDim * 0.92;
        ctx.strokeStyle = sw.secondaryColor;
        ctx.globalAlpha = Math.max(0, (1 - p2) * 0.55);
        ctx.lineWidth = Math.max(1.5, 5.5 * (1 - p2));
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(sw.x, sw.y, r2, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 3. Radial speed-light rays shooting outward (thin & crisp so walls remain clear)
      ctx.shadowBlur = 0;
      ctx.lineCap = 'round';
      const innerR = Math.max(12, easeOut * maxDim * 0.42);
      const outerR = innerR + (1 - p * 0.45) * maxDim * 0.34;
      ctx.strokeStyle = sw.secondaryColor;
      ctx.globalAlpha = fade * 0.65;
      ctx.lineWidth = Math.max(1.2, 3.2 * fade);
      ctx.beginPath();
      for (const ang of sw.rayAngles) {
        ctx.moveTo(sw.x + Math.cos(ang) * innerR, sw.y + Math.sin(ang) * innerR);
        ctx.lineTo(sw.x + Math.cos(ang) * outerR, sw.y + Math.sin(ang) * outerR);
      }
      ctx.stroke();

      // 4. Translucent giant board-center celebration pulse (low alpha so corridors stay clear)
      const scale = 0.86 + easeOut * 0.34;
      ctx.translate(boardW * 0.5, boardH * 0.5);
      ctx.scale(scale, scale);
      ctx.globalAlpha = fade * 0.24;
      ctx.font = `900 ${Math.floor(minDim * 0.14)}px 'JetBrains Mono', sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = sw.primaryColor;
      ctx.fillText(sw.label, 0, 0);

      ctx.restore();
    }

    // Particles
    for (const p of state.particles) {
      const alpha = Math.max(0, p.life / p.maxLife);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius * alpha + 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Floating pickup popups
    for (const ft of state.floatingTexts) {
      const progress = 1 - ft.life / ft.maxLife;
      const alpha = Math.max(0, Math.min(1, ft.life / (ft.maxLife * 0.45)));
      const yOffset = progress * 28;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = `900 ${Math.max(13, Math.min(18, Math.floor(cs * 0.42)))}px 'Noto Sans JP', 'JetBrains Mono', sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(7, 11, 20, 0.9)';
      ctx.strokeText(ft.text, ft.x, ft.y - yOffset);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x, ft.y - yOffset);
      ctx.restore();
    }
  }

  // ---- Main Animation Loop ----
  let lastFrameTime = performance.now();

  function tick(now) {
    const dt = Math.min(0.05, (now - lastFrameTime) / 1000);
    lastFrameTime = now;

    // Timer update
    if (state.mode === 'playing') {
      if (state.healFlashTimer > 0) {
        state.healFlashTimer = Math.max(0, state.healFlashTimer - dt);
      }

      if (state.timeFreezeTimer > 0) {
        // Pause countdown briefly (~0.3s) while keeping controls 100% responsive
        state.timeFreezeTimer = Math.max(0, state.timeFreezeTimer - dt);
        if (state.timeFreezeTimer === 0) {
          state.timeFreezeKind = null;
        }
        updateTimerHud();
      } else {
        state.timeLeft -= dt;

        // Urgent countdown audio tick for last 2 seconds
        if (state.timeLeft <= 2.0 && state.timeLeft > 0) {
          const tickBucket = Math.ceil(state.timeLeft * 2); // every 0.5s
          if (tickBucket !== state.lastUrgentSecond) {
            state.lastUrgentSecond = tickBucket;
            sound.playUrgentTick(state.timeLeft <= 1.0);
          }
        }

        if (state.timeLeft <= 0) {
          handleGameOver();
        } else {
          updateTimerHud();
        }
      }
    }

    // Decay start intro spotlight & pulse boost
    if (state.startIntroTimer > 0) {
      state.startIntroTimer = Math.max(0, state.startIntroTimer - dt);
    }
    if (state.startPulseBoost > 0) {
      state.startPulseBoost = Math.max(0, state.startPulseBoost - dt * 2.4);
    }

    // Update shockwaves
    for (let i = state.shockwaves.length - 1; i >= 0; i--) {
      state.shockwaves[i].life -= dt;
      if (state.shockwaves[i].life <= 0) state.shockwaves.splice(i, 1);
    }

    // Update particles
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.92;
      p.vy *= 0.92;
      p.life -= dt;
      if (p.life <= 0) state.particles.splice(i, 1);
    }

    // Update dissolving lines
    for (let i = state.dissolveLines.length - 1; i >= 0; i--) {
      state.dissolveLines[i].life -= dt;
      if (state.dissolveLines[i].life <= 0) state.dissolveLines.splice(i, 1);
    }

    // Update floating texts
    for (let i = state.floatingTexts.length - 1; i >= 0; i--) {
      state.floatingTexts[i].life -= dt;
      if (state.floatingTexts[i].life <= 0) state.floatingTexts.splice(i, 1);
    }

    renderMaze(now / 1000);
    requestAnimationFrame(tick);
  }

  // ---- Button & Keyboard Wiring ----
  dom.btnStart.addEventListener('click', () => {
    sound.ensureContext();
    startNewGame();
  });

  dom.btnDiffNormal.addEventListener('click', () => {
    sound.ensureContext();
    setDifficulty('normal', true);
  });

  dom.btnDiffHard.addEventListener('click', () => {
    sound.ensureContext();
    setDifficulty('hard', true);
  });

  dom.btnRetry.addEventListener('click', () => {
    sound.ensureContext();
    startNewGame();
  });

  dom.btnSwitchDifficulty.addEventListener('click', () => {
    sound.ensureContext();
    const nextDiff = state.difficulty === 'normal' ? 'hard' : 'normal';
    setDifficulty(nextDiff, false);
    startNewGame();
  });

  dom.btnPeekMaze.addEventListener('click', () => {
    state.peekingMaze = true;
    dom.resultModal.classList.add('hidden');
    dom.btnBackToResult.classList.remove('hidden');
    showToast('青破線：最短ルート ／ 黄破線：アイテムルート', '', 2600);
  });

  dom.btnBackToResult.addEventListener('click', () => {
    state.peekingMaze = false;
    dom.btnBackToResult.classList.add('hidden');
    dom.resultModal.classList.remove('hidden');
  });

  dom.btnTitleRanks.addEventListener('click', openRanksModal);
  dom.btnRanksHud.addEventListener('click', openRanksModal);
  dom.btnCloseRanks.addEventListener('click', () => {
    dom.ranksModal.classList.add('hidden');
  });

  dom.ranksModal.addEventListener('click', (e) => {
    if (e.target === dom.ranksModal) {
      dom.ranksModal.classList.add('hidden');
    }
  });

  dom.btnSound.addEventListener('click', () => {
    sound.toggleMute();
    updateSoundButton();
    if (!sound.muted) sound.playStartStroke();
  });

  // Suppress browser-level horizontal swipe navigation / pull-to-refresh on touch canvas
  dom.canvas.addEventListener('touchmove', (e) => {
    if (state.mode === 'playing') e.preventDefault();
  }, { passive: false });

  // Fullscreen toggle (helps prevent Android edge-back gestures in Chrome)
  const canFullscreen =
    !!(document.fullscreenEnabled || document.webkitFullscreenEnabled) &&
    !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);

  function updateFullscreenButton() {
    if (!dom.btnFullscreen || !canFullscreen) return;
    const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
    dom.btnFullscreen.textContent = isFs ? '🗗' : '⛶';
    dom.btnFullscreen.title = isFs ? 'フルスクリーン解除' : 'フルスクリーン（Android誤戻る防止）';
  }

  if (dom.btnFullscreen && canFullscreen) {
    dom.btnFullscreen.classList.remove('hidden');
    updateFullscreenButton();
    dom.btnFullscreen.addEventListener('click', () => {
      const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
      if (!isFs) {
        const req =
          document.documentElement.requestFullscreen ||
          document.documentElement.webkitRequestFullscreen;
        if (req) Promise.resolve(req.call(document.documentElement)).catch(() => {});
      } else {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) Promise.resolve(exit.call(document)).catch(() => {});
      }
    });
    document.addEventListener('fullscreenchange', () => {
      updateFullscreenButton();
      handleViewportChange();
    });
    document.addEventListener('webkitfullscreenchange', () => {
      updateFullscreenButton();
      handleViewportChange();
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !dom.ranksModal.classList.contains('hidden')) {
      dom.ranksModal.classList.add('hidden');
      return;
    }
    if (e.code === 'Space' || e.code === 'Enter' || e.key === 'r' || e.key === 'R') {
      if (!dom.ranksModal.classList.contains('hidden')) return;
      if (state.mode === 'title' || (state.mode === 'gameover' && !state.peekingMaze)) {
        e.preventDefault();
        sound.ensureContext();
        startNewGame();
      }
    }
  });

  // ---- Bootstrap ----
  function handleViewportChange() {
    const prevAR = state.arenaH > 0 ? state.arenaW / state.arenaH : 1;
    const nextAR = getPreferredAspectRatio();
    if (state.mode === 'title' && state.maze && Math.abs(nextAR - prevAR) > 0.22) {
      state.maze = generateMaze(1, nextAR, state.difficulty);
      updateHudStatic();
    }
    resizeCanvas();
  }

  const ro = new ResizeObserver(() => handleViewportChange());
  ro.observe(dom.boardFrame.parentElement);
  window.addEventListener('resize', handleViewportChange);

  // Sync saved difficulty & generate an attractive preview maze matching screen shape
  setDifficulty(state.difficulty, true);
  updateSoundButton();
  updateTimerHud();
  resizeCanvas();
  requestAnimationFrame(tick);
})(window);
