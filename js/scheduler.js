/*
 * scheduler.js — decides *what* sounds and *when*, reading the drift weather.
 *
 * Uses the classic Web Audio look-ahead pattern: a coarse JS timer wakes up
 * often, and any events due within the look-ahead window are scheduled on the
 * sample-accurate audio clock. Note onsets are not on a grid — they follow an
 * exponential (Poisson) spacing whose rate is set by `density`, so the texture
 * pulses and thins organically rather than ticking.
 */
(function (A) {
  'use strict';
  const U = A.util;

  class Scheduler {
    constructor(engine, harmony, drift) {
      this.engine = engine;
      this.harmony = harmony;
      this.drift = drift;

      this.lookahead = 0.12;  // seconds of audio scheduled in advance
      this.tickMs = 40;       // how often the JS timer fires
      this.timer = null;

      this.nextEventTime = 0;
      this.nextSubTime = 0;
      this.lastMacros = null;

      // Visual hook: called for every scheduled note so the canvas can bloom.
      this.onNote = null;
    }

    start() {
      this.nextEventTime = this.engine.now + 0.2;
      this.nextSubTime = this.engine.now + 6;
      if (this.timer) clearInterval(this.timer);
      this.timer = setInterval(() => this._tick(), this.tickMs);
    }

    stop() {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
    }

    setMacros(m) { this.lastMacros = m; }

    _tick() {
      const m = this.lastMacros;
      if (!m) return;
      const horizon = this.engine.now + this.lookahead;

      // --- melodic / textural events, spaced by density ---
      while (this.nextEventTime < horizon) {
        this._spawnEvent(this.nextEventTime, m);
        // Mean inter-onset: sparse (~5s) when calm, busy (~0.45s) when dense.
        const mean = U.lerp(5.0, 0.45, Math.pow(m.density, 1.3));
        const gap = -Math.log(1 - Math.random()) * mean; // exponential spacing
        this.nextEventTime += Math.max(0.12, gap);
      }

      // --- occasional sub swells, on their own slow clock ---
      if (this.engine.now > this.nextSubTime) {
        const freq = this.harmony.rootFreq(-2);
        A.voices.Sub.trigger(this.engine, freq, this.engine.now + 0.05, {
          gain: U.lerp(0.05, 0.16, m.warmth),
          dur: U.rand(9, 16),
        });
        this.nextSubTime = this.engine.now + U.rand(14, 30);
      }
    }

    _spawnEvent(when, m) {
      const h = this.harmony;
      // Choose a voice. warmth biases toward pads; brightness toward bells.
      // There's always some of each so the texture stays varied.
      const padW  = U.lerp(0.25, 0.7, m.warmth);
      const bellW = U.lerp(0.25, 0.8, m.brightness) * U.lerp(1.2, 0.7, m.warmth);
      const kind = U.weightedPick(['pad', 'bell'], [padW, bellW]);

      const freq = h.pickFreq(m.register, m.spread);
      const pan = U.rand(-0.65, 0.65);

      if (kind === 'pad') {
        A.voices.Pad.trigger(this.engine, freq, when, {
          brightness: m.brightness,
          motion: m.motion,
          gain: U.lerp(0.05, 0.11, m.warmth),
          dur: U.lerp(6, 13, 1 - m.density),
          pan,
        });
      } else {
        A.voices.Bell.trigger(this.engine, freq, when, {
          brightness: m.brightness,
          gain: U.lerp(0.08, 0.2, m.brightness) * 0.9,
          dur: U.lerp(1.2, 5.5, m.space),
          pan,
        });
      }

      if (this.onNote) {
        this.onNote({ when, freq, kind, pan, brightness: m.brightness });
      }
    }
  }

  A.Scheduler = Scheduler;
})(window.Ambient);
