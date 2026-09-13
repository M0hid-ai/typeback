'use strict';

const fs = require('fs');
const path = require('path');

const { GROUP_IDS, DEFAULT_GROUP } = require('./keymap');

/**
 * Pack discovery and validation.
 *
 * A pack is just a folder with a pack.json and some wavs. Two places are
 * scanned: the packs/ folder shipped inside the app, and a packs/ folder in the
 * user's data directory. User packs win on an id collision, which is what makes
 * "install a pack that replaces Thock" work without touching the install dir.
 */

const MANIFEST = 'pack.json';
const AUDIO_EXT = new Set(['.wav', '.mp3', '.ogg', '.flac', '.m4a', '.webm']);

function readManifest(dir) {
  const file = path.join(dir, MANIFEST);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`[packs] bad manifest in ${dir}: ${err.message}`);
    }
    return null;
  }
}

/**
 * Resolve a manifest's relative sound paths into absolute ones, dropping any
 * that aren't actually on disk. A pack that half-exists should still work for
 * the keys it does cover rather than failing to load entirely.
 */
function resolveList(dir, list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const entry of list) {
    if (typeof entry !== 'string' || !entry.trim()) continue;

    // Keep pack folders self-contained: a manifest must not be able to point at
    // arbitrary files elsewhere on the machine.
    const abs = path.resolve(dir, entry);
    const rel = path.relative(dir, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      console.warn(`[packs] ignoring path outside pack: ${entry}`);
      continue;
    }
    if (!AUDIO_EXT.has(path.extname(abs).toLowerCase())) continue;
    if (!fs.existsSync(abs)) continue;

    out.push(abs);
  }
  return out;
}

function loadPack(dir, { builtin }) {
  const manifest = readManifest(dir);
  if (!manifest || typeof manifest !== 'object') return null;

  const id = typeof manifest.id === 'string' && manifest.id.trim()
    ? manifest.id.trim()
    : path.basename(dir);

  const rawSounds = manifest.sounds && typeof manifest.sounds === 'object' ? manifest.sounds : {};

  const groups = {};
  for (const group of GROUP_IDS) {
    const spec = rawSounds[group] || {};
    groups[group] = {
      down: resolveList(dir, spec.down),
      up: resolveList(dir, spec.up)
    };
  }

  // A pack is only usable if the catch-all group has at least one press sound.
  if (!groups[DEFAULT_GROUP].down.length) {
    console.warn(`[packs] "${id}" has no ${DEFAULT_GROUP} down sounds, skipping`);
    return null;
  }

  // Anything the author left out inherits the default group, so a minimal pack
  // with six files still sounds correct on every key.
  for (const group of GROUP_IDS) {
    if (group === DEFAULT_GROUP) continue;
    if (!groups[group].down.length) groups[group].down = groups[DEFAULT_GROUP].down;
    if (!groups[group].up.length) groups[group].up = groups[DEFAULT_GROUP].up;
  }

  return {
    id,
    name: typeof manifest.name === 'string' && manifest.name.trim() ? manifest.name.trim() : id,
    description: typeof manifest.description === 'string' ? manifest.description : '',
    author: typeof manifest.author === 'string' ? manifest.author : 'Unknown',
    version: typeof manifest.version === 'string' ? manifest.version : '1.0.0',
    builtin,
    dir,
    hasKeyUp: groups[DEFAULT_GROUP].up.length > 0,
    groups
  };
}

function scanDir(root, builtin) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];               // missing user pack dir on first run is normal
  }

  const found = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pack = loadPack(path.join(root, entry.name), { builtin });
    if (pack) found.push(pack);
  }
  return found;
}

class PackLibrary {
  constructor({ builtinDir, userDir }) {
    this.builtinDir = builtinDir;
    this.userDir = userDir;
    this.packs = new Map();
  }

  refresh() {
    this.packs = new Map();
    // Built-ins first so user packs of the same id overwrite them.
    for (const pack of scanDir(this.builtinDir, true)) this.packs.set(pack.id, pack);
    for (const pack of scanDir(this.userDir, false)) this.packs.set(pack.id, pack);
    return this.list();
  }

  list() {
    return [...this.packs.values()].sort((a, b) => {
      if (a.builtin !== b.builtin) return a.builtin ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  get(id) {
    return this.packs.get(id) || null;
  }

  /** The requested pack, or any pack at all, so the app is never left mute. */
  resolve(id) {
    return this.get(id) || this.list()[0] || null;
  }

  /** Manifest-shaped summaries for the settings UI (no absolute paths). */
  summaries() {
    return this.list().map(({ id, name, description, author, version, builtin, hasKeyUp }) => ({
      id, name, description, author, version, builtin, hasKeyUp
    }));
  }
}

module.exports = { PackLibrary, loadPack, AUDIO_EXT };
