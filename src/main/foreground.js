'use strict';

const path = require('path');

/**
 * Which app is the user actually typing into?
 *
 * This exists for the mute list. Opera GX (and a few editors) already make their
 * own key sounds, so Typeback needs to recognise them and shut up.
 *
 * It's a direct FFI call into user32/kernel32 rather than an npm wrapper,
 * because this runs on the keystroke path and spawning anything per key would
 * be far too slow.
 */

// PROCESS_QUERY_LIMITED_INFORMATION. Deliberately the weakest right that still
// answers "what is this exe" - it succeeds against processes that the broader
// PROCESS_QUERY_INFORMATION would be denied on.
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

// Windows paths cap out at 32767 wide chars, but a real exe path is never close.
const PATH_BUF = 1024;

let api = null;
let available = false;
let initError = null;

function init() {
  if (api || initError) return available;
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const kernel32 = koffi.load('kernel32.dll');

    api = {
      GetForegroundWindow: user32.func('void* __stdcall GetForegroundWindow()'),
      GetWindowThreadProcessId: user32.func(
        'uint32 __stdcall GetWindowThreadProcessId(void* hWnd, _Out_ uint32* pid)'
      ),
      OpenProcess: kernel32.func('void* __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)'),
      QueryFullProcessImageNameW: kernel32.func(
        'bool __stdcall QueryFullProcessImageNameW(void* h, uint32 flags, _Out_ uint16* buf, _Inout_ uint32* size)'
      ),
      CloseHandle: kernel32.func('bool __stdcall CloseHandle(void* h)')
    };
    available = true;
  } catch (err) {
    // If the FFI can't load we lose per-app muting, but everything else still
    // works. Degrade quietly rather than taking the app down with us.
    initError = err;
    available = false;
    console.warn('[foreground] disabled, per-app muting unavailable:', err.message);
  }
  return available;
}

// Looking up the exe means OpenProcess + a string read, which is far too much to
// repeat on every keystroke. The window handle barely changes while you type, so
// it makes a good cache key; the TTL just catches handle reuse after a process
// dies and Windows hands the same HWND value to something else.
const CACHE_TTL_MS = 2000;
let cachedHandle = null;
let cachedExe = null;
let cachedAt = 0;

function exeForWindow(hwnd) {
  const pidOut = [0];
  api.GetWindowThreadProcessId(hwnd, pidOut);
  const pid = pidOut[0];
  if (!pid) return null;

  const handle = api.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
  if (!handle) return null;      // protected/elevated process - nothing we can do

  try {
    const buf = new Uint16Array(PATH_BUF);
    const size = [buf.length];
    if (!api.QueryFullProcessImageNameW(handle, 0, buf, size)) return null;

    const full = Buffer.from(buf.buffer, 0, size[0] * 2).toString('utf16le');
    return path.basename(full).toLowerCase();
  } finally {
    api.CloseHandle(handle);
  }
}

/**
 * Lowercased exe name of the focused window, e.g. "chrome.exe".
 * Returns null when it can't be determined - callers must treat that as
 * "not muted" so a lookup failure never silences the app.
 */
function getForegroundExe() {
  if (!init()) return null;

  try {
    const hwnd = api.GetForegroundWindow();
    if (!hwnd) return null;      // nothing focused, e.g. during a desktop switch

    const key = String(hwnd);
    const now = Date.now();
    if (key === cachedHandle && now - cachedAt < CACHE_TTL_MS) return cachedExe;

    const exe = exeForWindow(hwnd);
    cachedHandle = key;
    cachedExe = exe;
    cachedAt = now;
    return exe;
  } catch (err) {
    console.warn('[foreground] lookup failed:', err.message);
    return null;
  }
}

/** Drop the cache - used right after the user edits the mute list. */
function invalidate() {
  cachedHandle = null;
  cachedExe = null;
  cachedAt = 0;
}

function isAvailable() {
  init();
  return available;
}

module.exports = { getForegroundExe, isAvailable, invalidate };
