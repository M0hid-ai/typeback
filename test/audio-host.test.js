'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { AudioHost } = require('../src/main/audio-host');

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'typeback-audio-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const pack = (id, files) => ({ id, groups: { default: { down: files, up: [] } } });

function recordingHost({ ready }) {
  const host = new AudioHost();
  host.ready = ready;
  host.sent = [];
  host.send = (_channel, payload) => host.sent.push(payload.packId);
  return host;
}

test('switching packs quickly never lets the older pack win', async (t) => {
  const dir = tmpDir(t);

  // One pack that takes a while to read and one that's instant, requested in
  // that order - the same thing as clicking one pack and then another.
  const big = Buffer.alloc(4 * 1024 * 1024);
  const slow = [];
  for (let i = 0; i < 24; i++) {
    const file = path.join(dir, `slow-${i}.wav`);
    fs.writeFileSync(file, big);
    slow.push(file);
  }
  const fast = path.join(dir, 'fast.wav');
  fs.writeFileSync(fast, Buffer.alloc(16));

  const host = recordingHost({ ready: true });
  await Promise.all([
    host.loadPack(pack('old', slow)),
    host.loadPack(pack('new', [fast]))
  ]);

  assert.deepEqual(host.sent, ['new']);
});

test('a pack loaded before the engine is ready waits for it', async (t) => {
  const file = path.join(tmpDir(t), 'key.wav');
  fs.writeFileSync(file, Buffer.alloc(16));

  const host = recordingHost({ ready: false });
  await host.loadPack(pack('early', [file]));

  assert.deepEqual(host.sent, []);
  assert.equal(host.pendingPack.packId, 'early');
});
