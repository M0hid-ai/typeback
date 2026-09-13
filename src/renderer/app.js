'use strict';

/**
 * Settings window logic.
 *
 * Main owns the truth: every control sends a patch and then re-renders from the
 * state that comes back. Nothing here keeps its own copy of a setting, so the
 * tray toggle and this window can never disagree.
 */

const api = window.typeback;
const $ = (id) => document.getElementById(id);

let state = null;

// Sliders fire continuously while dragging. The label updates on every frame so
// dragging feels live, but the write to main is debounced so we aren't doing a
// disk write per pixel of mouse travel.
const WRITE_DELAY_MS = 70;
let writeTimer = null;
let pendingPatch = {};

function queue(patch) {
  Object.assign(pendingPatch, patch);
  clearTimeout(writeTimer);
  writeTimer = setTimeout(flush, WRITE_DELAY_MS);
}

async function flush() {
  if (!Object.keys(pendingPatch).length) return;
  const patch = pendingPatch;
  pendingPatch = {};
  render(await api.update(patch));
}

/** Immediate write, for toggles and buttons where latency would be noticeable. */
async function commit(patch) {
  clearTimeout(writeTimer);
  Object.assign(patch, pendingPatch);
  pendingPatch = {};
  render(await api.update(patch));
}

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------

const pct = (v) => `${Math.round(v * 100)}%`;

function renderStatus() {
  const { config, runtime } = state;
  const app = runtime.currentApp;
  const mutedHere = app && config.mutedApps.includes(app);

  let text;
  if (!config.enabled) text = 'Muted everywhere';
  else if (mutedHere) text = `Staying quiet in ${app}`;
  else if (app) text = `Listening - you're in ${app}`;
  else text = 'Listening for keystrokes';

  $('statusLine').textContent = text;
  $('enabledLabel').textContent = config.enabled ? 'On' : 'Off';
}

function renderPacks() {
  const list = $('packs');
  list.replaceChildren();

  if (!state.packs.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'No sound packs found. Import one, or run "npm run packs" to rebuild the defaults.';
    list.append(p);
    return;
  }

  for (const pack of state.packs) {
    const button = document.createElement('button');
    button.className = 'pack';
    button.setAttribute('aria-pressed', String(pack.id === state.config.packId));

    const name = document.createElement('div');
    name.className = 'name';
    name.append(pack.name);
    if (!pack.builtin) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = 'Yours';
      name.append(tag);
    }

    const desc = document.createElement('div');
    desc.className = 'desc';
    desc.textContent = pack.description || `by ${pack.author}`;

    button.append(name, desc);
    // Switching packs previews itself: main loads it and we play a key.
    button.addEventListener('click', async () => {
      await commit({ packId: pack.id });
      setTimeout(() => api.preview('default'), 120);
    });

    list.append(button);
  }
}

function renderGroups() {
  const wrap = $('groups');
  wrap.replaceChildren();

  for (const group of state.groups) {
    const button = document.createElement('button');
    button.className = 'group';
    button.textContent = group.label;
    button.title = group.hint;
    button.addEventListener('click', () => api.preview(group.id));
    wrap.append(button);
  }
}

function renderMutedApps() {
  const list = $('mutedApps');
  list.replaceChildren();

  if (!state.config.mutedApps.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Nothing muted - Typeback sounds everywhere.';
    list.append(li);
    return;
  }

  for (const exe of state.config.mutedApps) {
    const li = document.createElement('li');
    // Highlight the entry for the app you're actually in, so it's obvious why
    // the app just went quiet.
    if (exe === state.runtime.currentApp) li.className = 'active';

    const label = document.createElement('span');
    label.textContent = exe;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.title = `Stop muting ${exe}`;
    remove.addEventListener('click', () =>
      commit({ mutedApps: state.config.mutedApps.filter((a) => a !== exe) })
    );

    li.append(label, remove);
    list.append(li);
  }
}

/** Grey out rows whose parent toggle is off. */
function renderDependencies() {
  for (const row of document.querySelectorAll('.row[data-requires]')) {
    const parent = $(row.dataset.requires);
    row.classList.toggle('disabled', !parent.checked);
  }
}

function renderHotkey() {
  const el = $('hotkey');
  const { hotkey } = state.runtime;

  el.textContent = (hotkey.accelerator || state.config.muteHotkey)
    .replace(/Control/g, 'Ctrl')
    .replace(/\+/g, ' + ');

  el.classList.toggle('bad', !hotkey.ok);
  $('hotkeyNote').textContent = hotkey.ok
    ? 'Works anywhere, even in games.'
    : `Unavailable - ${hotkey.reason}.`;
}

function render(next) {
  state = next;
  const c = state.config;

  $('enabled').checked = c.enabled;

  const slider = (id, value, format) => {
    $(id).value = Math.round(value * 100);
    $(`${id}Out`).textContent = format(value);
  };
  slider('volume', c.volume, pct);
  slider('keyUpVolume', c.keyUpVolume, pct);
  slider('pitchVariance', c.pitchVariance, pct);
  slider('volumeVariance', c.volumeVariance, pct);

  $('keyUpEnabled').checked = c.keyUpEnabled;
  $('randomizePitch').checked = c.randomizePitch;
  $('randomizeVolume').checked = c.randomizeVolume;
  $('suppressRepeats').checked = c.suppressRepeats;
  $('launchAtStartup').checked = c.launchAtStartup;
  $('startMinimized').checked = c.startMinimized;

  // Autostart only works in a packaged build; say so rather than offering a
  // switch that silently does nothing.
  const autostartOk = state.runtime.autostartSupported;
  $('launchAtStartup').disabled = !autostartOk;
  $('autostartRow').classList.toggle('disabled', !autostartOk);
  if (!autostartOk) {
    $('autostartNote').textContent = 'Only available in the installed build.';
  }

  if (!state.runtime.foregroundAvailable) {
    $('muteHint').textContent =
      'Per-app muting is unavailable - Typeback could not read the focused window.';
    $('muteCurrent').disabled = true;
  }

  $('version').textContent = `Typeback ${state.runtime.version}`;

  renderStatus();
  renderPacks();
  renderGroups();
  renderMutedApps();
  renderDependencies();
  renderHotkey();
}

// ---------------------------------------------------------------------------
// wiring
// ---------------------------------------------------------------------------

function bindSlider(id, key, { preview = false } = {}) {
  const input = $(id);
  const out = $(`${id}Out`);

  input.addEventListener('input', () => {
    const value = Number(input.value) / 100;
    out.textContent = pct(value);          // instant feedback
    queue({ [key]: value });
  });

  // Preview on release rather than during the drag, so adjusting volume doesn't
  // machine-gun a sound on every pixel of movement.
  if (preview) input.addEventListener('change', () => api.preview('default'));
}

function bindToggle(id, key, { preview = false } = {}) {
  $(id).addEventListener('change', async (event) => {
    await commit({ [key]: event.target.checked });
    if (preview && event.target.checked) api.preview('default');
  });
}

bindSlider('volume', 'volume', { preview: true });
bindSlider('keyUpVolume', 'keyUpVolume', { preview: true });
bindSlider('pitchVariance', 'pitchVariance');
bindSlider('volumeVariance', 'volumeVariance');

bindToggle('enabled', 'enabled', { preview: true });
bindToggle('keyUpEnabled', 'keyUpEnabled');
bindToggle('randomizePitch', 'randomizePitch');
bindToggle('randomizeVolume', 'randomizeVolume');
bindToggle('suppressRepeats', 'suppressRepeats');
bindToggle('launchAtStartup', 'launchAtStartup');
bindToggle('startMinimized', 'startMinimized');

$('refreshPacks').addEventListener('click', async () => render(await api.refreshPacks()));
$('importPack').addEventListener('click', async () => render(await api.importPack()));
$('openPacks').addEventListener('click', () => api.openPacksFolder());
$('muteCurrent').addEventListener('click', async () => render(await api.muteCurrentApp()));

$('addAppForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = $('addAppInput');
  let value = input.value.trim().toLowerCase();
  if (!value) return;

  // Be forgiving about what people type: "Discord" and "discord.exe" both work.
  if (!value.endsWith('.exe')) value += '.exe';
  if (state.config.mutedApps.includes(value)) {
    input.value = '';
    return;
  }

  input.value = '';
  await commit({ mutedApps: [...state.config.mutedApps, value] });
});

$('reset').addEventListener('click', async () => render(await api.reset()));
$('quit').addEventListener('click', () => api.quit());

api.onState(render);
api.getState().then(render);
