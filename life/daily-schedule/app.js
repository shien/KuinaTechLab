(function (global) {
  'use strict';

  const { ACTIVITIES, PERIODS, PRESETS, getActivityById } = global.DailyScheduleData;

  const STORAGE_KEY = 'kuina_daily_schedule_v1';

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
    toastBanner: document.getElementById('toastBanner')
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

  function saveStorage() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          slot: state.slot,
          schedules: state.schedules
        })
      );
    } catch (_) {}
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
  }

  function bootstrap() {
    loadStorage();
    populateCustomIcons();
    updateClock();
    setInterval(updateClock, 15000);
    setSlot(state.slot);
    setMode('edit');
    renderPicker();
    initEvents();
  }

  window.addEventListener('DOMContentLoaded', bootstrap);
})(window);
