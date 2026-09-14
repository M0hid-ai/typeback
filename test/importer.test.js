'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// importer.js takes dialog and shell from electron. Under plain node that module
// is just a path string, so swap in a dialog that "picks" whatever folder the
// test says.
let picked = null;
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath,
  filename: electronPath,
  loaded: true,
  exports: {
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [picked] }) },
    shell: { openPath() {} }
  }
};

const { importPack, classifyFile } = require('../src/main/importer');

function scratch(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'typeback-import-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const userDir = path.join(root, 'user-packs');
  return {
    userDir,
    folder(name, files) {
      const dir = path.join(root, name);
      fs.mkdirSync(dir, { recursive: true });
      for (const [file, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), body);
      return dir;
    },
    installed: () => (fs.existsSync(userDir) ? fs.readdirSync(userDir) : [])
  };
}

test('filenames map onto the right group and kind', () => {
  assert.deepEqual(classifyFile('space.wav'), { group: 'space', kind: 'down' });
  assert.deepEqual(classifyFile('backspace-2.wav'), { group: 'backspace', kind: 'down' });
  assert.deepEqual(classifyFile('shift.wav'), { group: 'modifier', kind: 'down' });
  assert.deepEqual(classifyFile('up/enter.wav'), { group: 'enter', kind: 'up' });
  assert.deepEqual(classifyFile('key-release.wav'), { group: 'default', kind: 'up' });
  assert.deepEqual(classifyFile('key-3.wav'), { group: 'default', kind: 'down' });
});

test('a broken pack.json is reported, not quietly replaced', async (t) => {
  const s = scratch(t);
  picked = s.folder('broken', { 'pack.json': '{ "id": "x", oops', 'key.wav': 'x' });

  const result = await importPack({ userDir: s.userDir, parent: null });

  assert.equal(result.imported, false);
  assert.match(result.error, /isn't valid JSON/);
  assert.deepEqual(s.installed(), []);
});

test('a pack.json that is not an object is refused', async (t) => {
  const s = scratch(t);
  picked = s.folder('array', { 'pack.json': '[1, 2]', 'key.wav': 'x' });

  const result = await importPack({ userDir: s.userDir, parent: null });

  assert.equal(result.imported, false);
  assert.deepEqual(s.installed(), []);
});

test('a valid pack is copied in', async (t) => {
  const s = scratch(t);
  const manifest = { id: 'good', sounds: { default: { down: ['key.wav'] } } };
  picked = s.folder('good', { 'pack.json': JSON.stringify(manifest), 'key.wav': 'x' });

  const result = await importPack({ userDir: s.userDir, parent: null });

  assert.equal(result.imported, true);
  assert.deepEqual(s.installed(), ['good']);
});

test('loose wavs get a manifest written into the copy, not the source', async (t) => {
  const s = scratch(t);
  picked = s.folder('Loose Pack', { 'key.wav': 'x', 'space.wav': 'x' });

  const result = await importPack({ userDir: s.userDir, parent: null });

  assert.equal(result.imported, true);
  assert.equal(result.id, 'loose-pack');
  const manifest = JSON.parse(fs.readFileSync(path.join(s.userDir, 'loose-pack', 'pack.json'), 'utf8'));
  assert.deepEqual(manifest.sounds.space.down, ['space.wav']);
  assert.equal(fs.existsSync(path.join(picked, 'pack.json')), false);
});

test('importing the same pack twice keeps both', async (t) => {
  const s = scratch(t);
  const manifest = { id: 'good', sounds: { default: { down: ['key.wav'] } } };
  picked = s.folder('good', { 'pack.json': JSON.stringify(manifest), 'key.wav': 'x' });

  await importPack({ userDir: s.userDir, parent: null });
  const second = await importPack({ userDir: s.userDir, parent: null });

  assert.equal(second.id, 'good-2');
  assert.deepEqual(s.installed().sort(), ['good', 'good-2']);
});
