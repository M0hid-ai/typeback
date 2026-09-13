'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * The only surface the audio window gets. Context isolation is on, so the engine
 * has no Node access at all - it can receive sound data and playback commands,
 * and nothing else.
 */
contextBridge.exposeInMainWorld('typebackAudio', {
  onLoadPack: (cb) => ipcRenderer.on('audio:load-pack', (_e, payload) => cb(payload)),
  onPlay: (cb) => ipcRenderer.on('audio:play', (_e, payload) => cb(payload)),
  onSettings: (cb) => ipcRenderer.on('audio:settings', (_e, payload) => cb(payload)),
  onResume: (cb) => ipcRenderer.on('audio:resume', () => cb()),

  ready: () => ipcRenderer.send('audio:ready'),
  packLoaded: (info) => ipcRenderer.send('audio:pack-loaded', info),
  report: (message) => ipcRenderer.send('audio:report', message)
});
