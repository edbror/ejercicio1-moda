/*
 * cosmos.js — sync the instrument to live space weather.
 *
 * This is the "truly out of this world" data source: real-time solar-wind and
 * geomagnetic telemetry from NOAA's Space Weather Prediction Center, measured
 * by the DSCOVR / ACE spacecraft parked at the L1 Lagrange point ~1.5 million
 * km sunward of Earth, plus the planetary Kp storm index. No API key, open
 * CORS, refreshed about once a minute.
 *
 *   plasma : solar-wind proton speed / density / temperature
 *   mag    : interplanetary magnetic field — Bz (north/south) and Bt (total)
 *   kp     : planetary geomagnetic activity index, 0 (calm) .. 9 (severe storm)
 *
 * The physics genuinely drives the music. Southward Bz is the actual trigger
 * of geomagnetic storms and aurorae, so here it darkens the harmony; a fast
 * gusty wind makes the system restless; a Kp jump or a sharp southward turn of
 * Bz fires a "substorm" gust that shakes the instrument into a new key.
 *
 * Everything that touches the network lives in CosmosFeed. The parse + mapping
 * layer below is pure, so it can be unit-tested headlessly.
 */
(function (A) {
  'use strict';
  const U = A.util;

  const FEEDS = {
    plasma: 'https://services.swpc.noaa.gov/products/solar-wind/plasma-1-day.json',
    mag:    'https://services.swpc.noaa.gov/products/solar-wind/mag-1-day.json',
    kp:     'https://services.swpc.noaa.gov/json/planetary_k_index_1m.json',
  };

  // Physical ranges used to normalise each measurement into [0,1].
  const RANGE = {
    speed: [250, 750],     // km/s  (quiet ~350, fast stream/CME 600+)
    protons: [0, 20],      // /cm^3
    temp: [1e4, 5e5],      // K
    bz: [-12, 12],         // nT    (negative = southward = stormy)
    bt: [0, 20],           // nT    total field strength
    kp: [0, 9],            // index
  };

  // --- pure parsers -----------------------------------------------------------
  // The "products" feeds are arrays-of-arrays with a header row of column names;
  // the "json" Kp feed is an array of objects. Both are parsed defensively: we
  // scan from the newest row backward for the first numeric, finite value.

  function lastFiniteFromColumns(rows, colName, aliases) {
    if (!Array.isArray(rows) || rows.length < 2) return null;
    const header = rows[0].map((h) => String(h).toLowerCase());
    const names = [colName].concat(aliases || []).map((s) => s.toLowerCase());
    let col = -1;
    for (const n of names) { const i = header.indexOf(n); if (i !== -1) { col = i; break; } }
    if (col === -1) return null;
    for (let r = rows.length - 1; r >= 1; r--) {
      const v = parseFloat(rows[r][col]);
      if (Number.isFinite(v)) return v;
    }
    return null;
  }

  function parsePlasma(json) {
    return {
      speed: lastFiniteFromColumns(json, 'speed'),
      protons: lastFiniteFromColumns(json, 'density'),
      temp: lastFiniteFromColumns(json, 'temperature', ['temp']),
    };
  }

  function parseMag(json) {
    return {
      bz: lastFiniteFromColumns(json, 'bz_gsm', ['bz']),
      bt: lastFiniteFromColumns(json, 'bt'),
    };
  }

  function parseKp(json) {
    if (!Array.isArray(json) || json.length === 0) return { kp: null };
    for (let i = json.length - 1; i >= 0; i--) {
      const row = json[i];
      const v = parseFloat(row.kp_index != null ? row.kp_index : row.kp);
      if (Number.isFinite(v)) return { kp: v };
    }
    return { kp: null };
  }

  // Merge whatever parsed cleanly into a single reading; nulls are dropped so a
  // partially-available set of feeds still works.
  function combine(plasma, mag, kp) {
    const out = {};
    [plasma, mag, kp].forEach((src) => {
      if (!src) return;
      for (const k in src) if (Number.isFinite(src[k])) out[k] = src[k];
    });
    return out;
  }

  const norm = (x, [lo, hi]) => U.clamp((x - lo) / (hi - lo), 0, 1);

  // --- the mapping from physics to musical macro targets ----------------------
  // Returns { targets:{macro->[0,1]}, colorBias:[-1,1] } for whatever data is
  // present. Each measurement is used once, mapped to a sensible axis.
  function mapToTargets(reading) {
    const targets = {};
    let colorBias = null;

    if (Number.isFinite(reading.speed)) {
      const s = norm(reading.speed, RANGE.speed);
      targets.motion = s;                 // fast wind -> restless
      targets.warmth = U.clamp(1 - s, 0, 1); // calm wind -> warm pads
    }
    if (Number.isFinite(reading.kp)) {
      targets.density = U.lerp(0.15, 0.95, norm(reading.kp, RANGE.kp)); // storm -> busy
    }
    if (Number.isFinite(reading.bz)) {
      const b = norm(reading.bz, RANGE.bz); // 0 (deep south) .. 1 (deep north)
      targets.brightness = U.lerp(0.18, 0.85, b); // north -> bright
      colorBias = U.clamp(reading.bz / RANGE.bz[1], -1, 1); // south -> dark modes
    }
    if (Number.isFinite(reading.bt)) {
      targets.space = U.lerp(0.3, 0.95, norm(reading.bt, RANGE.bt)); // field -> cavernous
    }
    if (Number.isFinite(reading.temp)) {
      targets.register = U.lerp(0.3, 0.8, norm(reading.temp, RANGE.temp)); // hot -> higher
    }
    if (Number.isFinite(reading.protons)) {
      targets.spread = U.lerp(0.2, 0.9, norm(reading.protons, RANGE.protons)); // dense -> wider
    }
    return { targets, colorBias };
  }

  // Decide whether a new reading represents a "substorm" relative to the last —
  // a Kp jump or a sharp southward turn of Bz. Either shakes the instrument.
  function isSubstorm(prev, next) {
    if (!prev) return false;
    if (Number.isFinite(prev.kp) && Number.isFinite(next.kp) && next.kp - prev.kp >= 1) return true;
    if (Number.isFinite(prev.bz) && Number.isFinite(next.bz) && next.bz - prev.bz <= -5) return true;
    return false;
  }

  // --- the browser-side fetcher ----------------------------------------------
  class CosmosFeed {
    constructor(opts = {}) {
      this.intervalMs = opts.intervalMs || 60000;
      this.timer = null;
      this.last = null;        // last combined reading
      this.lastMapped = null;  // last { targets, colorBias }
      this.status = 'idle';    // idle | loading | live | error
      this.onData = null;      // (reading, mapped, {substorm}) => void
      this.onStatus = null;    // (status, errOrNull) => void
    }

    _setStatus(s, err) { this.status = s; if (this.onStatus) this.onStatus(s, err || null); }

    async _getJSON(url) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12000);
      try {
        const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return await res.json();
      } finally {
        clearTimeout(t);
      }
    }

    async fetchOnce() {
      this._setStatus('loading');
      // Fetch all three in parallel; tolerate individual failures.
      const [plasma, mag, kp] = await Promise.all([
        this._getJSON(FEEDS.plasma).catch(() => null),
        this._getJSON(FEEDS.mag).catch(() => null),
        this._getJSON(FEEDS.kp).catch(() => null),
      ]);
      if (!plasma && !mag && !kp) {
        this._setStatus('error', new Error('all feeds unreachable'));
        return null;
      }
      const reading = combine(
        plasma && parsePlasma(plasma),
        mag && parseMag(mag),
        kp && parseKp(kp)
      );
      const mapped = mapToTargets(reading);
      const substorm = isSubstorm(this.last, reading);
      this.last = reading;
      this.lastMapped = mapped;
      this._setStatus('live');
      if (this.onData) this.onData(reading, mapped, { substorm });
      return reading;
    }

    start() {
      this.stop();
      this.fetchOnce();
      this.timer = setInterval(() => this.fetchOnce(), this.intervalMs);
    }

    stop() {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
    }
  }

  A.Cosmos = {
    CosmosFeed,
    // exported for tests / tinkering
    parsePlasma, parseMag, parseKp, combine, mapToTargets, isSubstorm, RANGE, FEEDS,
  };
})(window.Ambient);
