/*
 * Headless smoke test. Mocks just enough of the Web Audio API + DOM globals to
 * load the real modules and run the engine, harmony, drift and scheduler for
 * some simulated time. Catches runtime/logic errors without a browser.
 *
 *   node test/smoke.js
 */
'use strict';

// ---- minimal AudioParam / AudioNode / AudioContext mocks -------------------
class FakeParam {
  constructor(v = 0) { this.value = v; }
  setValueAtTime(v) { this.value = v; return this; }
  linearRampToValueAtTime(v) { this.value = v; return this; }
  exponentialRampToValueAtTime(v) { this.value = v; return this; }
  setTargetAtTime(v) { this.value = v; return this; }
  cancelScheduledValues() { return this; }
}
class FakeNode {
  constructor() {
    this.gain = new FakeParam(1);
    this.frequency = new FakeParam(440);
    this.detune = new FakeParam(0);
    this.delayTime = new FakeParam(0);
    this.pan = new FakeParam(0);
    this.Q = new FakeParam(1);
    this.threshold = new FakeParam(-24);
    this.knee = new FakeParam(30);
    this.ratio = new FakeParam(12);
    this.attack = new FakeParam(0.003);
    this.release = new FakeParam(0.25);
    this.type = 'sine';
    this.curve = null;
    this.oversample = 'none';
    this.buffer = null;
  }
  connect() { return this; }
  disconnect() { return this; }
  start() { AudioState.starts++; }
  stop() {}
}
class FakeBuffer {
  constructor(ch, len) {
    this.length = len;
    this._d = [];
    for (let i = 0; i < ch; i++) this._d.push(new Float32Array(len));
  }
  getChannelData(i) { return this._d[i]; }
}
const AudioState = { starts: 0, nodes: 0 };
class FakeContext {
  constructor() {
    this.sampleRate = 44100;
    this.state = 'running';
    this.destination = new FakeNode();
    this.currentTime = 0;
  }
  resume() { this.state = 'running'; return Promise.resolve(); }
  _n() { AudioState.nodes++; return new FakeNode(); }
  createGain() { return this._n(); }
  createOscillator() { return this._n(); }
  createBiquadFilter() { return this._n(); }
  createDelay() { return this._n(); }
  createStereoPanner() { return this._n(); }
  createConvolver() { return this._n(); }
  createWaveShaper() { return this._n(); }
  createDynamicsCompressor() { return this._n(); }
  createBuffer(ch, len) { return new FakeBuffer(ch, len); }
}

// ---- DOM-ish globals the modules touch on load -----------------------------
global.window = global;
global.AudioContext = FakeContext;
global.performance = { now: () => 0 };

// load modules (they self-register on window.Ambient)
require('../js/util.js');
require('../js/harmony.js');
require('../js/drift.js');
require('../js/cosmos.js');
require('../js/snapshot.js');
require('../js/audio.js');
require('../js/scheduler.js');
const A = global.Ambient;

function approx(a, b, eps = 1e-9) { return Math.abs(a - b) <= eps; }

let failures = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failures++; }
  else { console.log('ok  -', msg); }
}

(async function run() {
  // --- drift produces in-range macros and actually evolves ---
  const drift = new A.DriftSystem();
  const first = drift.update(0.05);
  let moved = false;
  let allInRange = true;
  for (let i = 0; i < 400; i++) {
    const m = drift.update(0.05);
    for (const k in m) if (m[k] < 0 || m[k] > 1) allInRange = false;
    if (Math.abs(m.density - first.density) > 1e-6) moved = true;
  }
  assert(allInRange, 'all drift macros stay within [0,1]');
  assert(moved, 'drift values evolve over time');

  // user target biases the value: pin density high, it should rise on average
  const d2 = new A.DriftSystem();
  d2.setTarget('density', 1.0);
  let sum = 0;
  for (let i = 0; i < 600; i++) sum += d2.update(0.05).density;
  assert(sum / 600 > 0.6, `high user target biases value upward (mean ${(sum / 600).toFixed(2)})`);

  // gust perturbs the system without throwing / leaving range
  drift.gust(1);
  const afterGust = drift.update(0.05);
  let gustOk = true;
  for (const k in afterGust) if (afterGust[k] < 0 || afterGust[k] > 1) gustOk = false;
  assert(gustOk, 'post-gust macros stay within [0,1]');

  // cosmic target pulls a macro when weight is on, and is released cleanly
  const d3 = new A.DriftSystem();
  d3.setTarget('density', 0.0);          // user wants silence
  d3.setCosmicTargets({ density: 1.0 }); // the sky wants a storm
  d3.setCosmicWeight(1.0);               // fully synced
  let cs = 0;
  for (let i = 0; i < 600; i++) cs += d3.update(0.05).density;
  assert(cs / 600 > 0.6, `cosmic target pulls macro toward it (mean ${(cs / 600).toFixed(2)})`);
  d3.setCosmicWeight(0);                 // release back to the user's wish
  let cs2 = 0;
  for (let i = 0; i < 600; i++) cs2 += d3.update(0.05).density;
  assert(cs2 / 600 < 0.4, `releasing cosmos returns to user target (mean ${(cs2 / 600).toFixed(2)})`);

  // --- cosmos parse + map layer (pure, no network) ---
  const C = A.Cosmos;
  const plasma = [['time_tag', 'density', 'speed', 'temperature'],
                  ['2026-06-02 05:00', '4.2', '380', '90000'],
                  ['2026-06-02 05:01', '5.1', '620', '']];
  // blank/missing cells should be skipped, scanning back for finite values
  assert(approx(C.parsePlasma(plasma).speed, 620), 'parsePlasma reads newest finite speed');
  assert(approx(C.parsePlasma(plasma).temp, 90000), 'parsePlasma skips blank temp back to finite');

  const mag = [['time_tag', 'bx_gsm', 'by_gsm', 'bz_gsm', 'bt'],
               ['2026-06-02 05:00', '1.0', '2.0', '-6.5', '7.1']];
  assert(approx(C.parseMag(mag).bz, -6.5), 'parseMag reads bz_gsm');
  assert(approx(C.parseMag(mag).bt, 7.1), 'parseMag reads bt');

  const kp = [{ time_tag: '2026-06-02 04:00', kp_index: 3 },
              { time_tag: '2026-06-02 05:00', kp_index: 5 }];
  assert(approx(C.parseKp(kp).kp, 5), 'parseKp reads newest kp_index');

  // southward Bz -> dark bias + lower brightness; northward -> opposite
  const south = C.mapToTargets({ bz: -10, speed: 650, kp: 6, bt: 15, temp: 4e5, protons: 12 });
  const north = C.mapToTargets({ bz: 10, speed: 320, kp: 1, bt: 4, temp: 2e4, protons: 1 });
  assert(south.colorBias < 0 && north.colorBias > 0, 'Bz sign sets harmonic colour bias');
  assert(south.targets.brightness < north.targets.brightness, 'southward Bz is darker than northward');
  assert(south.targets.motion > north.targets.motion, 'faster wind raises motion');
  assert(south.targets.density > north.targets.density, 'higher Kp raises density');
  let mapInRange = true;
  for (const t of [south, north]) for (const k in t.targets) {
    if (t.targets[k] < 0 || t.targets[k] > 1) mapInRange = false;
  }
  assert(mapInRange, 'all cosmic targets land within [0,1]');

  // substorm detection: Kp jump or sharp southward Bz turn
  assert(C.isSubstorm({ kp: 3 }, { kp: 5 }), 'Kp jump flags a substorm');
  assert(C.isSubstorm({ bz: 2 }, { bz: -6 }), 'sharp southward Bz turn flags a substorm');
  assert(!C.isSubstorm({ kp: 4, bz: 1 }, { kp: 4, bz: 0 }), 'quiet change is not a substorm');
  assert(!C.isSubstorm(null, { kp: 9 }), 'first reading is never a substorm');

  // aurora intensity: bright when Bz is south / Kp high, dark when north & calm
  assert(south.aurora > 0.7, `southward storm lights the aurora (${south.aurora.toFixed(2)})`);
  assert(north.aurora < 0.2, `northward calm leaves it dark (${north.aurora.toFixed(2)})`);
  const auroraInRange = [0, 0.5, 1].every(() => south.aurora >= 0 && south.aurora <= 1 && north.aurora >= 0 && north.aurora <= 1);
  assert(auroraInRange, 'aurora intensity stays within [0,1]');

  // snapshot mood + sky text helpers (pure, no DOM)
  const S = A.Snapshot;
  const brightMood = S.moodWords({ brightness: 0.9, density: 0.7, space: 0.8, motion: 0.7 });
  const darkMood = S.moodWords({ brightness: 0.1, density: 0.1, space: 0.2, motion: 0.1 });
  assert(/luminous/.test(brightMood), `bright weather reads luminous ("${brightMood}")`);
  assert(/shadowed/.test(darkMood), `dark weather reads shadowed ("${darkMood}")`);
  assert(S.skyLine({ speed: 487.3, bz: -3.2, kp: 4 }) === 'wind 487 km/s   Bz -3.2 nT   Kp 4.0',
    'skyLine formats telemetry');
  assert(S.skyLine(null) === null, 'skyLine tolerates no reading');

  // harmony colour bias actually skews mode selection bright vs dark
  function darkShare(bias) {
    const h = new A.Harmony();
    h.setColorBias(bias);
    const names = Object.keys(A.MODES);
    let darkSteps = 0, total = 0;
    let prev = names.indexOf(h.modeName);
    for (let i = 0; i < 4000; i++) {
      h.forceShift(0.5);
      const idx = names.indexOf(h.modeName);
      if (idx !== prev) { total++; if (idx > prev) darkSteps++; }
      prev = idx;
    }
    return total ? darkSteps / total : 0.5;
  }
  assert(darkShare(-1) > darkShare(1), 'negative colour bias darkens modes more than positive');

  // --- harmony shifts and yields valid, audible frequencies ---
  const harmony = new A.Harmony();
  let changes = 0;
  harmony.onChange(() => changes++);
  for (let i = 0; i < 4000; i++) harmony.update(0.05, 1.0); // ~200s at high motion
  assert(changes > 0, `harmony shifted at least once (got ${changes})`);
  let freqOk = true;
  for (let i = 0; i < 500; i++) {
    const f = harmony.pickFreq(Math.random(), Math.random());
    if (!(f > 20 && f < 20000)) freqOk = false;
  }
  assert(freqOk, 'pickFreq always returns audible Hz');
  assert(harmony.rootFreq(-1) > 0 && harmony.fifthFreq(-1) > 0, 'root/fifth freqs positive');

  // --- engine builds the whole graph without throwing ---
  const engine = new A.Engine();
  await engine.start();
  assert(engine.ctx, 'engine context created');
  assert(engine.drone, 'drone created');
  engine.applyMacros(first);
  engine.drone.applyMacros(first);
  engine.drone.retune(harmony);

  // voices trigger without throwing
  A.voices.Bell.trigger(engine, 440, 0, { brightness: 0.6 });
  A.voices.Pad.trigger(engine, 220, 0, { brightness: 0.5, motion: 0.3 });
  A.voices.Sub.trigger(engine, 55, 0, {});
  assert(AudioState.starts > 0, 'oscillators started by voices');

  // --- scheduler spawns notes as simulated audio time advances ---
  function runScheduler(macros, ticks) {
    const s = new A.Scheduler(engine, harmony, drift);
    let n = 0;
    s.onNote = () => n++;
    s.setMacros(macros);
    s.nextEventTime = engine.ctx.currentTime + 0.05;
    s.nextSubTime = engine.ctx.currentTime + 1e6; // disable sub for counting
    for (let i = 0; i < ticks; i++) {
      engine.ctx.currentTime += 0.04;
      s._tick();
    }
    return n;
  }

  const base = { density: 0.5, brightness: 0.6, register: 0.5, spread: 0.5, motion: 0.5, space: 0.6, warmth: 0.5 };
  const dense = runScheduler({ ...base, density: 0.95 }, 400);
  const sparse = runScheduler({ ...base, density: 0.02 }, 400);
  assert(dense > 0, `scheduler produces notes at high density (${dense})`);
  assert(sparse < dense, `low density is sparser than high density (${sparse} < ${dense})`);

  console.log('\nSimulated audio nodes:', AudioState.nodes, '| osc starts:', AudioState.starts);
  if (failures) { console.log(`\n${failures} CHECK(S) FAILED`); process.exitCode = 1; }
  else console.log('\nALL CHECKS PASSED');
})().catch((e) => { console.error('THREW:', e); process.exitCode = 1; });
