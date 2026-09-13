'use strict';

const { UiohookKey } = require('uiohook-napi');

/**
 * Typeback groups every physical key into one of a handful of buckets, and each
 * bucket gets its own sound. Six is the sweet spot: enough that a keyboard feels
 * varied, few enough that a pack author doesn't have to record 104 samples.
 *
 * `default` is the catch-all and is the only group a pack MUST provide. Anything
 * a pack leaves out falls back to it (see packs.js).
 */
const KEY_GROUPS = [
  { id: 'default',   label: 'Letters & symbols', hint: 'The everyday keys — a-z, punctuation, F-keys, arrows.' },
  { id: 'space',     label: 'Spacebar',          hint: 'Usually the deepest, loudest key on the board.' },
  { id: 'backspace', label: 'Backspace & Delete', hint: 'Often given a sharper, more "corrective" click.' },
  { id: 'enter',     label: 'Enter',             hint: 'The satisfying one. Stabilised, so it rattles a little.' },
  { id: 'modifier',  label: 'Modifiers',         hint: 'Shift, Ctrl, Alt, Win, Tab, Caps, Esc.' },
  { id: 'number',    label: 'Numbers',           hint: 'The top row and the numpad.' }
];

const GROUP_IDS = KEY_GROUPS.map((g) => g.id);
const DEFAULT_GROUP = 'default';

// Membership is declared by UiohookKey *name*, not by raw scancode. The names are
// the module's stable public surface; the numbers behind them are not. Any name
// this version of uiohook-napi doesn't export is skipped rather than throwing,
// so a dependency bump degrades into "that key is a normal key" instead of a crash.
const GROUP_KEY_NAMES = {
  backspace: ['Backspace', 'Delete'],
  space: ['Space'],
  enter: ['Enter', 'NumpadEnter'],
  modifier: [
    'Shift', 'ShiftRight',
    'Ctrl', 'CtrlRight',
    'Alt', 'AltRight',
    'Meta', 'MetaRight',
    'Tab', 'CapsLock', 'Escape'
  ],
  number: [
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
    'Numpad0', 'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4',
    'Numpad5', 'Numpad6', 'Numpad7', 'Numpad8', 'Numpad9'
  ]
};

/** keycode (number) -> group id. Built once at require time. */
const CODE_TO_GROUP = new Map();

const missingNames = [];
for (const [group, names] of Object.entries(GROUP_KEY_NAMES)) {
  for (const name of names) {
    const code = UiohookKey[name];
    if (typeof code !== 'number') {
      missingNames.push(name);
      continue;
    }
    CODE_TO_GROUP.set(code, group);
  }
}

/**
 * Which bucket does this keycode belong to? Unknown codes are `default`, which is
 * the right answer for the long tail of media keys and vendor-specific extras.
 */
function groupForKeycode(keycode) {
  return CODE_TO_GROUP.get(keycode) || DEFAULT_GROUP;
}

/** Names we expected but this uiohook build doesn't ship. Logged once at startup. */
function unresolvedKeyNames() {
  return missingNames.slice();
}

module.exports = {
  KEY_GROUPS,
  GROUP_IDS,
  DEFAULT_GROUP,
  groupForKeycode,
  unresolvedKeyNames
};
