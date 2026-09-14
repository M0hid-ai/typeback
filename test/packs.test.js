'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadPack, PackLibrary } = require('../src/main/packs');
const { GROUP_IDS } = require('../src/main/keymap');

/** Build a throwaway pack folder. `files` are created empty, relative to it. */
function makePack(t, manifest, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'typeback-packs-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const dir = path.join(root, 'pack');
  fs.mkdirSync(dir, { recursive: true });
  for (const file of files) {
    const abs = path.join(dir, file);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'x');
  }
  fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify(manifest));
  return { root, dir };
}

const names = (list) => list.map((f) => path.basename(f));

test('groups a pack leaves out inherit the default sounds', (t) => {
  const { dir } = makePack(t, { sounds: { default: { down: ['key.wav'] } } }, ['key.wav']);
  const pack = loadPack(dir, { builtin: false });

  assert.equal(pack.id, 'pack');
  assert.deepEqual(names(pack.groups.space.down), ['key.wav']);
});

test('a pack with no default press sounds is skipped', (t) => {
  t.mock.method(console, 'warn', () => {});
  const { dir } = makePack(t, { sounds: { space: { down: ['space.wav'] } } }, ['space.wav']);

  assert.equal(loadPack(dir, { builtin: false }), null);
});

test('sounds listed in the manifest but missing on disk are dropped', (t) => {
  const { dir } = makePack(t, { sounds: { default: { down: ['key.wav', 'gone.wav'] } } }, ['key.wav']);

  assert.deepEqual(names(loadPack(dir, { builtin: false }).groups.default.down), ['key.wav']);
});

test('paths that escape the pack folder are refused', (t) => {
  t.mock.method(console, 'warn', () => {});
  const { root, dir } = makePack(t, { sounds: { default: { down: ['key.wav', '../escape.wav'] } } }, ['key.wav']);
  fs.writeFileSync(path.join(root, 'escape.wav'), 'x');

  assert.deepEqual(names(loadPack(dir, { builtin: false }).groups.default.down), ['key.wav']);
});

test('a file whose name starts with .. is not mistaken for an escape', (t) => {
  const { dir } = makePack(t, { sounds: { default: { down: ['..clack.wav'] } } }, ['..clack.wav']);

  assert.deepEqual(names(loadPack(dir, { builtin: false }).groups.default.down), ['..clack.wav']);
});

test('every built-in pack has four genuinely different alternates per group', () => {
  const library = new PackLibrary({
    builtinDir: path.join(__dirname, '..', 'packs'),
    userDir: path.join(os.tmpdir(), 'typeback-no-user-packs')
  });
  const packs = library.refresh();
  assert.ok(packs.length >= 4);

  const hash = (file) => crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex');
  for (const pack of packs) {
    for (const group of GROUP_IDS) {
      for (const kind of ['down', 'up']) {
        const files = pack.groups[group][kind];
        assert.equal(files.length, 4, `${pack.id}/${kind}/${group}`);
        assert.equal(new Set(files.map(hash)).size, 4, `${pack.id}/${kind}/${group} has duplicate alternates`);
      }
    }
  }
});
