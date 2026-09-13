'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Bridge for the settings window. Every call is an explicit, named operation -
 * the renderer never gets a generic "invoke anything" escape hatch.
 */
contextBridge.exposeInMainWorld('typeback', {
  getState: () => ipcRenderer.invoke('state:get'),
  update: (patch) => ipcRenderer.invoke('config:update', patch),
  reset: () => ipcRenderer.invoke('config:reset'),

  refreshPacks: () => ipcRenderer.invoke('packs:refresh'),
  importPack: () => ipcRenderer.invoke('packs:import'),
  openPacksFolder: () => ipcRenderer.invoke('packs:open-folder'),

  preview: (group) => ipcRenderer.invoke('preview', group),
  muteCurrentApp: () => ipcRenderer.invoke('mute:add-current'),
  quit: () => ipcRenderer.invoke('app:quit'),

  // Main pushes a fresh state whenever anything changes, including changes the
  // user made from the tray, so the window can never drift out of sync.
  onState: (cb) => ipcRenderer.on('state', (_e, state) => cb(state))
});
