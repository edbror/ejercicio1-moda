/*
 * visuals.js — a living canvas that reflects the weather.
 *
 * Background colour/energy tracks brightness + warmth. Every scheduled note
 * drops a "bloom" — an expanding ring positioned by pitch (vertical) and pan
 * (horizontal), tinted by voice type. Slow drifting motes give the field a
 * sense of weather even in silence. Nothing here makes sound; it only listens.
 */
(function (A) {
  'use strict';
  const U = A.util;

  class Visuals {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.blooms = [];
      this.motes = [];
      this.macros = null;
      this.harmony = null;
      this.aurora = 0;        // target auroral intensity from space weather
      this.auroraLevel = 0;   // smoothed, what we actually draw
      this.phase = 0;         // animation phase for the shimmering curtains
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.running = false;
      this._resize();
      window.addEventListener('resize', () => this._resize());

      for (let i = 0; i < 70; i++) {
        this.motes.push({
          x: Math.random(), y: Math.random(),
          vx: U.rand(-0.01, 0.01), vy: U.rand(-0.01, 0.01),
          r: U.rand(0.4, 1.8), a: U.rand(0.05, 0.25),
        });
      }
    }

    _resize() {
      const c = this.canvas;
      this.w = c.clientWidth;
      this.h = c.clientHeight;
      c.width = Math.max(1, Math.floor(this.w * this.dpr));
      c.height = Math.max(1, Math.floor(this.h * this.dpr));
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    setMacros(m) { this.macros = m; }
    setHarmony(h) { this.harmony = h; }
    // Target auroral intensity [0,1]; 0 turns the curtains off (e.g. unsynced).
    setAurora(a) { this.aurora = U.clamp(a || 0, 0, 1); }

    // A note happened — drop a bloom. freq decides vertical position.
    bloom(note) {
      const minF = 55, maxF = 1760;
      const fy = U.clamp(
        1 - (Math.log2(note.freq / minF) / Math.log2(maxF / minF)),
        0.05, 0.95
      );
      const x = note.pan * 0.5 + 0.5;
      const hue = note.kind === 'bell'
        ? U.lerp(180, 50, note.brightness)
        : U.lerp(265, 200, note.brightness);
      this.blooms.push({
        x, y: fy,
        r: 0,
        maxR: note.kind === 'bell' ? U.rand(40, 90) : U.rand(80, 180),
        life: 1,
        decay: note.kind === 'bell' ? 0.012 : 0.006,
        hue,
        sat: note.kind === 'bell' ? 80 : 55,
        width: note.kind === 'bell' ? 1.5 : 3,
      });
      if (this.blooms.length > 200) this.blooms.shift();
    }

    start() {
      if (this.running) return;
      this.running = true;
      const loop = () => {
        if (!this.running) return;
        this._draw();
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }

    stop() { this.running = false; }

    _draw() {
      const ctx = this.ctx;
      const { w, h } = this;
      const m = this.macros || {
        brightness: 0.5, register: 0.5, space: 0.5,
        density: 0.3, motion: 0.3, warmth: 0.5,
      };

      // Background: a vertical gradient whose hue tracks brightness/warmth.
      // Trails are produced by filling translucently each frame.
      const hue = U.hueFor(m.brightness);
      const top = `hsl(${(hue + 200) % 360}, 30%, ${4 + m.brightness * 6}%)`;
      const bot = `hsl(${hue}, 35%, ${3 + m.warmth * 5}%)`;
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, top);
      grad.addColorStop(1, bot);
      ctx.globalAlpha = 0.22;          // trail length
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;

      // Ease the auroral intensity toward its target so storms swell in/out.
      this.auroraLevel += (this.aurora - this.auroraLevel) * 0.02;
      this.phase += 0.006 + m.motion * 0.01;

      ctx.globalCompositeOperation = 'lighter';

      // Aurora curtains — drawn behind the motes/blooms, rising from the
      // bottom, shimmering like the real thing when Bz turns south.
      if (this.auroraLevel > 0.01) this._drawAurora(m);

      // Drifting motes — speed scales with motion.
      const speed = 0.4 + m.motion * 2.2;
      for (const p of this.motes) {
        p.x += p.vx * speed * 0.01;
        p.y += p.vy * speed * 0.01;
        if (p.x < 0) p.x += 1; if (p.x > 1) p.x -= 1;
        if (p.y < 0) p.y += 1; if (p.y > 1) p.y -= 1;
        ctx.beginPath();
        ctx.fillStyle = `hsla(${hue}, 60%, 75%, ${p.a * (0.4 + m.brightness)})`;
        ctx.arc(p.x * w, p.y * h, p.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Blooms.
      for (let i = this.blooms.length - 1; i >= 0; i--) {
        const b = this.blooms[i];
        b.r += (b.maxR - b.r) * 0.04;
        b.life -= b.decay;
        if (b.life <= 0) { this.blooms.splice(i, 1); continue; }
        const x = b.x * w, y = b.y * h;
        const alpha = b.life * 0.6;
        ctx.beginPath();
        ctx.strokeStyle = `hsla(${b.hue}, ${b.sat}%, 65%, ${alpha})`;
        ctx.lineWidth = b.width;
        ctx.arc(x, y, b.r, 0, Math.PI * 2);
        ctx.stroke();
        // soft core
        const core = ctx.createRadialGradient(x, y, 0, x, y, b.r * 0.8);
        core.addColorStop(0, `hsla(${b.hue}, ${b.sat}%, 70%, ${alpha * 0.25})`);
        core.addColorStop(1, `hsla(${b.hue}, ${b.sat}%, 70%, 0)`);
        ctx.fillStyle = core;
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    // Shimmering auroral curtains. Several overlapping vertical bands sway with
    // layered sines; brightness and height scale with intensity. Colour runs
    // from the classic oxygen green up into a high violet/magenta crown, the
    // same ordering you see in a real strong display.
    _drawAurora(m) {
      const ctx = this.ctx;
      const { w, h } = this;
      const I = this.auroraLevel;
      const bands = 5;
      const baseHeight = h * (0.4 + 0.45 * I);
      for (let b = 0; b < bands; b++) {
        const t = b / (bands - 1);
        // Each band drifts horizontally at its own rate.
        const sway = Math.sin(this.phase * (0.6 + t) + b * 1.7) * w * 0.12;
        const cx = w * (0.2 + 0.6 * t) + sway;
        const bw = w * (0.18 + 0.10 * Math.sin(this.phase * 0.5 + b));
        const top = h - baseHeight * (0.7 + 0.3 * Math.sin(this.phase + b * 2.1));
        const hue = 135 + t * 145;           // green -> violet/magenta crown
        const alpha = 0.05 + 0.16 * I * (0.6 + 0.4 * Math.sin(this.phase * 1.3 + b));
        const grad = ctx.createLinearGradient(0, h, 0, top);
        grad.addColorStop(0, `hsla(${hue}, 90%, 60%, 0)`);
        grad.addColorStop(0.35, `hsla(${hue}, 90%, 62%, ${alpha})`);
        grad.addColorStop(1, `hsla(${(hue + 30) % 360}, 95%, 72%, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(cx - bw, h);
        ctx.lineTo(cx - bw * 0.4, top);
        ctx.lineTo(cx + bw * 0.4, top);
        ctx.lineTo(cx + bw, h);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  A.Visuals = Visuals;
})(window.Ambient);
