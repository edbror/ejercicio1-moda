/*
 * app.js — wires the pieces together and runs the clock.
 *
 * The loop: each animation frame we advance the drift weather by the real
 * elapsed time, push the resulting macros into the audio engine, scheduler and
 * visuals, and advance the harmonic clock. The controls write *targets* into
 * the drift system; a glowing marker on each control shows where the value
 * actually drifted to — so you can literally see the gap between what you asked
 * for and what the system decided to do.
 */
(function (A) {
  'use strict';
  const U = A.util;

  // The macros the user can nudge, with human-facing copy.
  const MACROS = [
    { key: 'density',    label: 'Density',    hint: 'how often notes arrive' },
    { key: 'brightness', label: 'Brightness', hint: 'dark & soft ↔ open & glassy' },
    { key: 'register',   label: 'Register',   hint: 'low ↔ high centre of pitch' },
    { key: 'spread',     label: 'Spread',     hint: 'how wide the voicing roams' },
    { key: 'motion',     label: 'Motion',     hint: 'how restless the system is' },
    { key: 'space',      label: 'Space',      hint: 'intimate ↔ cavernous' },
    { key: 'warmth',     label: 'Warmth',     hint: 'bells ↔ pads' },
  ];

  class App {
    constructor() {
      this.engine = new A.Engine();
      this.harmony = new A.Harmony();
      this.drift = new A.DriftSystem();
      this.scheduler = null;
      this.visuals = null;

      this.playing = false;
      this.started = false;       // has the audio graph ever been built
      this.lastT = 0;
      this.macroApplyAccum = 0;
      this.controls = {};
    }

    init() {
      this.visuals = new A.Visuals(document.getElementById('stage'));
      this.visuals.setHarmony(this.harmony);
      this.visuals.start();

      this._buildControls();

      this.harmony.onChange((h) => {
        if (this.engine.drone) this.engine.drone.retune(h);
        this._updateHarmonyReadout();
      });
      this._updateHarmonyReadout();

      document.getElementById('play').addEventListener('click', () => this.toggle());
      document.getElementById('gust').addEventListener('click', () => {
        this.drift.gust(1);
        this._flashGust();
      });

      // Keyboard: space toggles play, G gusts.
      window.addEventListener('keydown', (e) => {
        if (e.target && e.target.tagName === 'INPUT') return;
        if (e.code === 'Space') { e.preventDefault(); this.toggle(); }
        else if (e.key.toLowerCase() === 'g') { this.drift.gust(1); this._flashGust(); }
      });

      // Seed the visuals with the starting weather even before play.
      this.visuals.setMacros(this._values());
    }

    _values() {
      const out = {};
      for (const k in this.drift.params) out[k] = this.drift.params[k].value;
      return out;
    }

    _buildControls() {
      const panel = document.getElementById('controls');
      MACROS.forEach((mac) => {
        const wrap = document.createElement('div');
        wrap.className = 'control';

        const head = document.createElement('div');
        head.className = 'control-head';
        head.innerHTML = `<span class="control-label">${mac.label}</span>` +
                         `<span class="control-hint">${mac.hint}</span>`;

        const track = document.createElement('div');
        track.className = 'track';

        const input = document.createElement('input');
        input.type = 'range';
        input.min = '0'; input.max = '1000'; input.step = '1';
        input.value = String(Math.round(this.drift.params[mac.key].userTarget * 1000));
        input.setAttribute('aria-label', mac.label);
        input.addEventListener('input', () => {
          this.drift.setTarget(mac.key, parseInt(input.value, 10) / 1000);
        });

        const actual = document.createElement('div');
        actual.className = 'actual';

        track.appendChild(input);
        track.appendChild(actual);
        wrap.appendChild(head);
        wrap.appendChild(track);
        panel.appendChild(wrap);

        this.controls[mac.key] = { input, actual };
      });
    }

    _updateControlMarkers(snap) {
      for (const k in this.controls) {
        const c = this.controls[k];
        const s = snap[k];
        c.actual.style.left = (s.value * 100) + '%';
        // Tint the marker by how far the system has wandered from your wish.
        const gap = Math.abs(s.value - s.user);
        c.actual.style.opacity = String(0.5 + Math.min(0.5, gap * 2.5));
      }
    }

    _updateHarmonyReadout() {
      const el = document.getElementById('harmony');
      if (el) el.textContent = `${this.harmony.noteName} ${this.harmony.modeName}`;
    }

    _flashGust() {
      const b = document.getElementById('gust');
      b.classList.remove('flash');
      void b.offsetWidth; // reflow to restart the animation
      b.classList.add('flash');
    }

    async toggle() {
      if (!this.playing) await this.play();
      else this.pause();
    }

    async play() {
      await this.engine.start();
      if (!this.started) {
        this.started = true;
        this.scheduler = new A.Scheduler(this.engine, this.harmony, this.drift);
        this.scheduler.onNote = (n) => this.visuals.bloom(n);
        this.engine.drone.retune(this.harmony);
      }
      this.scheduler.start();
      this.engine.setMasterGain(0.9, 4);
      this.engine.drone.setLevel(0.5, 6);

      this.playing = true;
      this.lastT = performance.now();
      document.body.classList.add('playing');
      document.getElementById('play').textContent = 'Pause';
      document.getElementById('intro').classList.add('hidden');
      this._loop();
    }

    pause() {
      this.playing = false;
      if (this.scheduler) this.scheduler.stop();
      this.engine.setMasterGain(0.0, 3);
      this.engine.drone.setLevel(0.0, 3);
      document.body.classList.remove('playing');
      document.getElementById('play').textContent = 'Play';
    }

    _loop() {
      if (!this.playing) return;
      const now = performance.now();
      let dt = (now - this.lastT) / 1000;
      this.lastT = now;
      dt = Math.min(dt, 0.1); // guard against tab-switch jumps

      // 1. Advance the weather.
      const macros = this.drift.update(dt);
      // 2. Advance the harmonic clock (restlessness from motion).
      this.harmony.update(dt, macros.motion);

      // 3. Feed everything downstream.
      this.scheduler.setMacros(macros);
      this.visuals.setMacros(macros);

      // Effect/drone params are smoothed in audio time — throttle to ~12 Hz.
      this.macroApplyAccum += dt;
      if (this.macroApplyAccum > 0.08) {
        this.macroApplyAccum = 0;
        this.engine.applyMacros(macros);
        this.engine.drone.applyMacros(macros);
      }

      // 4. Reflect drift back into the controls.
      this._updateControlMarkers(this.drift.snapshot());

      requestAnimationFrame(() => this._loop());
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    app.init();
    window.__ambient = app; // handy for tinkering in the console
  });
})(window.Ambient);
