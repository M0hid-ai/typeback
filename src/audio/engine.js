'use strict';

/**
 * The audio engine.
 *
 * Runs in a hidden renderer window, because Web Audio only exists in a renderer
 * and it is by far the lowest-latency way to fire short samples on Windows
 * without writing a native audio backend.
 *
 * The contract with the main process is deliberately tiny: main decides *which*
 * group was pressed, the engine decides *how* it sounds. Per-keystroke IPC is
 * therefore two short strings, not a settings blob.
 */

const bridge = window.typebackAudio;

// Hard ceiling on simultaneous voices. Holding a key or a very fast typist can
// otherwise stack hundreds of overlapping sources and pin a CPU core for no
// audible benefit - past a certain density it's just noise.
const MAX_VOICES = 24;

let ctx = null;
let master = null;
let limiter = null;

/** group id -> { down: AudioBuffer[], up: AudioBuffer[] } */
let buffers = Object.create(null);

/** Last variant index played per "group:kind", to avoid immediate repeats. */
const lastIndex = new Map();

let voices = 0;

let settings = {
  volume: 0.7,
  keyUpVolume: 0.45,
  randomizePitch: true,
  pitchVariance: 0.08,
  randomizeVolume: true,
  volumeVariance: 0.12
};

function ensureContext() {
  if (ctx) return ctx;

  // 'interactive' asks Chromium for the smallest buffer it can manage, which is
  // what we want - this is a UI sound effect, not music playback.
  ctx = new AudioContext({ latencyHint: 'interactive' });

  // A limiter rather than a compressor-for-tone: with fast typing, key-down and
  // key-up sounds overlap constantly and the sum can clip. These settings are
  // near-transparent for single presses and only engage on pile-ups.
  limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.12;

  master = ctx.createGain();
  master.gain.value = settings.volume;

  master.connect(limiter);
  limiter.connect(ctx.destination);

  return ctx;
}

/**
 * Chromium suspends an AudioContext created without a user gesture. The window
 * is hidden and will never get one, so we resume explicitly. The main process
 * also sets autoplayPolicy: 'no-user-gesture-required', which is what actually
 * lets this succeed.
 */
async function resumeContext() {
  ensureContext();
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch (err) {
      report(`could not resume audio context: ${err.message}`);
    }
  }
  return ctx.state;
}

function report(message) {
  try {
    bridge.report(message);
  } catch {
    console.warn('[engine]', message);
  }
}

// ---------------------------------------------------------------------------
// pack loading
// ---------------------------------------------------------------------------

async function decodeAll(list) {
  const out = [];
  for (const arrayBuffer of list) {
    try {
      // decodeAudioData detaches the buffer it's given; each one is a fresh
      // copy from IPC, so that's fine.
      out.push(await ctx.decodeAudioData(arrayBuffer));
    } catch (err) {
      report(`skipped an unreadable sound: ${err.message}`);
    }
  }
  return out;
}

// Bumped per load. Decoding is async, so two quick pack switches can finish out
// of order - without this the slower, older pack would win.
let loadGeneration = 0;

async function loadPack(payload) {
  ensureContext();
  const generation = ++loadGeneration;
  const next = Object.create(null);

  for (const [group, kinds] of Object.entries(payload.groups || {})) {
    next[group] = {
      down: await decodeAll(kinds.down || []),
      up: await decodeAll(kinds.up || [])
    };
  }

  if (generation !== loadGeneration) return;

  buffers = next;
  lastIndex.clear();
  await resumeContext();

  const total = Object.values(next).reduce((n, g) => n + g.down.length + g.up.length, 0);
  bridge.packLoaded({ packId: payload.packId, sounds: total, state: ctx.state });
}

// ---------------------------------------------------------------------------
// playback
// ---------------------------------------------------------------------------

/**
 * Pick a variant, avoiding the one we just played. Real keyboards never make
 * exactly the same sound twice in a row, and a repeated identical sample is the
 * single most obvious tell that something is synthetic.
 */
function pickVariant(list, key) {
  if (list.length === 1) return list[0];

  const previous = lastIndex.get(key);
  let index = Math.floor(Math.random() * list.length);
  if (index === previous) index = (index + 1) % list.length;

  lastIndex.set(key, index);
  return list[index];
}

/** Uniform random in [1 - spread, 1 + spread]. */
function jitter(spread) {
  return 1 + (Math.random() * 2 - 1) * spread;
}

function play(group, kind) {
  if (!ctx || voices >= MAX_VOICES) return;

  const slot = buffers[group] || buffers.default;
  if (!slot) return;

  const list = kind === 'up' ? slot.up : slot.down;
  if (!list || !list.length) return;

  const buffer = pickVariant(list, `${group}:${kind}`);
  if (!buffer) return;

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  // Pitch: playbackRate shifts speed and pitch together, which is exactly what
  // varying strike force does to a real switch - a harder hit rings slightly
  // higher and dies slightly faster.
  if (settings.randomizePitch && settings.pitchVariance > 0) {
    source.playbackRate.value = jitter(settings.pitchVariance);
  }

  const gain = ctx.createGain();
  let level = kind === 'up' ? settings.keyUpVolume : 1;
  if (settings.randomizeVolume && settings.volumeVariance > 0) {
    level *= jitter(settings.volumeVariance);
  }
  gain.gain.value = Math.max(0, Math.min(1.5, level));

  source.connect(gain);
  gain.connect(master);

  voices += 1;
  source.onended = () => {
    voices -= 1;
    source.disconnect();
    gain.disconnect();
  };

  // start(0) means "right now" - scheduling ahead would only add latency.
  source.start(0);
}

function applySettings(next) {
  settings = { ...settings, ...next };
  if (master) {
    // A short ramp instead of a jump: setting .value directly while sounds are
    // ringing produces a click.
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setTargetAtTime(settings.volume, now, 0.015);
  }
}

// ---------------------------------------------------------------------------
// wiring
// ---------------------------------------------------------------------------

bridge.onLoadPack((payload) => {
  loadPack(payload).catch((err) => report(`pack load failed: ${err.message}`));
});

bridge.onPlay(({ group, kind }) => {
  try {
    play(group, kind);
  } catch (err) {
    report(`playback error: ${err.message}`);
  }
});

bridge.onSettings((next) => applySettings(next));

bridge.onResume(() => {
  resumeContext();
});

ensureContext();
bridge.ready();
