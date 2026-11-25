(function (global) {
  'use strict';

  const { ACTIVITIES, PERIODS, PRESETS, getActivityById } = global.DailyScheduleData;

  const STORAGE_KEY = 'kuina_daily_schedule_v1';
  const ROOM_STORAGE_KEY = 'kuina_daily_schedule_room_v1';
  const ROOM_ID_RE = /^[A-Za-z0-9_-]{10,48}$/;
  const POLL_INTERVAL_MS = 8000;

  const dom = {
    liveClock: document.getElementById('liveClock'),
    printTitle: document.getElementById('printTitle'),
    nextCallout: document.getElementById('nextCallout'),
    nextImg: document.getElementById('nextImg'),
    nextTime: document.getElementById('nextTime'),
    nextLabel: document.getElementById('nextLabel'),
    progressText: document.getElementById('progressText'),
    progressFill: document.getElementById('progressFill'),

    workspaceLayout: document.getElementById('workspaceLayout'),
    lists: {
      morning: document.getElementById('list-morning'),
      afternoon: document.getElementById('list-afternoon'),
      evening: document.getElementById('list-evening')
    },

    pickerTimeInput: document.getElementById('pickerTimeInput'),
    btnClearPickerTime: document.getElementById('btnClearPickerTime'),
    pickerSectionTitle: document.getElementById('pickerSectionTitle'),
    btnToggleAllCards: document.getElementById('btnToggleAllCards'),
    pickerGrid: document.getElementById('pickerGrid'),

    customForm: document.getElementById('customForm'),
    customLabel: document.getElementById('customLabel'),
    customTime: document.getElementById('customTime'),
    customIconSelect: document.getElementById('customIconSelect'),
    customNote: document.getElementById('customNote'),

    btnSortTime: document.getElementById('btnSortTime'),
    btnResetChecks: document.getElementById('btnResetChecks'),
    btnPrint: document.getElementById('btnPrint'),
    btnLoadPreset: document.getElementById('btnLoadPreset'),
    btnClearAll: document.getElementById('btnClearAll'),
    toastBanner: document.getElementById('toastBanner'),

    // Sync UI
    btnSyncOpen: document.getElementById('btnSyncOpen'),
    syncBtnLabel: document.getElementById('syncBtnLabel'),
    syncModal: document.getElementById('syncModal'),
    syncSetupView: document.getElementById('syncSetupView'),
    syncActiveView: document.getElementById('syncActiveView'),
    btnCreateFamily: document.getElementById('btnCreateFamily'),
    joinFamilyForm: document.getElementById('joinFamilyForm'),
    joinFamilyInput: document.getElementById('joinFamilyInput'),
    syncLastText: document.getElementById('syncLastText'),
    syncEditUrl: document.getElementById('syncEditUrl'),
    syncKidUrl: document.getElementById('syncKidUrl'),
    btnCopyEditUrl: document.getElementById('btnCopyEditUrl'),
    btnCopyKidUrl: document.getElementById('btnCopyKidUrl'),
    btnSyncNow: document.getElementById('btnSyncNow'),
    btnLeaveFamily: document.getElementById('btnLeaveFamily')
  };

  let uidSeq = 1;
  function makeUid() {
    return 'item_' + Date.now().toString(36) + '_' + (uidSeq++);
  }

  function clonePreset(slotName) {
    const src = PRESETS[slotName] || PRESETS.weekday;
    return src.map(function (item) {
      return {
        uid: makeUid(),
        period: item.period,
        activityId: item.activityId,
        time: item.time || '',
        label: item.label,
        note: item.note || '',
        done: false
      };
    });
  }

  // Gentle chime using Web Audio API (no external audio files)
  let audioCtx = null;
  function playSoftChime(isComplete) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioCtx) audioCtx = new AudioCtx();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const notes = isComplete ? [523.25, 659.25, 783.99] : [440];
      notes.forEach(function (freq, idx) {
        const now = audioCtx.currentTime + idx * 0.065;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(0.09, now + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.22);
      });
    } catch (_) {}
  }

  const state = {
    slot: 'weekday', // 'weekday' | 'holiday'
    mode: 'edit', // 'edit' | 'kid'
    pickerPeriod: 'morning', // 'morning' | 'afternoon' | 'evening'
    showAllCards: false,
    schedules: {
      weekday: clonePreset('weekday'),
      holiday: clonePreset('holiday')
    },
    roomId: null,
    cloudUpdatedAt: 0,
    cloudSaving: false,
    cloudSaveTimer: null,
    pollTimer: null,
    toastTimer: null
  };

  function loadStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.schedules) {
        if (Array.isArray(parsed.schedules.weekday)) {
          state.schedules.weekday = parsed.schedules.weekday;
        }
        if (Array.isArray(parsed.schedules.holiday)) {
          state.schedules.holiday = parsed.schedules.holiday;
        }
      }
      if (parsed && (parsed.slot === 'weekday' || parsed.slot === 'holiday')) {
        state.slot = parsed.slot;
      }
    } catch (_) {}
  }

  function saveStorage(skipCloudPush) {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          slot: state.slot,
          schedules: state.schedules
        })
      );
    } catch (_) {}

    if (!skipCloudPush && state.roomId) {
      scheduleCloudPush();
    }
  }

  // ---- Family Cloud Sync (Cloudflare Workers + Durable Objects) ----
  function buildShareUrl(roomId, kidMode) {
    const u = new URL(window.location.href);
    u.search = '';
    u.hash = '';
    u.searchParams.set('family', roomId);
    if (kidMode) u.searchParams.set('mode', 'kid');
    return u.toString();
  }

  function updateBrowserUrlRoom(roomId) {
    try {
      const u = new URL(window.location.href);
      if (roomId) {
        u.searchParams.set('family', roomId);
      } else {
        u.searchParams.delete('family');
      }
      window.history.replaceState({}, '', u.toString());
    } catch (_) {}
  }

  function persistRoomId(roomId) {
    state.roomId = roomId || null;
    try {
      if (roomId) {
        localStorage.setItem(ROOM_STORAGE_KEY, roomId);
      } else {
        localStorage.removeItem(ROOM_STORAGE_KEY);
      }
    } catch (_) {}
    updateBrowserUrlRoom(state.roomId);
    updateSyncUI();
  }

  function formatSyncTimestamp(ts) {
    if (!ts) return '自動保存オン';
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return 'さいごの同期 ' + hh + ':' + mm + ':' + ss;
  }

  function updateSyncUI() {
    if (!dom.btnSyncOpen) return;
    const active = Boolean(state.roomId);
    dom.btnSyncOpen.classList.toggle('is-synced', active && !state.cloudSaving);
    dom.btnSyncOpen.classList.toggle('is-saving', active && state.cloudSaving);

    if (!active) {
      dom.syncBtnLabel.textContent = '☁️ かぞく同期';
    } else if (state.cloudSaving) {
      dom.syncBtnLabel.textContent = '☁️ 保存中...';
    } else {
      dom.syncBtnLabel.textContent = '☁️ 同期中';
    }

    dom.syncSetupView.classList.toggle('hidden', active);
    dom.syncActiveView.classList.toggle('hidden', !active);
    if (active) {
      dom.syncEditUrl.value = buildShareUrl(state.roomId, false);
      dom.syncKidUrl.value = buildShareUrl(state.roomId, true);
      dom.syncLastText.textContent = state.cloudSaving
        ? 'クラウドへ保存中...'
        : formatSyncTimestamp(state.cloudUpdatedAt);
    }
  }

  function scheduleCloudPush() {
    if (!state.roomId) return;
    state.cloudSaving = true;
    updateSyncUI();
    if (state.cloudSaveTimer) clearTimeout(state.cloudSaveTimer);
    state.cloudSaveTimer = setTimeout(function () {
      state.cloudSaveTimer = null;
      pushToCloud();
    }, 450);
  }

  async function pushToCloud() {
    if (!state.roomId) return;
    try {
      const res = await fetch('/api/schedule/' + encodeURIComponent(state.roomId), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slot: state.slot,
          schedules: state.schedules
        })
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (data && data.updatedAt) {
        state.cloudUpdatedAt = Number(data.updatedAt) || Date.now();
      }
    } catch (_) {
      showToast('クラウド保存に失敗しました（端末には保存済み）');
    } finally {
      state.cloudSaving = false;
      updateSyncUI();
    }
  }

  async function pullFromCloud(showFeedback) {
    if (!state.roomId || state.cloudSaving || state.cloudSaveTimer) return false;
    try {
      const res = await fetch('/api/schedule/' + encodeURIComponent(state.roomId), {
        cache: 'no-store'
      });
      if (res.status === 404) {
        if (showFeedback) showToast('指定されたかぞく予定表が見つかりませんでした');
        return false;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const serverTs = Number(data.updatedAt) || 0;
      if (serverTs > state.cloudUpdatedAt || showFeedback) {
        state.cloudUpdatedAt = serverTs;
        if (data.schedules && typeof data.schedules === 'object') {
          if (Array.isArray(data.schedules.weekday)) {
            state.schedules.weekday = data.schedules.weekday;
          }
          if (Array.isArray(data.schedules.holiday)) {
            state.schedules.holiday = data.schedules.holiday;
          }
        }
        if (data.slot === 'weekday' || data.slot === 'holiday') {
          state.slot = data.slot;
          document.querySelectorAll('[data-slot]').forEach(function (btn) {
            const active = btn.getAttribute('data-slot') === state.slot;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', String(active));
          });
        }
        saveStorage(true);
        renderBoard();
        updateSyncUI();
        if (showFeedback) showToast('クラウドから最新の予定表を読み込みました');
      }
      return true;
    } catch (_) {
      if (showFeedback) showToast('同期サーバーに接続できませんでした');
      return false;
    }
  }

  async function createFamilyRoom() {
    dom.btnCreateFamily.disabled = true;
    try {
      const res = await fetch('/api/schedule/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slot: state.slot,
          schedules: state.schedules
        })
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (!data || !data.roomId) throw new Error('invalid_response');
      state.cloudUpdatedAt = Number(data.updatedAt) || Date.now();
      persistRoomId(data.roomId);
      startPolling();
      showToast('かぞく専用URLを発行しました！');
    } catch (_) {
      showToast('URL発行に失敗しました。しばらくしてからお試しください');
    } finally {
      dom.btnCreateFamily.disabled = false;
    }
  }

  function extractRoomIdFromInput(raw) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return null;
    if (ROOM_ID_RE.test(trimmed)) return trimmed;
    try {
      const parsed = new URL(trimmed);
      const fam = parsed.searchParams.get('family');
      if (fam && ROOM_ID_RE.test(fam)) return fam;
    } catch (_) {}
    const m = trimmed.match(/family=([A-Za-z0-9_-]{10,48})/);
    return m ? m[1] : null;
  }

  async function copyText(text, okMsg) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const tmp = document.createElement('textarea');
        tmp.value = text;
        document.body.appendChild(tmp);
        tmp.select();
        document.execCommand('copy');
        document.body.removeChild(tmp);
      }
      showToast(okMsg);
    } catch (_) {
      showToast('コピーできませんでした。URLを選択してコピーしてください');
    }
  }

  function startPolling() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    if (!state.roomId) return;
    state.pollTimer = setInterval(function () {
      if (!document.hidden && state.roomId) {
        pullFromCloud(false);
      }
    }, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  function openSyncModal() {
    updateSyncUI();
    dom.syncModal.classList.remove('hidden');
  }

  function closeSyncModal() {
    dom.syncModal.classList.add('hidden');
  }

  function currentList() {
    return state.schedules[state.slot];
  }

  function showToast(msg) {
    dom.toastBanner.textContent = msg;
    dom.toastBanner.classList.remove('hidden');
    if (state.toastTimer) clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () {
      dom.toastBanner.classList.add('hidden');
    }, 1800);
  }

  function updateClock() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    dom.liveClock.textContent = hh + ':' + mm;
  }

  function formatDisplayTime(t) {
    if (!t) return 'じかん なし';
    const parts = t.split(':');
    if (parts.length !== 2) return t;
    return Number(parts[0]) + ':' + parts[1];
  }

  function renderStatusStrip() {
    const items = currentList();
    const total = items.length;
    const doneCount = items.filter(function (i) { return i.done; }).length;
    const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

    dom.progressText.textContent = 'できた：' + doneCount + ' / ' + total;
    dom.progressFill.style.width = pct + '%';

    // Find first incomplete item in morning -> afternoon -> evening order
    const ordered = getOrderedItems();
    const nextIdx = ordered.findIndex(function (i) { return !i.done; });
    const nextItem = nextIdx !== -1 ? ordered[nextIdx] : null;
    const tagEl = dom.nextCallout.querySelector('.next-tag');

    if (total === 0) {
      dom.nextCallout.classList.remove('all-done');
      tagEl.textContent = 'よてい なし';
      dom.nextImg.src = getActivityById('wakeup').image;
      dom.nextTime.textContent = '--:--';
      dom.nextLabel.textContent = 'みぎ の カードから たしてね';
    } else if (!nextItem) {
      dom.nextCallout.classList.add('all-done');
      tagEl.textContent = '💮 ぜんぶ できた！';
      dom.nextImg.src = getActivityById('sleep').image;
      dom.nextTime.textContent = 'すごーい！';
      dom.nextLabel.textContent = 'きょう の よてい クリア！';
    } else {
      const act = getActivityById(nextItem.activityId);
      dom.nextCallout.classList.remove('all-done');
      tagEl.textContent = '👉 つぎは ' + (nextIdx + 1) + 'ばん！';
      dom.nextImg.src = act.image;
      dom.nextTime.textContent = nextItem.time ? formatDisplayTime(nextItem.time) : 'つぎの こうどう';
      dom.nextLabel.textContent = nextItem.label;
    }

    return nextItem ? nextItem.uid : null;
  }

  function getOrderedItems() {
    const items = currentList();
    const out = [];
    PERIODS.forEach(function (p) {
      items.forEach(function (item) {
        if (item.period === p.id) out.push(item);
      });
    });
    return out;
  }

  function renderBoard() {
    const nextUid = renderStatusStrip();
    const items = currentList();
    let seqNum = 0;

    PERIODS.forEach(function (p) {
      const container = dom.lists[p.id];
      container.innerHTML = '';

      const periodItems = items.filter(function (i) {
        return i.period === p.id;
      });

      if (periodItems.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-period';
        empty.textContent = p.label + ' の よてい は まだ ありません';
        container.appendChild(empty);
        return;
      }

      periodItems.forEach(function (item, localIdx) {
        seqNum += 1;
        const stepNumber = seqNum;
        const act = getActivityById(item.activityId);
        const card = document.createElement('article');
        card.className =
          'sched-card' +
          (item.done ? ' is-done' : '') +
          (item.uid === nextUid ? ' is-next' : '');
        card.setAttribute('data-uid', item.uid);

        // Sequential step number badge
        const numBadge = document.createElement('div');
        numBadge.className = 'step-num mono';
        numBadge.textContent = String(stepNumber);
        numBadge.setAttribute('aria-label', stepNumber + 'ばんめ');

        // Check button
        const checkBtn = document.createElement('button');
        checkBtn.type = 'button';
        checkBtn.className = 'check-btn';
        checkBtn.setAttribute('aria-label', item.label + ' の できたチェック');
        checkBtn.setAttribute('aria-pressed', String(item.done));
        checkBtn.textContent = item.done ? '✓' : '';
        checkBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          toggleDone(item.uid);
        });

        // Illustration
        const img = document.createElement('img');
        img.className = 'sched-img';
        img.src = act.image;
        img.alt = item.label;
        img.loading = 'lazy';

        // Center info (Time input + Label + Note)
        const main = document.createElement('div');
        main.className = 'sched-main';

        const topRow = document.createElement('div');
        topRow.className = 'sched-top-row';

        const timeDisplay = document.createElement('span');
        timeDisplay.className = 'sched-time-display mono';
        timeDisplay.textContent = formatDisplayTime(item.time);

        const timeEdit = document.createElement('input');
        timeEdit.type = 'time';
        timeEdit.className = 'time-input sched-time-edit';
        timeEdit.value = item.time || '';
        timeEdit.setAttribute('aria-label', item.label + ' の じかん');
        timeEdit.addEventListener('click', function (e) {
          e.stopPropagation();
        });
        timeEdit.addEventListener('change', function () {
          item.time = timeEdit.value;
          timeDisplay.textContent = formatDisplayTime(item.time);
          saveStorage();
          renderStatusStrip();
        });

        topRow.appendChild(timeDisplay);
        topRow.appendChild(timeEdit);

        if (item.uid === nextUid) {
          const badge = document.createElement('span');
          badge.className = 'next-inline-badge';
          badge.textContent = 'つぎ！';
          topRow.appendChild(badge);
        }

        const titleEl = document.createElement('div');
        titleEl.className = 'sched-label';
        titleEl.textContent = item.label;

        main.appendChild(topRow);
        main.appendChild(titleEl);

        if (item.note) {
          const noteEl = document.createElement('div');
          noteEl.className = 'sched-note';
          noteEl.textContent = item.note;
          main.appendChild(noteEl);
        }

        // Right edit controls (move up/down, delete)
        const controls = document.createElement('div');
        controls.className = 'card-edit-controls';

        const upBtn = document.createElement('button');
        upBtn.type = 'button';
        upBtn.className = 'icon-mini-btn';
        upBtn.textContent = '↑';
        upBtn.title = 'うえへ';
        upBtn.disabled = localIdx === 0;
        upBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          moveItem(item.uid, -1);
        });

        const downBtn = document.createElement('button');
        downBtn.type = 'button';
        downBtn.className = 'icon-mini-btn';
        downBtn.textContent = '↓';
        downBtn.title = 'したへ';
        downBtn.disabled = localIdx === periodItems.length - 1;
        downBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          moveItem(item.uid, 1);
        });

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'icon-mini-btn is-delete';
        delBtn.textContent = '✕';
        delBtn.title = 'けす';
        delBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          deleteItem(item.uid);
        });

        controls.appendChild(upBtn);
        controls.appendChild(downBtn);
        controls.appendChild(delBtn);

        // In kid mode, tapping anywhere on the card toggles Done
        card.addEventListener('click', function () {
          if (state.mode === 'kid') {
            toggleDone(item.uid);
          }
        });

        card.appendChild(numBadge);
        card.appendChild(checkBtn);
        card.appendChild(img);
        card.appendChild(main);
        card.appendChild(controls);
        container.appendChild(card);
      });
    });

    dom.printTitle.textContent =
      'いちにちの よていひょう（' +
      (state.slot === 'weekday' ? 'がっこうの日' : 'おやすみの日') +
      '）';
  }

  function renderPicker() {
    const periodObj =
      PERIODS.find(function (p) { return p.id === state.pickerPeriod; }) || PERIODS[0];

    document.querySelectorAll('[data-picker-period]').forEach(function (btn) {
      const active = btn.getAttribute('data-picker-period') === state.pickerPeriod;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', String(active));
    });

    dom.pickerSectionTitle.textContent = state.showAllCards
      ? 'すべての カード（' + ACTIVITIES.length + 'しゅるい）'
      : periodObj.icon + ' ' + periodObj.label + ' の おすすめ';
    dom.btnToggleAllCards.textContent = state.showAllCards ? 'おすすめ だけ' : 'ぜんぶ みる';

    // Put period-recommended activities first in easy-to-reach positions
    let list;
    if (state.showAllCards) {
      const recSet = new Set(periodObj.recommended);
      const recItems = periodObj.recommended.map(getActivityById);
      const others = ACTIVITIES.filter(function (a) { return !recSet.has(a.id); });
      list = recItems.concat(others);
    } else {
      list = periodObj.recommended.map(getActivityById);
    }

    dom.pickerGrid.innerHTML = '';
    list.forEach(function (act) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pick-item';

      const img = document.createElement('img');
      img.src = act.image;
      img.alt = '';
      img.loading = 'lazy';

      const label = document.createElement('span');
      label.textContent = act.label;

      btn.appendChild(img);
      btn.appendChild(label);
      btn.addEventListener('click', function () {
        addActivity(act);
      });

      dom.pickerGrid.appendChild(btn);
    });
  }

  function populateCustomIcons() {
    dom.customIconSelect.innerHTML = '';
    ACTIVITIES.forEach(function (act) {
      const opt = document.createElement('option');
      opt.value = act.id;
      opt.textContent = act.label;
      dom.customIconSelect.appendChild(opt);
    });
  }

  function addActivity(act) {
    const chosenTime =
      dom.pickerTimeInput.value ||
      (act.defaultTimes && act.defaultTimes[state.pickerPeriod]) ||
      '';

    currentList().push({
      uid: makeUid(),
      period: state.pickerPeriod,
      activityId: act.id,
      time: chosenTime,
      label: act.label,
      note: '',
      done: false
    });

    saveStorage();
    renderBoard();
    playSoftChime(false);
    showToast('「' + act.label + '」を たしました！');
  }

  function toggleDone(uid) {
    const item = currentList().find(function (i) { return i.uid === uid; });
    if (!item) return;
    item.done = !item.done;
    saveStorage();
    renderBoard();
    if (item.done) playSoftChime(true);
  }

  function moveItem(uid, delta) {
    const items = currentList();
    const target = items.find(function (i) { return i.uid === uid; });
    if (!target) return;

    // Collect indices belonging to the same period
    const indices = [];
    items.forEach(function (it, idx) {
      if (it.period === target.period) indices.push(idx);
    });

    const pos = indices.indexOf(items.indexOf(target));
    const swapPos = pos + delta;
    if (swapPos < 0 || swapPos >= indices.length) return;

    const iA = indices[pos];
    const iB = indices[swapPos];
    const tmp = items[iA];
    items[iA] = items[iB];
    items[iB] = tmp;

    saveStorage();
    renderBoard();
  }

  function deleteItem(uid) {
    const list = currentList();
    const idx = list.findIndex(function (i) { return i.uid === uid; });
    if (idx === -1) return;
    list.splice(idx, 1);
    saveStorage();
    renderBoard();
  }

  function sortByTime() {
    const periodOrder = { morning: 0, afternoon: 1, evening: 2 };
    currentList().sort(function (a, b) {
      if (a.period !== b.period) {
        return periodOrder[a.period] - periodOrder[b.period];
      }
      const ta = a.time || '99:99';
      const tb = b.time || '99:99';
      return ta.localeCompare(tb);
    });
    saveStorage();
    renderBoard();
    showToast('じかん じゅん に ならべかえました');
  }

  function setMode(nextMode) {
    state.mode = nextMode === 'kid' ? 'kid' : 'edit';
    dom.workspaceLayout.classList.toggle('is-kid-mode', state.mode === 'kid');
    document.querySelectorAll('[data-mode]').forEach(function (btn) {
      const active = btn.getAttribute('data-mode') === state.mode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }

  function setSlot(nextSlot) {
    state.slot = nextSlot === 'holiday' ? 'holiday' : 'weekday';
    document.querySelectorAll('[data-slot]').forEach(function (btn) {
      const active = btn.getAttribute('data-slot') === state.slot;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    saveStorage();
    renderBoard();
  }

  function initEvents() {
    document.querySelectorAll('[data-slot]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setSlot(btn.getAttribute('data-slot'));
      });
    });

    document.querySelectorAll('[data-mode]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setMode(btn.getAttribute('data-mode'));
      });
    });

    document.querySelectorAll('[data-picker-period]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.pickerPeriod = btn.getAttribute('data-picker-period');
        renderPicker();
      });
    });

    document.querySelectorAll('[data-focus-period]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.pickerPeriod = btn.getAttribute('data-focus-period');
        renderPicker();
        document.getElementById('pickerPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    });

    dom.btnClearPickerTime.addEventListener('click', function () {
      dom.pickerTimeInput.value = '';
    });

    dom.btnToggleAllCards.addEventListener('click', function () {
      state.showAllCards = !state.showAllCards;
      renderPicker();
    });

    dom.customForm.addEventListener('submit', function (e) {
      e.preventDefault();
      const label = dom.customLabel.value.trim();
      if (!label) return;
      currentList().push({
        uid: makeUid(),
        period: state.pickerPeriod,
        activityId: dom.customIconSelect.value || 'outing',
        time: dom.customTime.value || dom.pickerTimeInput.value || '',
        label: label,
        note: dom.customNote.value.trim(),
        done: false
      });
      dom.customLabel.value = '';
      dom.customNote.value = '';
      saveStorage();
      renderBoard();
      playSoftChime(false);
      showToast('「' + label + '」を たしました！');
    });

    dom.btnSortTime.addEventListener('click', sortByTime);

    dom.btnResetChecks.addEventListener('click', function () {
      currentList().forEach(function (item) {
        item.done = false;
      });
      saveStorage();
      renderBoard();
      showToast('チェック を すべて もどしました');
    });

    dom.btnPrint.addEventListener('click', function () {
      window.print();
    });

    dom.btnLoadPreset.addEventListener('click', function () {
      state.schedules[state.slot] = clonePreset(state.slot);
      saveStorage();
      renderBoard();
      showToast('おてほん の よてい を いれました');
    });

    dom.btnClearAll.addEventListener('click', function () {
      if (currentList().length === 0) return;
      state.schedules[state.slot] = [];
      saveStorage();
      renderBoard();
      showToast('よてい を すべて けしました');
    });

    // Family Sync Modal Events
    dom.btnSyncOpen.addEventListener('click', openSyncModal);
    dom.syncModal.querySelectorAll('[data-close-sync]').forEach(function (el) {
      el.addEventListener('click', closeSyncModal);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !dom.syncModal.classList.contains('hidden')) {
        closeSyncModal();
      }
    });

    dom.btnCreateFamily.addEventListener('click', createFamilyRoom);

    dom.joinFamilyForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      const id = extractRoomIdFromInput(dom.joinFamilyInput.value);
      if (!id) {
        showToast('かぞく専用URL または コードを確認してください');
        return;
      }
      state.cloudUpdatedAt = 0;
      persistRoomId(id);
      const ok = await pullFromCloud(true);
      if (ok) {
        dom.joinFamilyInput.value = '';
        startPolling();
      } else {
        persistRoomId(null);
      }
    });

    dom.btnCopyEditUrl.addEventListener('click', function () {
      copyText(dom.syncEditUrl.value, '親用URLをコピーしました！');
    });

    dom.btnCopyKidUrl.addEventListener('click', function () {
      copyText(dom.syncKidUrl.value, '子ども用（みる専用）URLをコピーしました！');
    });

    dom.btnSyncNow.addEventListener('click', function () {
      pullFromCloud(true);
    });

    dom.btnLeaveFamily.addEventListener('click', function () {
      stopPolling();
      if (state.cloudSaveTimer) {
        clearTimeout(state.cloudSaveTimer);
        state.cloudSaveTimer = null;
      }
      state.cloudSaving = false;
      state.cloudUpdatedAt = 0;
      persistRoomId(null);
      showToast('この端末だけの保存にもどしました');
    });

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && state.roomId) {
        pullFromCloud(false);
      }
    });
  }

  function bootstrap() {
    loadStorage();
    populateCustomIcons();
    updateClock();
    setInterval(updateClock, 15000);

    const params = new URLSearchParams(window.location.search);
    const initialMode = params.get('mode') === 'kid' ? 'kid' : 'edit';
    const urlFamily = params.get('family');
    let savedRoom = null;
    try {
      savedRoom = localStorage.getItem(ROOM_STORAGE_KEY);
    } catch (_) {}

    const activeRoom =
      urlFamily && ROOM_ID_RE.test(urlFamily)
        ? urlFamily
        : savedRoom && ROOM_ID_RE.test(savedRoom)
          ? savedRoom
          : null;

    setSlot(state.slot);
    setMode(initialMode);
    renderPicker();
    initEvents();

    if (activeRoom) {
      persistRoomId(activeRoom);
      pullFromCloud(false).then(function () {
        startPolling();
      });
    } else {
      updateSyncUI();
    }
  }

  window.addEventListener('DOMContentLoaded', bootstrap);
})(window);
