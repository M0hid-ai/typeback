'use strict';

const path = require('path');
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');

const { Config } = require('./config');
const { PackLibrary } = require('./packs');
const { AudioHost } = require('./audio-host');
const { KeyHook } = require('./keyhook');
const { HotkeyManager } = require('./hotkey');
const { KEY_GROUPS } = require('./keymap');
const { importPack, openPacksFolder } = require('./importer');
const foreground = require('./foreground');
const autostart = require('./autostart');

const BUILTIN_PACKS = path.join(__dirname, '..', '..', 'packs');

let config = null;
let packs = null;
let audio = null;
let keys = null;
let hotkeys = null;
let tray = null;
let settingsWindow = null;

let userPacksDir = null;
let mutedSet = new Set();
let hotkeyStatus = { ok: true, accelerator: null };
let isQuitting = false;

// Only one Typeback may run: two low-level hooks would mean every key sounds
// twice, which reads as a broken app rather than two copies of a working one.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showSettings());
  app.whenReady().then(init);
}

// ---------------------------------------------------------------------------
// the gate
// ---------------------------------------------------------------------------

/**
 * Called for every key event, so it stays cheap: a boolean check and a Set
 * lookup against a value the focus watcher already resolved in the background.
 */
function shouldPlay() {
  if (!config.get('enabled')) return false;
  if (!mutedSet.size) return true;

  const exe = foreground.currentExe();
  // A null exe means the lookup failed (a protected process, say). Treat that as
  // "not muted" - failing open keeps the app working, failing closed would make
  // it mysteriously go silent.
  if (!exe) return true;

  return !mutedSet.has(exe);
}

function rebuildMuteSet() {
  mutedSet = new Set(config.get('mutedApps'));
}

// ---------------------------------------------------------------------------
// startup
// ---------------------------------------------------------------------------

async function init() {
  app.setAppUserModelId('com.mohidfida.typeback');

  config = new Config(app.getPath('userData'));
  config.load();
  rebuildMuteSet();

  userPacksDir = path.join(app.getPath('userData'), 'packs');
  packs = new PackLibrary({ builtinDir: BUILTIN_PACKS, userDir: userPacksDir });
  packs.refresh();

  audio = new AudioHost();
  audio.start();
  audio.updateSettings(config.all());
  await loadActivePack();

  keys = new KeyHook({ gate: shouldPlay });
  keys.setKeyUpEnabled(config.get('keyUpEnabled'));
  keys.setSuppressRepeats(config.get('suppressRepeats'));
  keys.on('press', ({ group, kind }) => audio.play(group, kind));
  keys.start();

  foreground.startWatching(() => {
    // Only used to keep the settings window's "currently focused app" line live.
    if (settingsWindow && settingsWindow.isVisible()) pushState();
  });

  hotkeys = new HotkeyManager();
  applyHotkey();

  config.on('change', onConfigChange);

  const { createTray } = require('./tray');
  tray = createTray({
    getConfig: () => config.all(),
    toggleEnabled,
    showSettings,
    quit: () => { isQuitting = true; app.quit(); }
  });

  // Launched by Windows at login, or configured to start in the tray: stay out
  // of the way. Otherwise the user opened it deliberately, so show the window.
  if (!autostart.launchedAtLogin() && !config.get('startMinimized')) {
    showSettings();
  }

  console.log('[typeback] ready');
}

async function loadActivePack() {
  const pack = packs.resolve(config.get('packId'));
  if (!pack) {
    console.warn('[typeback] no usable sound packs found');
    return;
  }
  if (pack.id !== config.get('packId')) {
    // The saved pack is gone (user deleted it). Fall back and remember it, so
    // the settings UI doesn't keep highlighting a pack that isn't there.
    config.update({ packId: pack.id });
  }
  await audio.loadPack(pack);
}

function applyHotkey() {
  hotkeyStatus = hotkeys.register(config.get('muteHotkey'), toggleEnabled);
  if (!hotkeyStatus.ok) {
    console.warn(`[hotkey] ${hotkeyStatus.accelerator} unavailable: ${hotkeyStatus.reason}`);
  }
}

function toggleEnabled() {
  config.update({ enabled: !config.get('enabled') });
}

// ---------------------------------------------------------------------------
// reacting to settings changes
// ---------------------------------------------------------------------------

function onConfigChange(values, changed) {
  const touched = (...names) => names.some((n) => changed.includes(n));

  if (touched('volume', 'keyUpVolume', 'randomizePitch', 'pitchVariance',
              'randomizeVolume', 'volumeVariance')) {
    audio.updateSettings(values);
  }

  if (touched('packId')) loadActivePack();
  if (touched('keyUpEnabled')) keys.setKeyUpEnabled(values.keyUpEnabled);
  if (touched('suppressRepeats')) keys.setSuppressRepeats(values.suppressRepeats);

  if (touched('mutedApps')) {
    rebuildMuteSet();
    foreground.refresh();
  }

  if (touched('muteHotkey')) applyHotkey();
  if (touched('launchAtStartup')) autostart.set(values.launchAtStartup);

  if (touched('enabled')) {
    // Windows can suspend an idle audio device; nudge it awake when the user
    // turns sound back on so the first keystroke isn't swallowed.
    if (values.enabled) audio.resume();
  }

  if (tray) tray.update(values);
  pushState();
}

// ---------------------------------------------------------------------------
// settings window
// ---------------------------------------------------------------------------

function showSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return settingsWindow;
  }

  settingsWindow = new BrowserWindow({
    width: 940,
    height: 720,
    minWidth: 720,
    minHeight: 560,
    show: false,
    title: 'Typeback',
    backgroundColor: '#14151a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'settings-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  settingsWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  settingsWindow.once('ready-to-show', () => settingsWindow.show());

  // Closing the window parks the app in the tray instead of quitting - that's
  // the whole point of a background utility.
  settingsWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    settingsWindow.hide();
  });

  // Keep external links out of the app window.
  settingsWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return settingsWindow;
}

function buildState() {
  return {
    config: config.all(),
    packs: packs.summaries(),
    groups: KEY_GROUPS,
    runtime: {
      currentApp: foreground.lastExternalExe(),
      foregroundAvailable: foreground.isAvailable(),
      hotkey: hotkeyStatus,
      autostartSupported: autostart.isSupported(),
      version: app.getVersion()
    }
  };
}

function pushState() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('state', buildState());
  }
}

// ---------------------------------------------------------------------------
// ipc
// ---------------------------------------------------------------------------

ipcMain.handle('state:get', () => buildState());

ipcMain.handle('config:update', (_e, patch) => {
  config.update(patch || {});
  return buildState();
});

ipcMain.handle('config:reset', () => {
  config.reset();
  return buildState();
});

ipcMain.handle('packs:refresh', async () => {
  packs.refresh();
  await loadActivePack();
  return buildState();
});

ipcMain.handle('packs:import', async () => {
  const outcome = await importPack({ userDir: userPacksDir, parent: settingsWindow });
  if (outcome.imported) {
    packs.refresh();
    // Switch to what was just imported - that's plainly what the user wanted,
    // and it saves them hunting for it in the grid.
    config.update({ packId: outcome.id });
    await loadActivePack();
  } else if (outcome.error) {
    dialog.showMessageBox(settingsWindow, {
      type: 'warning',
      title: 'Could not import that pack',
      message: outcome.error
    });
  }
  return buildState();
});

ipcMain.handle('packs:open-folder', () => openPacksFolder(userPacksDir));

// Preview plays through the live engine, so what you hear is exactly what you
// get while typing - same pack, same randomisation, same volume.
ipcMain.handle('preview', (_e, group) => {
  audio.resume();
  audio.play(group || 'default', 'down');
  return true;
});

ipcMain.handle('mute:add-current', () => {
  const exe = foreground.lastExternalExe();
  if (exe) {
    config.update({ mutedApps: [...config.get('mutedApps'), exe] });
  }
  return buildState();
});

ipcMain.handle('app:quit', () => {
  isQuitting = true;
  app.quit();
});

// ---------------------------------------------------------------------------
// shutdown
// ---------------------------------------------------------------------------

// A tray app must outlive its windows.
app.on('window-all-closed', () => { /* intentionally empty */ });

app.on('before-quit', () => {
  isQuitting = true;
  if (keys) keys.stop();
  if (hotkeys) hotkeys.unregisterAll();
  foreground.stopWatching();
  if (audio) audio.destroy();
});
