'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Config, DEFAULTS, sanitize } = require('../src/main/config');

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'typeback-config-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('numbers are clamped into range', () => {
  const c = sanitize({ volume: 7, keyUpVolume: -2, pitchVariance: 9 });
  assert.equal(c.volume, 1);
  assert.equal(c.keyUpVolume, 0);
  assert.equal(c.pitchVariance, 0.5);
});

test('values of the wrong type fall back to defaults', () => {
  const c = sanitize({ enabled: 'yes', volume: 'loud', packId: 42 });
  assert.equal(c.enabled, DEFAULTS.enabled);
  assert.equal(c.volume, DEFAULTS.volume);
  assert.equal(c.packId, DEFAULTS.packId);
});

test('muted apps are trimmed, lowercased and deduped', () => {
  const c = sanitize({ mutedApps: ['Discord.exe', ' discord.exe ', 'CODE.EXE', 42, ''] });
  assert.deepEqual(c.mutedApps, ['discord.exe', 'code.exe']);
});

test('a corrupt settings file falls back to defaults instead of crashing', (t) => {
  const dir = tmpDir(t);
  fs.writeFileSync(path.join(dir, 'settings.json'), '{ not json');
  t.mock.method(console, 'warn', () => {});

  assert.deepEqual(new Config(dir).load(), DEFAULTS);
});

test('updates are saved and only report what actually changed', (t) => {
  const dir = tmpDir(t);
  const config = new Config(dir);
  config.load();

  let changed = null;
  config.on('change', (_values, keys) => { changed = keys; });
  config.update({ volume: 0.3, enabled: DEFAULTS.enabled });

  assert.deepEqual(changed, ['volume']);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
  assert.equal(saved.volume, 0.3);
  assert.equal(fs.existsSync(path.join(dir, 'settings.json.tmp')), false);
});

test('an update that changes nothing does not touch the disk', (t) => {
  const dir = tmpDir(t);
  const config = new Config(dir);
  config.load();
  config.update({ volume: DEFAULTS.volume });

  assert.equal(fs.existsSync(path.join(dir, 'settings.json')), false);
});
