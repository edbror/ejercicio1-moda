# Drift — a generative ambient instrument

A self-evolving ambient soundscape, **synthesized live in the browser** with
the Web Audio API. There are no samples and no recordings anywhere in this
repo — every sound you hear (including the reverb's impulse response) is
computed from oscillators and noise at runtime.

The core idea: underneath the sound runs a slowly evolving *weather system*.
You can **nudge** it, but you can never fully **command** it.

> Open `index.html` in any modern browser and press **Play**. Headphones
> recommended.

> 📖 **Curatorial & critical texts** — artist statement, press release,
> catalogue essay, wall labels and the full synopsis — live in
> [`art/`](art/README.md). The piece's statement is also readable in-app via the
> **Drift** title (or the `?` key).

## Sync to the sky 🛰️

Press **Cosmos** (or the `C` key) and the instrument stops inventing its own
weather and tunes itself to **live space weather** instead — real-time
solar-wind and geomagnetic telemetry from NOAA's Space Weather Prediction
Center, measured by the DSCOVR / ACE spacecraft at the **L1 Lagrange point**
~1.5 million km sunward of Earth, refreshed about once a minute. No API key, no
backend; your browser fetches it directly.

The physics genuinely drives the music:

| Live measurement | Source | Drives |
| --- | --- | --- |
| Solar-wind **speed** (~300–800 km/s) | DSCOVR plasma | **Motion** — fast wind ⇒ restless, frequent key changes |
| **IMF Bz** (field north/south) | DSCOVR mag | **Brightness + mode colour** — *southward* Bz (the real trigger of storms & aurorae) darkens the harmony; northward brightens it |
| **Kp** index (0–9) | planetary K | **Density** — a storm thickens the texture |
| **Bt** (total field) | DSCOVR mag | **Space** — stronger field ⇒ more cavernous |
| proton **temperature** | DSCOVR plasma | **Register** |
| proton **density** | DSCOVR plasma | **Spread** |

A **substorm** — a sharp jump in Kp or a sudden southward turn of Bz — fires a
gust *and* forces an immediate key change: the sky literally re-keys the music.
Even fully synced, you keep nudging: the cosmic targets blend with your sliders
and still get the autonomous wander layered on top. Markers driven by the
cosmos glow warm. (If the feeds are unreachable, the instrument just keeps
making its own weather.)

## How it works

```
controls (your wishes)
        │  targets
        ▼
   drift.js ──macros──┬─> scheduler.js ──> audio.js ──> 🔊
   (the weather)      ├─> audio.js (effects + drone)
                      └─> visuals.js ──> 🖼️ canvas
        ▲
   harmony.js (tonal centre, on its own clock)
```

### The weather (`drift.js`)
Seven macro parameters — *density, brightness, register, spread, motion, space,
warmth* — each follow a mean-reverting random walk. Crucially, the target a
slider sets is **not** the target the system uses: the system adds its own slow,
autonomous *wander* on top of your wish. So your input biases the weather; it
doesn't dictate it. Leave everything alone and it still breathes. The glowing
marker on each slider shows where the value **actually drifted to** — you can
literally watch the gap between what you asked for and what the system decided.

The **Gust** button (or the `G` key) shoves every parameter's wander in a fresh
random direction — the one moment of direct, blunt influence you get.

### The harmony (`harmony.js`)
A root pitch and a mode that drift on their own clock, stepping through the
circle of fifths and sliding between neighbouring modes (lydian → … →
phrygian). How restless this clock is scales with the *motion* macro. You never
choose chords directly; you only influence the ground shifting under you:

- **How often it changes** — the *Motion* macro (≈ every 40 s when calm, ≈ 9 s
  when restless).
- **Which colour it drifts toward** — a `colorBias` (−1 dark … +1 bright) tilts
  the odds of mode steps. When synced to the cosmos this is driven by the IMF
  Bz; otherwise it sits neutral.
- **A shove** — *Gust* perturbs the weather, and a geomagnetic substorm calls
  `forceShift()` for an immediate re-key.

### The synthesis (`audio.js`)
- **Drone bed** — six detuned saw/triangle oscillators (root/fifth/octave)
  through a breathing low-pass filter, retuned whenever the harmony shifts.
- **Bell** — a 2-operator FM voice with inharmonic ratios and a decaying
  modulation index, for glassy plucks.
- **Pad** — an additive stack of detuned partials with long swells.
- **Sub** — deep sine swells, felt more than heard.
- **Effects** — a convolution reverb whose impulse response is generated noise,
  plus a filtered stereo ping-pong delay, into a soft-saturating limited master
  bus.

### The scheduler (`scheduler.js`)
Uses the standard Web Audio look-ahead pattern. Note onsets are **not** on a
grid — they follow Poisson (exponential) spacing whose rate is set by *density*,
so the texture pulses and thins organically instead of ticking.

### The visuals (`visuals.js`)
A living canvas that only listens. Every scheduled note drops an expanding
"bloom" placed by pitch (vertical) and pan (horizontal); drifting motes and a
slowly shifting background gradient track the weather even in near-silence.

## Controls

| Control | What it biases |
| --- | --- |
| Density | how often notes arrive |
| Brightness | dark & soft ↔ open & glassy |
| Register | low ↔ high centre of pitch |
| Spread | how wide the voicing roams |
| Motion | how restless the whole system is |
| Space | intimate ↔ cavernous |
| Warmth | bells ↔ pads |

Keyboard: **Space** = play/pause · **G** = gust.

## Running

No build step, no dependencies. Just open `index.html`. (Some browsers restrict
the Web Audio API on `file://`; if you hit that, serve the folder, e.g.
`python3 -m http.server` and open `http://localhost:8000`.)

## Tests

A headless smoke test mocks the Web Audio API so the real engine, drift,
harmony and scheduler logic can run under Node:

```
npm test       # or: node test/smoke.js
```

---

*The old "Disclosure — Favorites" coursework page that previously lived here is
preserved as `disclosure.html` / `disclosure.css`.*
