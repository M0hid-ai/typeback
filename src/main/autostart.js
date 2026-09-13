'use strict';

const { app } = require('electron');

/**
 * "Start with Windows".
 *
 * Electron writes to the Run key in the registry under the hood, so this needs
 * no installer support and no elevation - it's a per-user setting.
 */

// Passed when Windows launches us at login so main.js knows to stay in the tray
// rather than popping the settings window in your face every boot.
const HIDDEN_FLAG = '--hidden';

function isSupported() {
  // Only meaningful for a built app. In development the login item would point
  // at electron.exe with our project path as an argument, which is fragile and
  // not something anyone wants persisted into their registry.
  return process.platform === 'win32' && app.isPackaged;
}

function get() {
  if (!isSupported()) return false;
  try {
    return app.getLoginItemSettings({ args: [HIDDEN_FLAG] }).openAtLogin;
  } catch (err) {
    console.warn('[autostart] could not read login item:', err.message);
    return false;
  }
}

function set(enabled) {
  if (!isSupported()) {
    if (enabled) console.log('[autostart] ignored - only applies to a packaged build');
    return false;
  }
  try {
    app.setLoginItemSettings({
      openAtLogin: Boolean(enabled),
      openAsHidden: Boolean(enabled),
      args: [HIDDEN_FLAG]
    });
    return get();
  } catch (err) {
    console.warn('[autostart] could not write login item:', err.message);
    return false;
  }
}

/** Were we launched by Windows at login (rather than by the user)? */
function launchedAtLogin(argv = process.argv) {
  return argv.includes(HIDDEN_FLAG);
}

module.exports = { get, set, isSupported, launchedAtLogin, HIDDEN_FLAG };
