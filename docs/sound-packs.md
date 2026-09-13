# Sound packs

A pack is a folder with some audio files and a `pack.json`. That's the whole
format.

Packs live in one of two places:

| Where | What it's for |
| --- | --- |
| `packs/` in the app folder | The four packs that ship with Typeback. |
| `%APPDATA%\typeback\packs\` | Yours. Settings → **Open folder** goes straight there. |

If a pack in your folder has the same `id` as a built-in one, yours wins. That's
how you replace Thock without touching the install directory.

## The quickest way

Don't write JSON. Put your audio files in a folder, then Settings → **Import
pack** and choose it. Typeback reads the filenames, works out which key each
sound belongs to, and writes the manifest for you.

Naming that gets picked up:

```
my-pack/
  space.wav          → spacebar
  backspace.wav      → backspace and delete
  enter.wav          → enter
  shift.wav          → modifiers    (also: ctrl, alt, tab, caps)
  number-1.wav       → numbers      (also: digit, numpad)
  key-1.wav          → everything else
  key-2.wav          → everything else
  up/key-1.wav       → release sound for normal keys
```

Anything it doesn't recognise becomes a normal key, which is a fine default.
Release sounds are detected from an `up/` or `release/` folder, or from a
filename containing `release`, `keyup` or `-up`.

## Writing a manifest by hand

```json
{
  "id": "my-pack",
  "name": "My Pack",
  "description": "Recorded on a Model M.",
  "author": "You",
  "version": "1.0.0",
  "sounds": {
    "default":   { "down": ["down/key-1.wav", "down/key-2.wav"], "up": ["up/key-1.wav"] },
    "space":     { "down": ["down/space.wav"] },
    "backspace": { "down": ["down/backspace.wav"] },
    "enter":     { "down": ["down/enter.wav"] },
    "modifier":  { "down": ["down/shift.wav"] },
    "number":    { "down": ["down/number.wav"] }
  }
}
```

**`default` is the only group you have to provide.** Leave any other group out
and it inherits `default`, so a pack with a single wav in it is completely
valid.

Paths are relative to the pack folder, and must stay inside it.

### The groups

| Group | Keys |
| --- | --- |
| `default` | Letters, punctuation, F-keys, arrows — anything unlisted. |
| `space` | Spacebar. |
| `backspace` | Backspace, Delete. |
| `enter` | Enter, numpad Enter. |
| `modifier` | Shift, Ctrl, Alt, Win, Tab, Caps Lock, Esc. |
| `number` | Top row 0–9 and the numpad. |

### Fields

| Field | Required | Notes |
| --- | --- | --- |
| `id` | no | Defaults to the folder name. Lowercase, no spaces. |
| `name` | no | Shown in Settings. Defaults to the `id`. |
| `description` | no | One line, shown under the name. |
| `author`, `version` | no | Metadata only. |
| `sounds` | **yes** | Must contain a `default` group with at least one `down` file. |

## Making it sound real

Two things matter far more than sample quality:

**Give each group several alternates.** Typeback picks one at random per press
and never repeats the same one twice in a row. One sample per key is the single
biggest giveaway that a keyboard is fake. Four is plenty.

**Keep the files short and trimmed.** 40–150 ms, starting at the transient with
no leading silence — any padding at the front becomes latency you can hear.
Mono is fine and halves the size.

Pitch and volume jitter are applied by Typeback at playback, so don't bake
variation in yourself; you'd be stacking randomness on randomness.

Supported formats: `.wav`, `.mp3`, `.ogg`, `.flac`, `.m4a`, `.webm`. WAV is the
safest — no decode delay and no codec surprises.

## Generating packs instead of recording them

The four built-in packs aren't recordings; they're synthesised by
[`tools/generate_packs.py`](../tools/generate_packs.py) from noise and sine
waves. Each keypress is three layers — a transient, a pitched body, and a low
thump — and a pack is just a particular balance of those.

```bash
python tools/generate_packs.py     # or: npm run packs
```

Add an entry to `PACKS` in that file and re-run it to get a new pack. Output is
deterministic, so the same numbers always produce the same bytes.
