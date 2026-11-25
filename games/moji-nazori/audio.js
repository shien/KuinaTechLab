(function (global) {
  'use strict';

  class WarmSound {
    constructor() {
      this.ctx = null;
      this.muted = false;
      try {
        if (localStorage.getItem('moji_nazori_muted_v1') === 'true') {
          this.muted = true;
        }
      } catch (_) {}
    }

    ensure() {
      if (this.muted) return null;
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return null;
        this.ctx = new AudioCtx();
      }
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(function () {});
      }
      return this.ctx;
    }

    toggleMute() {
      this.muted = !this.muted;
      try {
        localStorage.setItem('moji_nazori_muted_v1', String(this.muted));
      } catch (_) {}
      return this.muted;
    }

    playBell(freq, duration, delay, gain) {
      const ctx = this.ensure();
      if (!ctx) return;
      const now = ctx.currentTime + (delay || 0);
      const osc = ctx.createOscillator();
      const vol = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now);
      vol.gain.setValueAtTime(0.0001, now);
      vol.gain.linearRampToValueAtTime(gain || 0.12, now + 0.015);
      vol.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(vol);
      vol.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + duration + 0.03);
    }

    playPop() {
      this.playBell(523.25, 0.09, 0, 0.08);
    }

    playErase() {
      this.playBell(392.0, 0.08, 0, 0.07);
      this.playBell(329.63, 0.1, 0.05, 0.06);
    }

    playNext() {
      this.playBell(440.0, 0.09, 0, 0.08);
      this.playBell(587.33, 0.12, 0.06, 0.09);
    }

    playEncourage() {
      this.playBell(392.0, 0.11, 0, 0.08);
      this.playBell(440.0, 0.14, 0.08, 0.08);
    }

    playHanamaru() {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((f, idx) => {
        this.playBell(f, 0.24, idx * 0.085, 0.13);
      });
    }
  }

  global.MojiNazori = global.MojiNazori || {};
  global.MojiNazori.WarmSound = WarmSound;
})(window);
