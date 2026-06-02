/*
 * audio.js — the synthesis engine. Master bus, effects, and voices.
 *
 * Signal flow:
 *
 *   voices ─┬─> dry ───────────────────────────────┐
 *           ├─> reverbSend ─> convolver ─> revRet ──┤
 *           └─> delaySend ──> ping-pong ─> delRet ──┤
 *                                  ↑__feedback__|    │
 *                                                    ▼
 *                                  master ─> softclip ─> limiter ─> out
 *
 * The reverb impulse response is *generated* (decaying stereo noise), so there
 * are no audio files anywhere — every sample you hear is computed live.
 */
(function (A) {
  'use strict';
  const U = A.util;

  // ---- generated impulse response for the convolution reverb ---------------
  function makeReverbIR(ctx, seconds, decay) {
    const rate = ctx.sampleRate;
    const len = Math.max(1, Math.floor(rate * seconds));
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const env = Math.pow(1 - t, decay); // smooth exponential-ish tail
        data[i] = (Math.random() * 2 - 1) * env;
      }
    }
    return buf;
  }

  // ---- soft saturation curve for the gentle bus drive ----------------------
  function makeSoftCurve(amount) {
    const n = 1024;
    const curve = new Float32Array(n);
    const k = amount;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(k * x) / Math.tanh(k);
    }
    return curve;
  }

  class Engine {
    constructor() {
      this.ctx = null;
      this.nodes = {};
      this.drone = null;
    }

    get now() { return this.ctx ? this.ctx.currentTime : 0; }

    async start() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') await this.ctx.resume();
        return;
      }
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.ctx = ctx;

      // --- master / output stage ---
      const master = ctx.createGain();
      master.gain.value = 0.0; // faded in by the app

      const drive = ctx.createWaveShaper();
      drive.curve = makeSoftCurve(1.6);
      drive.oversample = '4x';

      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -8;
      limiter.knee.value = 6;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.004;
      limiter.release.value = 0.25;

      master.connect(drive);
      drive.connect(limiter);
      limiter.connect(ctx.destination);

      // --- mix buses that voices fan out into ---
      const dry = ctx.createGain();        dry.gain.value = 0.85;
      const reverbSend = ctx.createGain(); reverbSend.gain.value = 0.5;
      const delaySend = ctx.createGain();  delaySend.gain.value = 0.3;
      dry.connect(master);

      // --- convolution reverb ---
      const convolver = ctx.createConvolver();
      convolver.buffer = makeReverbIR(ctx, 4.5, 3.0);
      const revRet = ctx.createGain(); revRet.gain.value = 0.9;
      // Low-pass the reverb a touch so big tails stay soft, not hissy.
      const revTone = ctx.createBiquadFilter();
      revTone.type = 'lowpass';
      revTone.frequency.value = 4200;
      reverbSend.connect(convolver);
      convolver.connect(revTone);
      revTone.connect(revRet);
      revRet.connect(master);

      // --- stereo ping-pong delay with feedback ---
      const delayIn = ctx.createGain();
      const dL = ctx.createDelay(5.0); dL.delayTime.value = 0.38;
      const dR = ctx.createDelay(5.0); dR.delayTime.value = 0.57;
      const fb = ctx.createGain();     fb.gain.value = 0.4;
      const fbTone = ctx.createBiquadFilter();
      fbTone.type = 'lowpass';
      fbTone.frequency.value = 2600;
      const panL = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      const panR = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (panL) panL.pan.value = -0.7;
      if (panR) panR.pan.value = 0.7;
      const delRet = ctx.createGain(); delRet.gain.value = 0.55;

      delaySend.connect(delayIn);
      delayIn.connect(dL);
      dL.connect(dR);                 // ping -> pong
      dR.connect(fbTone);
      fbTone.connect(fb);
      fb.connect(dL);                 // feedback loop
      if (panL && panR) {
        dL.connect(panL); panL.connect(delRet);
        dR.connect(panR); panR.connect(delRet);
      } else {
        dL.connect(delRet); dR.connect(delRet);
      }
      delRet.connect(master);
      // Let delay tails wash into the reverb for a bigger sense of space.
      delRet.connect(reverbSend);

      this.nodes = {
        master, drive, limiter, dry, reverbSend, delaySend,
        convolver, revRet, revTone, dL, dR, fb, fbTone, delRet,
      };

      // --- the always-on drone bed lives at engine level ---
      this.drone = new Drone(this);
    }

    // Connect a source to all three destinations.
    fanOut(source) {
      source.connect(this.nodes.dry);
      source.connect(this.nodes.reverbSend);
      source.connect(this.nodes.delaySend);
    }

    setMasterGain(v, time = 0.6) {
      const g = this.nodes.master.gain;
      g.cancelScheduledValues(this.now);
      g.setTargetAtTime(v, this.now, time / 3);
    }

    // Update effect amounts from the drift macros.
    applyMacros(m) {
      const n = this.nodes;
      const t = this.now;
      // space: how wet / cavernous.
      n.reverbSend.gain.setTargetAtTime(U.lerp(0.18, 0.95, m.space), t, 1.5);
      n.delaySend.gain.setTargetAtTime(U.lerp(0.08, 0.5, m.space), t, 1.5);
      n.fb.gain.setTargetAtTime(U.lerp(0.25, 0.62, m.space), t, 2.0);
      // brightness opens the reverb + feedback tone.
      n.revTone.frequency.setTargetAtTime(U.lerp(1800, 7000, m.brightness), t, 2.0);
      n.fbTone.frequency.setTargetAtTime(U.lerp(1200, 4800, m.brightness), t, 2.0);
      // motion gently widens the delay times so echoes drift.
      n.dL.delayTime.setTargetAtTime(U.lerp(0.30, 0.52, m.motion), t, 4.0);
      n.dR.delayTime.setTargetAtTime(U.lerp(0.45, 0.78, m.motion), t, 4.0);
    }
  }

  // ---------------------------------------------------------------------------
  // VOICES — all synthesized, no samples.
  // ---------------------------------------------------------------------------

  // FM bell / pluck: a sine carrier whose pitch is modulated by another sine,
  // with an exponentially decaying modulation index. Slightly inharmonic ratios
  // give it a glassy, struck-metal shimmer.
  const Bell = {
    trigger(engine, freq, when, opts) {
      const ctx = engine.ctx;
      const dur = opts.dur ?? U.rand(1.5, 5.0);
      const ratio = U.pick([1.0, 1.41, 2.0, 2.76, 3.5, 1.5]);
      const index = U.lerp(60, 900, opts.brightness ?? 0.5) * U.rand(0.6, 1.2);

      const carrier = ctx.createOscillator();
      carrier.type = 'sine';
      carrier.frequency.value = freq;

      const mod = ctx.createOscillator();
      mod.type = 'sine';
      mod.frequency.value = freq * ratio;

      const modGain = ctx.createGain();
      modGain.gain.setValueAtTime(index, when);
      modGain.gain.exponentialRampToValueAtTime(Math.max(1, index * 0.02), when + dur * 0.8);
      mod.connect(modGain);
      modGain.connect(carrier.frequency);

      const amp = ctx.createGain();
      const peak = opts.gain ?? 0.18;
      amp.gain.setValueAtTime(0.0001, when);
      amp.gain.linearRampToValueAtTime(peak, when + 0.008);
      amp.gain.exponentialRampToValueAtTime(0.0008, when + dur);

      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (pan) pan.pan.value = opts.pan ?? U.rand(-0.6, 0.6);

      carrier.connect(amp);
      if (pan) { amp.connect(pan); engine.fanOut(pan); } else { engine.fanOut(amp); }

      carrier.start(when); mod.start(when);
      const stop = when + dur + 0.1;
      carrier.stop(stop); mod.stop(stop);
    },
  };

  // Additive pad: a stack of detuned partials with a long swell and a soft
  // low-pass, for slow chord washes.
  const Pad = {
    trigger(engine, freq, when, opts) {
      const ctx = engine.ctx;
      const dur = opts.dur ?? U.rand(6, 14);
      const attack = U.lerp(2.5, 0.8, opts.motion ?? 0.3);
      const release = dur * 0.6;
      const peak = opts.gain ?? 0.09;
      const bright = opts.brightness ?? 0.5;

      const amp = ctx.createGain();
      amp.gain.setValueAtTime(0.0001, when);
      amp.gain.exponentialRampToValueAtTime(peak, when + attack);
      amp.gain.setValueAtTime(peak, when + dur - release);
      amp.gain.exponentialRampToValueAtTime(0.0001, when + dur);

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 0.6;
      const cutoff = U.lerp(500, 5200, bright);
      filter.frequency.setValueAtTime(cutoff * 0.5, when);
      filter.frequency.linearRampToValueAtTime(cutoff, when + attack);
      filter.frequency.setTargetAtTime(cutoff * 0.6, when + dur - release, release / 3);

      const partials = [1, 2, 3, 4, 5];
      const gains =     [1, 0.5, 0.32, 0.18, 0.1];
      partials.forEach((p, i) => {
        const osc = ctx.createOscillator();
        osc.type = i === 0 ? 'triangle' : 'sine';
        osc.frequency.value = freq * p;
        osc.detune.value = U.rand(-6, 6);
        const g = ctx.createGain();
        g.gain.value = gains[i] * (0.6 + 0.4 * bright);
        osc.connect(g); g.connect(filter);
        osc.start(when); osc.stop(when + dur + 0.2);
      });

      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (pan) pan.pan.value = opts.pan ?? U.rand(-0.5, 0.5);
      filter.connect(amp);
      if (pan) { amp.connect(pan); engine.fanOut(pan); } else { engine.fanOut(amp); }
    },
  };

  // Sub swell: a single deep sine that fades in and out, felt more than heard.
  const Sub = {
    trigger(engine, freq, when, opts) {
      const ctx = engine.ctx;
      const dur = opts.dur ?? U.rand(8, 16);
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const amp = ctx.createGain();
      amp.gain.setValueAtTime(0.0001, when);
      amp.gain.exponentialRampToValueAtTime(opts.gain ?? 0.12, when + dur * 0.4);
      amp.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      osc.connect(amp);
      // Sub goes mostly dry + a touch of reverb, skip the delay to stay clean.
      amp.connect(engine.nodes.dry);
      amp.connect(engine.nodes.reverbSend);
      osc.start(when); osc.stop(when + dur + 0.2);
    },
  };

  // The drone bed: a continuous, slowly-detuning chord of saw/triangle voices
  // through a moving low-pass, with breathing amplitude. Retunes with harmony.
  class Drone {
    constructor(engine) {
      const ctx = engine.ctx;
      this.engine = engine;

      this.out = ctx.createGain();
      this.out.gain.value = 0.0;

      this.filter = ctx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.value = 700;
      this.filter.Q.value = 0.8;
      this.filter.connect(this.out);

      // Breathing LFO on amplitude.
      this.lfo = ctx.createOscillator();
      this.lfo.frequency.value = 0.07;
      this.lfoGain = ctx.createGain();
      this.lfoGain.gain.value = 0.05;
      this.lfo.connect(this.lfoGain);
      this.lfoGain.connect(this.out.gain);
      this.lfo.start();

      // Six oscillators in three pairs (root, fifth, octave), each detuned.
      this.oscs = [];
      for (let i = 0; i < 6; i++) {
        const o = ctx.createOscillator();
        o.type = i % 2 === 0 ? 'sawtooth' : 'triangle';
        o.frequency.value = 110;
        o.detune.value = (i - 2.5) * 4;
        const g = ctx.createGain();
        g.gain.value = i < 2 ? 0.16 : i < 4 ? 0.11 : 0.07;
        o.connect(g); g.connect(this.filter);
        o.start();
        this.oscs.push({ o, g });
      }

      engine.fanOut(this.out);
    }

    setLevel(v, time = 2.0) {
      this.out.gain.setTargetAtTime(v, this.engine.now, time / 3);
    }

    // Retune to the current harmony: root / fifth / octave layout.
    retune(harmony) {
      const t = this.engine.now;
      const base = harmony.rootFreq(-1);
      const fifth = harmony.fifthFreq(-1);
      const octave = harmony.rootFreq(0);
      const targets = [base, base, fifth, fifth, octave, octave];
      this.oscs.forEach((v, i) => {
        v.o.frequency.setTargetAtTime(targets[i], t, 3.0);
      });
    }

    applyMacros(m) {
      const t = this.engine.now;
      const cutoff = U.lerp(280, 2600, m.brightness) * U.lerp(0.8, 1.2, m.warmth);
      this.filter.frequency.setTargetAtTime(cutoff, t, 2.5);
      this.lfo.frequency.setTargetAtTime(U.lerp(0.03, 0.16, m.motion), t, 4.0);
    }
  }

  A.Engine = Engine;
  A.Drone = Drone;
  A.voices = { Bell, Pad, Sub };
})(window.Ambient);
