'use strict';

const { globalShortcut } = require('electron');

/**
 * The panic button: one chord that mutes Typeback everywhere, for when a call
 * starts or you hit record.
 *
 * Registration can fail for a perfectly ordinary reason - another app already
 * owns the combination - so this reports success back to the caller instead of
 * throwing, and the settings UI shows the failure rather than silently
 * pretending the shortcut works.
 */
class HotkeyManager {
  constructor() {
    this.accelerator = null;
    this.handler = null;
  }

  /**
   * @returns {{ok: boolean, accelerator: string|null, reason?: string}}
   */
  register(accelerator, handler) {
    this.unregister();

    if (!accelerator) {
      this.handler = handler;
      return { ok: true, accelerator: null };
    }

    try {
      const ok = globalShortcut.register(accelerator, () => {
        if (this.handler) this.handler();
      });
      if (!ok) {
        // Electron returns false rather than throwing when the combination is
        // already claimed system-wide.
        return { ok: false, accelerator, reason: 'already taken by another app' };
      }
      this.accelerator = accelerator;
      this.handler = handler;
      return { ok: true, accelerator };
    } catch (err) {
      // Thrown when the accelerator string itself is malformed.
      return { ok: false, accelerator, reason: err.message };
    }
  }

  unregister() {
    if (!this.accelerator) return;
    try {
      globalShortcut.unregister(this.accelerator);
    } catch {
      /* already gone */
    }
    this.accelerator = null;
  }

  unregisterAll() {
    this.accelerator = null;
    this.handler = null;
    globalShortcut.unregisterAll();
  }
}

module.exports = { HotkeyManager };
