'use strict';

const fs = require('fs/promises');
const path = require('path');
const { BrowserWindow, ipcMain } = require('electron');

/**
 * Owns the hidden window that actually makes noise.
 *
 * Sound files are read here and shipped to the renderer as ArrayBuffers rather
 * than letting the renderer load file:// URLs. That keeps the engine sandboxed
 * with no filesystem access, and it works unchanged once the app is packed into
 * an asar, where file:// paths get awkward.
 */
class AudioHost {
  constructor() {
    this.window = null;
    this.ready = false;
    this.pendingPack = null;
    this.settings = null;
    this.loadedPackId = null;
  }

  start() {
    this.window = new BrowserWindow({
      show: false,
      width: 320,
      height: 200,
      // Skip the taskbar and any window animation work for a window nobody sees.
      skipTaskbar: true,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'audio-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        // Without this, Chromium throttles timers and audio scheduling in a
        // window that isn't visible - which is every moment of this app's life.
        backgroundThrottling: false,
        // The engine gets no user gesture (there's no UI to click), so without
        // this the AudioContext would stay suspended forever.
        autoplayPolicy: 'no-user-gesture-required'
      }
    });

    this.window.loadFile(path.join(__dirname, '..', 'audio', 'engine.html'));

    ipcMain.on('audio:ready', () => {
      this.ready = true;
      if (this.settings) this.send('audio:settings', this.settings);
      if (this.pendingPack) {
        this.send('audio:load-pack', this.pendingPack);
        this.pendingPack = null;
      }
    });

    ipcMain.on('audio:pack-loaded', (_e, info) => {
      this.loadedPackId = info.packId;
      console.log(`[audio] "${info.packId}" ready - ${info.sounds} sounds, context ${info.state}`);
    });

    ipcMain.on('audio:report', (_e, message) => console.warn('[audio]', message));

    return this.window;
  }

  send(channel, payload) {
    if (!this.window || this.window.isDestroyed()) return;
    this.window.webContents.send(channel, payload);
  }

  /**
   * Read every sound in a pack and hand it to the engine.
   * Reads are cached by path because groups that a pack didn't define share the
   * default group's files, and there's no point reading the same wav six times.
   */
  async loadPack(pack) {
    if (!pack) return;

    const cache = new Map();
    const readOnce = async (file) => {
      if (cache.has(file)) return cache.get(file);
      const buf = await fs.readFile(file);
      // Copy into a standalone ArrayBuffer. Node Buffers are views onto a shared
      // pool, so handing .buffer straight over would send a few MB of unrelated
      // memory along with each sound.
      const ab = new Uint8Array(buf).buffer;
      cache.set(file, ab);
      return ab;
    };

    const groups = {};
    for (const [group, kinds] of Object.entries(pack.groups)) {
      groups[group] = {
        down: await Promise.all(kinds.down.map(readOnce)),
        up: await Promise.all(kinds.up.map(readOnce))
      };
    }

    const payload = { packId: pack.id, groups };
    if (this.ready) this.send('audio:load-pack', payload);
    else this.pendingPack = payload;      // engine still booting; send on ready
  }

  updateSettings(config) {
    this.settings = {
      volume: config.volume,
      keyUpVolume: config.keyUpVolume,
      randomizePitch: config.randomizePitch,
      pitchVariance: config.pitchVariance,
      randomizeVolume: config.randomizeVolume,
      volumeVariance: config.volumeVariance
    };
    if (this.ready) this.send('audio:settings', this.settings);
  }

  play(group, kind) {
    if (!this.ready) return;
    this.send('audio:play', { group, kind });
  }

  resume() {
    this.send('audio:resume');
  }

  destroy() {
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
    this.ready = false;
  }
}

module.exports = { AudioHost };
