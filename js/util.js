/*
 * util.js — small math + random helpers shared across the instrument.
 * Everything attaches to the global `Ambient` namespace so the files can be
 * loaded as plain <script> tags (no build step, runs straight from file://).
 */
window.Ambient = window.Ambient || {};

(function (A) {
  'use strict';

  const U = {};

  U.clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

  U.lerp = (a, b, t) => a + (b - a) * t;

  // Map x from [a,b] onto [c,d].
  U.map = (x, a, b, c, d) => c + ((x - a) * (d - c)) / (b - a);

  U.rand = (lo = 1, hi) => {
    if (hi === undefined) { hi = lo; lo = 0; }
    return lo + Math.random() * (hi - lo);
  };

  U.randInt = (lo, hi) => Math.floor(U.rand(lo, hi + 1));

  // Pick a random element.
  U.pick = (arr) => arr[(Math.random() * arr.length) | 0];

  // Weighted pick. weights need not be normalised.
  U.weightedPick = (items, weights) => {
    let total = 0;
    for (let i = 0; i < weights.length; i++) total += weights[i];
    let r = Math.random() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  };

  // Standard-normal sample (Box–Muller). Used to drive the drift walks.
  U.randn = () => {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  };

  // Probability of at least one event over a window of dt seconds, given a
  // per-second rate. (Poisson process.)
  U.chancePerSecond = (rate, dt) => 1 - Math.exp(-rate * dt);

  // MIDI note number -> frequency in Hz (A4 = 69 = 440 Hz).
  U.mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // A short, pleasant default colour ramp for the visuals (cool -> warm).
  U.hueFor = (brightness) => U.lerp(210, 40, U.clamp(brightness, 0, 1));

  A.util = U;
})(window.Ambient);
