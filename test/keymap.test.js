'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { UiohookKey: K } = require('uiohook-napi');

const { groupForKeycode, unresolvedKeyNames } = require('../src/main/keymap');

test('every key name we map exists in this uiohook build', () => {
  assert.deepEqual(unresolvedKeyNames(), []);
});

test('keys land in the right group', () => {
  const cases = {
    Backspace: 'backspace',
    Delete: 'backspace',
    Space: 'space',
    Enter: 'enter',
    NumpadEnter: 'enter',
    Shift: 'modifier',
    CapsLock: 'modifier',
    Escape: 'modifier',
    5: 'number',
    Numpad7: 'number',
    A: 'default',
    F1: 'default',
    ArrowLeft: 'default'
  };
  for (const [name, group] of Object.entries(cases)) {
    assert.equal(groupForKeycode(K[name]), group, name);
  }
});

test('keycodes we have never heard of are normal keys', () => {
  assert.equal(groupForKeycode(999999), 'default');
});
