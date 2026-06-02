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
require('../js/audio.js');
require('../js/scheduler.js');
const A = global.Ambient;

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
