/*
 * snapshot.js — capture a "now playing" still of the instrument.
 *
 * Composites the live visuals canvas with a typographic overlay (title, the
 * current key/mode, a short mood line distilled from the macros, and the live
 * sky telemetry if synced) onto an offscreen canvas, then hands back a PNG
 * blob / data URL. No sound, no network — just a portrait of this exact,
 * unrepeatable moment of the piece.
 */
(function (A) {
  'use strict';
  const U = A.util;

  // Turn the macro weather into a couple of evocative words.
  function moodWords(m) {
    const parts = [];
    parts.push(m.brightness > 0.62 ? 'luminous' : m.brightness < 0.32 ? 'shadowed' : 'dim');
    if (m.density > 0.6) parts.push('teeming');
    else if (m.density < 0.25) parts.push('sparse');
    else parts.push('drifting');
    if (m.space > 0.7) parts.push('cavernous');
    else if (m.space < 0.3) parts.push('intimate');
    if (m.motion > 0.6) parts.push('restless');
    else if (m.motion < 0.3) parts.push('still');
    return parts.slice(0, 3).join(' · ');
  }

  function skyLine(reading) {
    if (!reading) return null;
    const bits = [];
    if (Number.isFinite(reading.speed)) bits.push(`wind ${Math.round(reading.speed)} km/s`);
    if (Number.isFinite(reading.bz)) bits.push(`Bz ${reading.bz >= 0 ? '+' : ''}${reading.bz.toFixed(1)} nT`);
    if (Number.isFinite(reading.kp)) bits.push(`Kp ${reading.kp.toFixed(1)}`);
    return bits.length ? bits.join('   ') : null;
  }

  // Compose and return { canvas, dataURL }. `opts`:
  //   { sourceCanvas, macros, keyText, reading, synced }
  function compose(opts) {
    const src = opts.sourceCanvas;
    const W = 1200, H = 1200; // square, good for sharing
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');

    // 1. The live field, cover-fit and centre-cropped into the square.
    ctx.fillStyle = '#05070b';
    ctx.fillRect(0, 0, W, H);
    if (src && src.width && src.height) {
      const scale = Math.max(W / src.width, H / src.height);
      const dw = src.width * scale, dh = src.height * scale;
      ctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
    }

    // 2. Vignette + bottom scrim so text reads on any frame.
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(3,5,9,0.55)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    const scrim = ctx.createLinearGradient(0, H * 0.55, 0, H);
    scrim.addColorStop(0, 'rgba(3,5,9,0)');
    scrim.addColorStop(1, 'rgba(3,5,9,0.92)');
    ctx.fillStyle = scrim; ctx.fillRect(0, H * 0.55, W, H * 0.45);

    const m = opts.macros || {};
    const pad = 70;
    ctx.textBaseline = 'alphabetic';

    // 3. Title mark, top-left.
    ctx.fillStyle = '#e8eef6';
    ctx.font = '600 34px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('◓  DRIFT', pad, pad + 30);
    ctx.fillStyle = 'rgba(138,148,166,0.9)';
    ctx.font = '400 18px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('a generative ambient instrument', pad, pad + 58);

    // 4. The key — the big statement, lower-left.
    const baseY = H - pad - 150;
    ctx.fillStyle = 'rgba(127,211,230,0.9)';
    ctx.font = '600 16px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('KEY', pad, baseY);
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 84px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(opts.keyText || '—', pad, baseY + 84);

    // 5. Mood line.
    ctx.fillStyle = 'rgba(230,176,127,0.95)';
    ctx.font = '400 italic 30px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(moodWords(m), pad, baseY + 132);

    // 6. Sky telemetry (if synced) + timestamp, bottom strip.
    const sky = opts.synced ? skyLine(opts.reading) : null;
    ctx.fillStyle = 'rgba(232,238,246,0.85)';
    ctx.font = '500 22px ui-monospace, monospace';
    const stamp = new Date().toISOString().replace('T', '  ').slice(0, 16) + ' UTC';
    if (sky) {
      ctx.fillStyle = 'rgba(127,211,230,0.95)';
      ctx.fillText('● ' + sky, pad, H - pad);
      ctx.fillStyle = 'rgba(138,148,166,0.85)';
      ctx.font = '400 18px ui-monospace, monospace';
      ctx.fillText('synced to live space weather · NOAA SWPC @ L1 · ' + stamp, pad, H - pad + 28);
    } else {
      ctx.fillStyle = 'rgba(138,148,166,0.85)';
      ctx.fillText(stamp, pad, H - pad);
    }

    return { canvas: cv, dataURL: cv.toDataURL('image/png') };
  }

  function download(dataURL, filename) {
    const a = document.createElement('a');
    a.href = dataURL;
    a.download = filename || 'drift.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  A.Snapshot = { compose, download, moodWords, skyLine };
})(window.Ambient);
