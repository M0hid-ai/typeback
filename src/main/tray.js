'use strict';

const path = require('path');
const { Tray, Menu, nativeImage } = require('electron');

/**
 * The tray icon - the app's real front door, since the window spends most of its
 * life hidden.
 *
 * The icon itself doubles as the mute indicator: a slashed, desaturated keycap
 * when sound is off. That's faster to read at a glance than opening a menu.
 */

const ICONS = path.join(__dirname, '..', '..', 'build');

function icon(name) {
  const image = nativeImage.createFromPath(path.join(ICONS, name));
  // An empty image means the file is missing or unreadable. Electron would show
  // an invisible tray entry, which looks exactly like the app failing to start,
  // so say something rather than leaving a mystery.
  if (image.isEmpty()) console.warn(`[tray] could not load ${name}`);
  return image;
}

function createTray({ getConfig, toggleEnabled, showSettings, quit }) {
  const active = icon('tray.ico');
  const muted = icon('tray-muted.ico');

  const tray = new Tray(active);

  function render(config) {
    const enabled = config.enabled;

    tray.setImage(enabled ? active : muted);
    tray.setToolTip(enabled ? 'Typeback - sounds on' : 'Typeback - muted');

    const menu = Menu.buildFromTemplate([
      {
        label: enabled ? 'Sounds on' : 'Sounds muted',
        type: 'checkbox',
        checked: enabled,
        click: toggleEnabled
      },
      { type: 'separator' },
      { label: 'Settings...', click: showSettings },
      { type: 'separator' },
      { label: 'Quit Typeback', click: quit }
    ]);

    tray.setContextMenu(menu);
  }

  render(getConfig());

  // Left click is the fast path for the thing people do most: shut it up.
  // Double click opens settings.
  tray.on('click', toggleEnabled);
  tray.on('double-click', showSettings);

  return {
    tray,
    update: render,
    destroy: () => tray.destroy()
  };
}

module.exports = { createTray };
