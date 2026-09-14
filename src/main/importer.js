'use strict';

const fs = require('fs/promises');
const path = require('path');
const { dialog, shell } = require('electron');

const { GROUP_IDS, DEFAULT_GROUP } = require('./keymap');
const { AUDIO_EXT } = require('./packs');

/**
 * Importing a custom pack.
 *
 * Two shapes are accepted, because people find sounds in both forms:
 *
 *   1. A proper pack folder with a pack.json - copied in as-is.
 *   2. A folder of loose audio files - a manifest is written for them by
 *      matching filenames against the group names. Most sound packs you find
 *      online are shaped like this, and asking a user to hand-write JSON before
 *      they can hear anything is a terrible first experience.
 */

// Words that map a filename onto a group. Longest match wins, so "backspace"
// isn't caught by "space".
const GROUP_HINTS = [
  ['backspace', 'backspace'], ['delete', 'backspace'], ['bksp', 'backspace'],
  ['spacebar', 'space'], ['space', 'space'],
  ['enter', 'enter'], ['return', 'enter'],
  ['modifier', 'modifier'], ['shift', 'modifier'], ['ctrl', 'modifier'],
  ['control', 'modifier'], ['alt', 'modifier'], ['tab', 'modifier'], ['caps', 'modifier'],
  ['number', 'number'], ['digit', 'number'], ['numpad', 'number']
].sort((a, b) => b[0].length - a[0].length);

const UP_HINTS = ['keyup', 'key-up', 'key_up', 'release', 'released', '-up', '_up', 'up-'];

function classifyFile(relPath) {
  const lower = relPath.toLowerCase().replace(/\\/g, '/');
  const segments = lower.split('/');
  const name = segments[segments.length - 1];

  // A top-level up/ or release/ folder wins over any filename hint.
  const inUpFolder = segments.slice(0, -1).some((s) => s === 'up' || s === 'release');
  const kind = inUpFolder || UP_HINTS.some((h) => name.includes(h)) ? 'up' : 'down';

  // A down/ or up/ folder name shouldn't also be read as a group hint, so match
  // groups against the filename only.
  const group = (GROUP_HINTS.find(([hint]) => name.includes(hint)) || [null, DEFAULT_GROUP])[1];

  return { group, kind };
}

async function listAudioFiles(dir, base = dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...await listAudioFiles(abs, base));
    } else if (AUDIO_EXT.has(path.extname(entry.name).toLowerCase())) {
      out.push(path.relative(base, abs).split(path.sep).join('/'));
    }
  }
  return out;
}

/** Invent a manifest for a folder of loose audio files. */
async function synthesiseManifest(dir) {
  const files = await listAudioFiles(dir);
  if (!files.length) return null;

  const sounds = {};
  for (const group of GROUP_IDS) sounds[group] = { down: [], up: [] };

  for (const file of files) {
    const { group, kind } = classifyFile(file);
    sounds[group][kind].push(file);
  }

  // Every pack needs a usable default group. If the filenames didn't produce
  // one, fall back to treating everything as a normal key - better a pack that
  // sounds uniform than one that refuses to load.
  if (!sounds[DEFAULT_GROUP].down.length) {
    sounds[DEFAULT_GROUP].down = files.filter((f) => classifyFile(f).kind === 'down');
  }
  if (!sounds[DEFAULT_GROUP].down.length) sounds[DEFAULT_GROUP].down = files;

  return {
    id: path.basename(dir).toLowerCase().replace(/[^a-z0-9-_]+/g, '-'),
    name: path.basename(dir),
    description: 'Imported pack.',
    author: 'Imported',
    version: '1.0.0',
    sounds
  };
}

/** Pick a folder name that doesn't collide with an existing pack. */
async function uniqueDir(userDir, id) {
  let candidate = id;
  let n = 2;
  for (;;) {
    try {
      await fs.access(path.join(userDir, candidate));
      candidate = `${id}-${n++}`;        // taken, try the next
    } catch {
      return candidate;                  // free
    }
  }
}

async function importPack({ userDir, parent }) {
  const result = await dialog.showOpenDialog(parent, {
    title: 'Choose a sound pack folder',
    properties: ['openDirectory'],
    buttonLabel: 'Import'
  });
  if (result.canceled || !result.filePaths.length) return { imported: false };

  const source = result.filePaths[0];

  try {
    let raw = null;
    try {
      raw = await fs.readFile(path.join(source, 'pack.json'), 'utf8');
    } catch {
      // No manifest at all - a folder of loose sounds. We'll write one for it.
    }

    let manifest = null;
    if (raw === null) {
      manifest = await synthesiseManifest(source);
    } else {
      // A pack.json that exists but won't parse is a mistake the author needs to
      // hear about. Quietly guessing a manifest instead threw away their group
      // assignments without ever saying why.
      try {
        manifest = JSON.parse(raw);
      } catch (err) {
        return { imported: false, error: `pack.json isn't valid JSON: ${err.message}` };
      }
      if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        return { imported: false, error: 'pack.json should be a JSON object.' };
      }
    }

    if (!manifest) {
      return { imported: false, error: 'No audio files found in that folder.' };
    }

    const id = String(manifest.id || path.basename(source))
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, '-');

    await fs.mkdir(userDir, { recursive: true });
    const folder = await uniqueDir(userDir, id);
    const target = path.join(userDir, folder);

    await fs.cp(source, target, { recursive: true });

    // Write the manifest last so it reflects the final id, and so a synthesised
    // one lands in the copy rather than polluting the user's source folder.
    manifest.id = folder;
    await fs.writeFile(
      path.join(target, 'pack.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8'
    );

    return { imported: true, id: folder, name: manifest.name || folder };
  } catch (err) {
    console.error('[import] failed:', err.message);
    return { imported: false, error: err.message };
  }
}

async function openPacksFolder(userDir) {
  await fs.mkdir(userDir, { recursive: true });
  shell.openPath(userDir);
}

module.exports = { importPack, openPacksFolder, classifyFile, synthesiseManifest };
