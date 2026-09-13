'use strict';

const { EventEmitter } = require('events');
const { uIOhook } = require('uiohook-napi');

const { groupForKeycode, unresolvedKeyNames } = require('./keymap');

/**
 * The global keyboard hook.
 *
 * uiohook installs a low-level Windows hook (WH_KEYBOARD_LL), which is what
 * makes this work in Chrome, VS Code, Terminal and everything else without any
 * per-app integration. It observes only - it never swallows or rewrites a key,
 * so it can't interfere with what you're typing.
 *
 * Note: Windows will not deliver keystrokes from an elevated process to a
 * non-elevated hook. Typing in an admin terminal is therefore silent unless
 * Typeback itself runs elevated. That's an OS security boundary, not a bug.
 */

// If a key is "held" but we haven't seen an event for it in this long, assume we
// missed its keyup (alt-tabbing mid-keypress does this) and treat the next press
// as fresh. Without it, a dropped keyup silences that key for the whole session.
const HELD_KEY_TIMEOUT_MS = 1000;

class KeyHook extends EventEmitter {
  /**
   * @param {object} opts
   * @param {() => boolean} opts.gate  Consulted per event; false means stay silent.
   */
  constructor({ gate } = {}) {
    super();
    this.gate = typeof gate === 'function' ? gate : () => true;
    this.running = false;
    this.keyUpEnabled = true;
    this.suppressRepeats = true;

    /** keycode -> timestamp of the last event seen for it. */
    this.held = new Map();

    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
  }

  start() {
    if (this.running) return true;

    const missing = unresolvedKeyNames();
    if (missing.length) {
      console.warn(`[keys] unmapped key names: ${missing.join(', ')}`);
    }

    try {
      uIOhook.on('keydown', this.onKeyDown);
      uIOhook.on('keyup', this.onKeyUp);
      uIOhook.start();
      this.running = true;
      console.log('[keys] hook installed');
    } catch (err) {
      console.error('[keys] could not install hook:', err.message);
      this.emit('error', err);
      return false;
    }
    return true;
  }

  stop() {
    if (!this.running) return;
    try {
      uIOhook.off('keydown', this.onKeyDown);
      uIOhook.off('keyup', this.onKeyUp);
      uIOhook.stop();
    } catch (err) {
      console.warn('[keys] unclean shutdown:', err.message);
    }
    this.running = false;
    this.held.clear();
  }

  setKeyUpEnabled(value) {
    this.keyUpEnabled = Boolean(value);
  }

  setSuppressRepeats(value) {
    this.suppressRepeats = Boolean(value);
    if (!this.suppressRepeats) this.held.clear();
  }

  onKeyDown(event) {
    const now = Date.now();
    const code = event.keycode;

    if (this.suppressRepeats) {
      const lastSeen = this.held.get(code);
      // A genuine auto-repeat arrives every ~30ms. A gap longer than the timeout
      // means we lost the keyup, so this is a real new press rather than a repeat.
      const isRepeat = lastSeen !== undefined && now - lastSeen < HELD_KEY_TIMEOUT_MS;
      this.held.set(code, now);
      if (isRepeat) return;
    }

    if (!this.gate()) return;
    this.emit('press', { group: groupForKeycode(code), kind: 'down', keycode: code });
  }

  onKeyUp(event) {
    const code = event.keycode;
    this.held.delete(code);

    if (!this.keyUpEnabled) return;
    if (!this.gate()) return;
    this.emit('press', { group: groupForKeycode(code), kind: 'up', keycode: code });
  }
}

module.exports = { KeyHook };
