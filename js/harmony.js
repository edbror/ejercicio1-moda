/*
 * harmony.js — the slowly-shifting tonal centre of the instrument.
 *
 * The harmony has a root (a MIDI pitch) and a mode (a set of scale degrees).
 * Both drift on their own clock: every so often the system may step the root
 * through the circle of fifths and/or slide to a neighbouring mode. The user
 * never picks chords — they only influence *how restless* this clock is, via
 * the `motion` macro parameter.
 */
(function (A) {
  'use strict';
  const U = A.util;

  // Modes as semitone offsets from the root, ordered roughly bright -> dark.
  const MODES = {
    lydian:        [0, 2, 4, 6, 7, 9, 11],
    majorPent:     [0, 2, 4, 7, 9],
    ionian:        [0, 2, 4, 5, 7, 9, 11],
    mixolydian:    [0, 2, 4, 5, 7, 9, 10],
    dorian:        [0, 2, 3, 5, 7, 9, 10],
    minorPent:     [0, 3, 5, 7, 10],
    aeolian:       [0, 2, 3, 5, 7, 8, 10],
    phrygian:      [0, 1, 3, 5, 7, 8, 10],
  };
  const MODE_NAMES = Object.keys(MODES);

  // Scale degrees that count as "resting" chord tones — emphasised so the
  // texture keeps gravitating back to a consonant core.
  const CHORD_DEGREES = [0, 2, 4]; // root, third, fifth of the mode

  class Harmony {
    constructor() {
      this.root = 50;            // MIDI anchor (~ D3)
      this.modeName = 'dorian';
      this.mode = MODES[this.modeName];
      this.sinceChange = 0;
      this.changeListeners = [];
    }

    onChange(fn) { this.changeListeners.push(fn); }
    _emit() { this.changeListeners.forEach((fn) => fn(this)); }

    get noteName() {
      const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
      return names[((this.root % 12) + 12) % 12];
    }

    // Advance the harmonic clock. `motion` (0..1) scales how often it moves.
    update(dt, motion) {
      this.sinceChange += dt;
      // Mean interval between shifts: ~40s when calm, ~9s when restless.
      const meanInterval = U.lerp(40, 9, U.clamp(motion, 0, 1));
      const rate = 1 / meanInterval;
      if (this.sinceChange > 4 && Math.random() < U.chancePerSecond(rate, dt)) {
        this._shift(motion);
      }
    }

    _shift(motion) {
      this.sinceChange = 0;
      // Mostly move the root; occasionally swap the mode instead/as well.
      if (Math.random() < 0.7) {
        // Step around the circle of fifths (±7) or a gentler step.
        const moves = [7, -7, 5, -5, 2, -2, 3, -3];
        const w =     [3,  3, 2,  2, 1,  1, 1,  1];
        let next = this.root + U.weightedPick(moves, w);
        // Keep the anchor in a comfortable octave band.
        while (next < 45) next += 12;
        while (next > 57) next -= 12;
        this.root = next;
      }
      if (Math.random() < 0.4 + 0.3 * motion) {
        // Slide to a neighbouring mode (small change in colour).
        const idx = MODE_NAMES.indexOf(this.modeName);
        const step = U.pick([-1, 1, -1, 1, -2, 2]);
        const ni = U.clamp(idx + step, 0, MODE_NAMES.length - 1);
        this.modeName = MODE_NAMES[ni];
        this.mode = MODES[this.modeName];
      }
      this._emit();
    }

    // Frequency for a scale degree at a given octave offset. The final pitch is
    // clamped to a comfortable, always-audible band (~A0..C8) so extreme
    // register/spread settings fold back instead of disappearing.
    degreeToFreq(degree, octave = 0) {
      const len = this.mode.length;
      let d = degree;
      let oct = octave;
      while (d < 0) { d += len; oct -= 1; }
      while (d >= len) { d -= len; oct += 1; }
      let midi = this.root + this.mode[d] + 12 * oct;
      while (midi < 21) midi += 12;   // don't sink below ~A0
      while (midi > 108) midi -= 12;  // don't climb above ~C8
      return U.mtof(midi);
    }

    // Pick a pitch (Hz) for a new note, centred on `register` (0..1 -> low..high)
    // with a given octave `spread`. Chord tones are favoured.
    pickFreq(register, spread) {
      const len = this.mode.length;
      const useChordTone = Math.random() < 0.62;
      let degree;
      if (useChordTone) {
        const tones = CHORD_DEGREES.filter((d) => d < len);
        degree = U.pick(tones.length ? tones : [0]);
      } else {
        degree = U.randInt(0, len - 1);
      }
      // Octave centred on register, widened by spread.
      const centre = Math.round(U.map(register, 0, 1, -1, 3));
      const reach = Math.max(1, Math.round(spread * 3));
      const octave = centre + U.randInt(-reach, reach);
      return this.degreeToFreq(degree, octave);
    }

    rootFreq(octave = 0) { return U.mtof(this.root + 12 * octave); }
    fifthFreq(octave = 0) { return U.mtof(this.root + 7 + 12 * octave); }
  }

  A.Harmony = Harmony;
  A.MODES = MODES;
})(window.Ambient);
