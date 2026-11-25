(function (global) {
  'use strict';

  class SoundEngine {
    constructor() {
      this.ctx = null;
      this.muted = false;
      this.stepIndex = 0;
      this.pentatonic = [329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0];
      try {
        const saved = localStorage.getItem('meiro5_muted');
        if (saved === 'true') this.muted = true;
      } catch (_) {}
    }

    ensureContext() {
      if (this.muted) return null;
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return null;
        this.ctx = new AudioCtx();
      }
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    }

    setMuted(muted) {
      this.muted = !!muted;
      try {
        localStorage.setItem('meiro5_muted', String(this.muted));
      } catch (_) {}
    }

    toggleMute() {
      this.setMuted(!this.muted);
      return this.muted;
    }

    playTone({ freq = 440, endFreq = null, duration = 0.08, type = 'sine', gain = 0.12, delay = 0 }) {
      const ctx = this.ensureContext();
      if (!ctx) return;
      const now = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      const vol = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      if (endFreq !== null) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), now + duration);
      }
      vol.gain.setValueAtTime(0.0001, now);
      vol.gain.linearRampToValueAtTime(gain, now + 0.01);
      vol.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(vol);
      vol.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + duration + 0.02);
    }

    playStartStroke() {
      this.stepIndex = 0;
      this.playTone({ freq: 392, endFreq: 523.25, duration: 0.07, type: 'triangle', gain: 0.1 });
    }

    playStep(pathLength) {
      const idx = Math.min(this.pentatonic.length - 1, pathLength % this.pentatonic.length);
      const octaveBoost = pathLength >= 16 ? 1.15 : 1;
      this.playTone({
        freq: this.pentatonic[idx] * octaveBoost,
        duration: 0.045,
        type: 'sine',
        gain: 0.055
      });
    }

    playBacktrack() {
      this.playTone({ freq: 260, endFreq: 210, duration: 0.04, type: 'sine', gain: 0.04 });
    }

    playWallBump() {
      this.playTone({ freq: 140, endFreq: 90, duration: 0.05, type: 'square', gain: 0.04 });
    }

    playReleaseErase() {
      this.playTone({ freq: 380, endFreq: 130, duration: 0.14, type: 'triangle', gain: 0.1 });
    }

    playItemPickup(seconds) {
      const base = seconds === 3 ? 659.25 : seconds === 2 ? 587.33 : 523.25;
      this.playTone({ freq: base, duration: 0.09, type: 'triangle', gain: 0.12, delay: 0 });
      this.playTone({ freq: base * 1.25, duration: 0.1, type: 'triangle', gain: 0.12, delay: 0.05 });
      this.playTone({ freq: base * 1.5, duration: 0.14, type: 'sine', gain: 0.14, delay: 0.1 });
      this.playTone({ freq: base * 2.0, duration: 0.22, type: 'sine', gain: 0.11, delay: 0.15 });
    }

    playHealPickup(seconds) {
      const base = seconds === 3 ? 587.33 : seconds === 2 ? 523.25 : 440.0;
      this.playTone({ freq: base, endFreq: base * 1.5, duration: 0.11, type: 'sine', gain: 0.13, delay: 0 });
      this.playTone({ freq: base * 1.5, endFreq: base * 2.0, duration: 0.15, type: 'triangle', gain: 0.12, delay: 0.06 });
      this.playTone({ freq: base * 2.5, duration: 0.2, type: 'sine', gain: 0.1, delay: 0.12 });
    }

    playClear(gotItem) {
      const notes = gotItem ? [523.25, 659.25, 783.99, 1046.5] : [523.25, 659.25, 783.99];
      notes.forEach((n, i) => {
        this.playTone({ freq: n, duration: 0.14, type: 'triangle', gain: 0.12, delay: i * 0.055 });
      });
    }

    playUrgentTick(critical) {
      this.playTone({
        freq: critical ? 920 : 720,
        duration: 0.045,
        type: 'square',
        gain: critical ? 0.055 : 0.035
      });
    }

    playGameOver() {
      this.playTone({ freq: 330, endFreq: 220, duration: 0.18, type: 'sawtooth', gain: 0.09, delay: 0 });
      this.playTone({ freq: 220, endFreq: 110, duration: 0.34, type: 'sawtooth', gain: 0.1, delay: 0.16 });
    }
  }

  global.Meiro5 = global.Meiro5 || {};
  global.Meiro5.SoundEngine = SoundEngine;
})(window);
