/*
 * drift.js — "the weather". This is the heart of the instrument.
 *
 * A handful of macro parameters describe the character of the sound. Each one
 * is a value in [0,1] that follows a mean-reverting random walk
 * (Ornstein–Uhlenbeck-ish): it is pulled toward a target, but with inertia and
 * its own continuous noise so it never sits still.
 *
 * The catch — and the whole point — is that the target the user sets is not the
 * target the system uses. The system adds its own slow, autonomous "wander" on
 * top of the user's wish, so your nudges *bias* the weather without commanding
 * it. Leave it alone and it still breathes.
 */
(function (A) {
  'use strict';
  const U = A.util;

  class DriftParam {
    constructor(name, opts = {}) {
      this.name = name;
      this.value = opts.start ?? 0.5;      // current realised value
      this.userTarget = opts.start ?? 0.5; // what the human asked for
      this.wander = 0;                     // autonomous offset (random walk)
      this.inertia = opts.inertia ?? 0.35; // how fast it chases the target
      this.noise = opts.noise ?? 0.05;     // micro-jitter on the value itself
      this.wanderNoise = opts.wanderNoise ?? 0.04; // how lively the autonomy is
      this.wanderPull = opts.wanderPull ?? 0.08;   // pull of wander back to 0
      this.wanderReach = opts.wanderReach ?? 0.28; // max autonomous deviation
    }

    setTarget(t) { this.userTarget = U.clamp(t, 0, 1); }

    // `restlessness` (≈ the motion macro) scales the autonomy globally.
    update(dt, restlessness) {
      // 1. Evolve the autonomous wander: a slow walk pulled gently back to 0.
      const live = 0.4 + restlessness * 1.6;
      this.wander += -this.wanderPull * this.wander * dt
                   + this.wanderNoise * live * U.randn() * Math.sqrt(dt);
      this.wander = U.clamp(this.wander, -this.wanderReach, this.wanderReach);

      // 2. The effective target blends the human wish with the system's mood.
      const target = U.clamp(this.userTarget + this.wander, 0, 1);

      // 3. Chase the target with inertia, plus a little jitter on the value.
      this.value += (target - this.value) * this.inertia * dt
                  + this.noise * U.randn() * Math.sqrt(dt);
      this.value = U.clamp(this.value, 0, 1);
      return this.value;
    }
  }

  class DriftSystem {
    constructor() {
      // Each macro shapes a different axis of the texture.
      this.params = {
        density:    new DriftParam('density',    { start: 0.35, inertia: 0.25, wanderReach: 0.30 }),
        brightness: new DriftParam('brightness', { start: 0.45, inertia: 0.30, wanderReach: 0.32 }),
        register:   new DriftParam('register',   { start: 0.50, inertia: 0.20, wanderReach: 0.22 }),
        spread:     new DriftParam('spread',     { start: 0.40, inertia: 0.18, wanderReach: 0.25 }),
        motion:     new DriftParam('motion',     { start: 0.35, inertia: 0.22, wanderReach: 0.20 }),
        space:      new DriftParam('space',      { start: 0.55, inertia: 0.15, wanderReach: 0.18 }),
        warmth:     new DriftParam('warmth',     { start: 0.55, inertia: 0.20, wanderReach: 0.26 }),
      };
    }

    setTarget(name, t) {
      const p = this.params[name];
      if (p) p.setTarget(t);
    }

    // Inject a sudden gust: shove the wander of every param, so the whole
    // system lurches in a fresh direction. This is the "nudge" button.
    gust(strength = 1) {
      for (const k in this.params) {
        const p = this.params[k];
        p.wander = U.clamp(
          p.wander + U.randn() * 0.18 * strength,
          -p.wanderReach, p.wanderReach
        );
      }
    }

    update(dt) {
      // motion drives how restless every other parameter is — read it first.
      const restlessness = this.params.motion.value;
      const out = {};
      for (const k in this.params) {
        out[k] = this.params[k].update(dt, restlessness);
      }
      return out;
    }

    snapshot() {
      const out = {};
      for (const k in this.params) {
        const p = this.params[k];
        out[k] = {
          value: p.value,
          target: U.clamp(p.userTarget + p.wander, 0, 1),
          user: p.userTarget,
        };
      }
      return out;
    }
  }

  A.DriftParam = DriftParam;
  A.DriftSystem = DriftSystem;
})(window.Ambient);
