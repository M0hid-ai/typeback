'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const CONFIG_VERSION = 1;

const DEFAULTS = {
  version: CONFIG_VERSION,

  // Master switch. The tray toggle and the global hotkey both drive this.
  enabled: true,

  packId: 'thock',
  volume: 0.7,

  // Key-up sounds are quieter than key-down on every real keyboard, so the
  // release volume is a *multiplier* of the main volume rather than its own level.
  keyUpEnabled: true,
  keyUpVolume: 0.45,

  // The thing that stops it sounding like a machine gun. See audio/engine.js.
  randomizePitch: true,
  pitchVariance: 0.08,
  randomizeVolume: true,
  volumeVariance: 0.12,

  // Holding a key down makes Windows fire keydown ~30x/sec. Almost nobody wants
  // that turned into 30 clicks, so we swallow repeats by default.
  suppressRepeats: true,

  // Lowercased .exe names that Typeback stays silent in. Opera GX ships its own
  // keyboard sounds, so doubling up sounds broken — it's muted out of the box.
  mutedApps: ['opera_gx.exe'],

  muteHotkey: 'Control+Alt+M',
  launchAtStartup: false,
  startMinimized: false
};

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** Coerce whatever is on disk into something the audio engine can't choke on. */
function sanitize(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const out = { ...DEFAULTS };

  const bool = (k) => { if (typeof input[k] === 'boolean') out[k] = input[k]; };
  const num = (k, lo, hi) => {
    const v = Number(input[k]);
    if (Number.isFinite(v)) out[k] = clamp(v, lo, hi);
  };
  const str = (k) => { if (typeof input[k] === 'string' && input[k].trim()) out[k] = input[k].trim(); };

  bool('enabled');
  bool('keyUpEnabled');
  bool('randomizePitch');
  bool('randomizeVolume');
  bool('suppressRepeats');
  bool('launchAtStartup');
  bool('startMinimized');

  num('volume', 0, 1);
  num('keyUpVolume', 0, 1);
  num('pitchVariance', 0, 0.5);
  num('volumeVariance', 0, 0.5);

  str('packId');
  str('muteHotkey');

  if (Array.isArray(input.mutedApps)) {
    out.mutedApps = [
      ...new Set(
        input.mutedApps
          .filter((a) => typeof a === 'string' && a.trim())
          .map((a) => a.trim().toLowerCase())
      )
    ];
  }

  out.version = CONFIG_VERSION;
  return out;
}

class Config extends EventEmitter {
  constructor(dir) {
    super();
    this.file = path.join(dir, 'settings.json');
    this.values = { ...DEFAULTS };
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      this.values = sanitize(JSON.parse(raw));
    } catch (err) {
      // ENOENT is just a first run. Anything else means the file is corrupt —
      // we fall back to defaults rather than refusing to start, because an app
      // that won't launch is a worse outcome than one that forgot your volume.
      if (err.code !== 'ENOENT') {
        console.warn('[config] unreadable, falling back to defaults:', err.message);
      }
      this.values = { ...DEFAULTS };
    }
    return this.values;
  }

  get(key) {
    return this.values[key];
  }

  all() {
    return { ...this.values };
  }

  /** Merge a partial patch, persist, and tell listeners what actually changed. */
  update(patch) {
    const next = sanitize({ ...this.values, ...patch });
    const changed = Object.keys(next).filter(
      (k) => JSON.stringify(next[k]) !== JSON.stringify(this.values[k])
    );
    if (!changed.length) return this.all();

    this.values = next;
    this.save();
    this.emit('change', this.all(), changed);
    return this.all();
  }

  reset() {
    return this.update({ ...DEFAULTS });
  }

  // Write to a temp file then rename. A rename is atomic on NTFS, so pulling the
  // power mid-save leaves the old settings intact instead of a truncated file.
  save() {
    const tmp = `${this.file}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(this.values, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('[config] save failed:', err.message);
      try { fs.unlinkSync(tmp); } catch { /* nothing to clean up */ }
    }
  }
}

module.exports = { Config, DEFAULTS, CONFIG_VERSION, sanitize };
