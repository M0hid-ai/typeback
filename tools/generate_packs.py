#!/usr/bin/env python3
"""
Generate Typeback's default sound packs from scratch.

Every WAV this writes is synthesised from noise and sine waves - nothing is
sampled from a real keyboard, so the packs are original work and carry no
licensing baggage. The seeds are fixed, so re-running this reproduces the exact
same bytes; tweak a number below, re-run, and you have a new pack.

    python tools/generate_packs.py

A keypress here is three layers stacked, which is roughly what a real switch
does to the air:

  1. transient - the sharp tick of plastic hitting plastic (filtered noise,
     very fast decay)
  2. body      - the pitched ring of the keycap and stem (damped sine partials)
  3. thump     - the low knock transmitted into the case (a decaying low sine)

Packs differ by how those three are balanced. A "click" is mostly transient; a
"thock" is mostly thump.
"""

import hashlib
import json
import math
import shutil
import wave
from pathlib import Path

import numpy as np

SR = 44100
VARIANTS = 4          # alternates per group, cycled at random so repeats are rare
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "packs"

GROUPS = ["default", "space", "backspace", "enter", "modifier", "number"]


# --------------------------------------------------------------------------
# filters - frequency-domain so everything stays vectorised (no scipy needed)
# --------------------------------------------------------------------------

def bandpass(x, center, q=1.0, slope=2.0):
    """Resonant bell around the centre frequency. Higher q = narrower, pingier."""
    n = len(x)
    spec = np.fft.rfft(x)
    freqs = np.fft.rfftfreq(n, 1.0 / SR)
    ratio = np.where(freqs > 0, freqs / max(center, 1e-6), 1e-6)
    # (ratio - 1/ratio) is zero at the centre frequency and grows either side of
    # it, which gives a response that stays symmetric on a log frequency axis.
    gain = 1.0 / np.power(1.0 + (q * (ratio - 1.0 / ratio)) ** 2, slope / 2.0)
    return np.fft.irfft(spec * gain, n)


def lowpass(x, cutoff, order=2):
    """Butterworth-shaped rolloff. Used to take the fizz off the noise layer."""
    n = len(x)
    spec = np.fft.rfft(x)
    freqs = np.fft.rfftfreq(n, 1.0 / SR)
    gain = 1.0 / np.sqrt(1.0 + (freqs / max(cutoff, 1e-6)) ** (2 * order))
    return np.fft.irfft(spec * gain, n)


def highpass(x, cutoff, order=2):
    n = len(x)
    spec = np.fft.rfft(x)
    freqs = np.fft.rfftfreq(n, 1.0 / SR)
    r = (freqs / max(cutoff, 1e-6)) ** (2 * order)
    gain = np.sqrt(r / (1.0 + r))
    return np.fft.irfft(spec * gain, n)


# --------------------------------------------------------------------------
# synthesis
# --------------------------------------------------------------------------

def keypress(rng, *, dur, transient_hz, transient_q, transient_amt,
             body_hz, body_amt, partials, thump_hz, thump_amt,
             tightness, lp_hz):
    """Render one keypress. Returns a float array peak-normalised to 1.0."""
    n = max(64, int(SR * dur))
    t = np.arange(n) / SR

    # 1. transient: a noise burst squeezed into the first few milliseconds.
    noise = rng.standard_normal(n)
    env_t = np.exp(-t / (dur * 0.08 * tightness))
    transient = bandpass(noise * env_t, transient_hz, q=transient_q) * transient_amt

    # 2. body: damped partials. The ratios are deliberately inharmonic - real
    #    keycaps are lumps of plastic, not tuned strings.
    body = np.zeros(n)
    for mult, weight in partials:
        freq = body_hz * mult
        if freq >= SR / 2:
            continue
        phase = rng.uniform(0, 2 * math.pi)
        decay = np.exp(-t / (dur * 0.30 / max(mult, 0.35)))
        body += np.sin(2 * math.pi * freq * t + phase) * decay * weight
    body *= body_amt

    # 3. thump: the low knock into the case and desk. Slowest layer to fade.
    env_thump = np.exp(-t / (dur * 0.42))
    # A touch of downward pitch drift makes it read as an impact, not a beep.
    sweep = thump_hz * (1.0 + 0.35 * np.exp(-t / (dur * 0.10)))
    thump = np.sin(2 * math.pi * np.cumsum(sweep) / SR) * env_thump * thump_amt

    sig = transient + body + thump
    sig = lowpass(sig, lp_hz)
    sig = highpass(sig, 45)          # nothing useful lives below this, it just rattles

    # Remove any DC offset the filters introduced, then window both edges so the
    # file cannot start or end on a discontinuity - that would be an audible pop.
    sig -= sig.mean()
    attack = max(8, int(SR * 0.0006))
    sig[:attack] *= np.linspace(0.0, 1.0, attack)
    release = max(16, int(SR * 0.004))
    sig[-release:] *= np.linspace(1.0, 0.0, release)

    peak = np.max(np.abs(sig))
    return sig / peak if peak > 1e-9 else sig


def keyrelease(rng, base, *, dur, transient_hz, lp_hz):
    """
    The upstroke: quieter, duller and shorter than the press. The key is
    returning under spring tension rather than being driven by a finger, so
    there is much less energy and almost no low end.
    """
    n = max(64, int(SR * dur))
    t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    env = np.exp(-t / (dur * 0.12))
    sig = bandpass(noise * env, transient_hz, q=1.1)
    sig += np.sin(2 * math.pi * base * 0.7 * t) * np.exp(-t / (dur * 0.18)) * 0.25
    sig = lowpass(sig, lp_hz)
    sig = highpass(sig, 120)
    sig -= sig.mean()

    attack = max(8, int(SR * 0.0006))
    sig[:attack] *= np.linspace(0.0, 1.0, attack)
    release = max(16, int(SR * 0.004))
    sig[-release:] *= np.linspace(1.0, 0.0, release)

    peak = np.max(np.abs(sig))
    return sig / peak if peak > 1e-9 else sig


def write_wav(path, sig, gain):
    path.parent.mkdir(parents=True, exist_ok=True)
    # Leave headroom. The engine applies its own random gain on top of this and
    # we never want that to push a sample into clipping.
    data = np.clip(sig * gain * 0.89, -1.0, 1.0)
    pcm = (data * 32767.0).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


# --------------------------------------------------------------------------
# pack and group definitions
# --------------------------------------------------------------------------

PACKS = {
    "thock": {
        "name": "Thock",
        "description": "Deep and muted, like a lubed linear in a foam-filled case.",
        "voice": dict(
            dur=0.085, transient_hz=2100, transient_q=0.85, transient_amt=0.42,
            body_hz=320, body_amt=0.30, partials=[(1.0, 1.0), (2.1, 0.35), (3.6, 0.12)],
            thump_hz=115, thump_amt=0.95, tightness=1.25, lp_hz=5200,
        ),
        "release": dict(dur=0.045, transient_hz=2600, lp_hz=4200),
    },
    "click": {
        "name": "Click",
        "description": "Sharp and snappy. The sound people picture when you say mechanical.",
        "voice": dict(
            dur=0.055, transient_hz=4200, transient_q=1.5, transient_amt=1.0,
            body_hz=880, body_amt=0.34, partials=[(1.0, 1.0), (2.4, 0.5), (4.3, 0.22)],
            thump_hz=150, thump_amt=0.34, tightness=0.75, lp_hz=11000,
        ),
        "release": dict(dur=0.032, transient_hz=5200, lp_hz=9000),
    },
    "cream": {
        "name": "Cream",
        "description": "Soft and rounded. Quiet enough for an office or a late night.",
        "voice": dict(
            dur=0.070, transient_hz=1500, transient_q=0.7, transient_amt=0.30,
            body_hz=400, body_amt=0.26, partials=[(1.0, 1.0), (1.9, 0.28), (3.1, 0.08)],
            thump_hz=132, thump_amt=0.62, tightness=1.5, lp_hz=3400,
        ),
        "release": dict(dur=0.038, transient_hz=1900, lp_hz=2800),
    },
    "typewriter": {
        "name": "Typewriter",
        "description": "Metallic and theatrical, with a ringing tail. Best in small doses.",
        "voice": dict(
            dur=0.140, transient_hz=3200, transient_q=1.9, transient_amt=0.95,
            body_hz=1250, body_amt=0.52,
            partials=[(1.0, 1.0), (2.7, 0.62), (5.1, 0.34), (7.9, 0.16)],
            thump_hz=175, thump_amt=0.55, tightness=0.7, lp_hz=9500,
        ),
        "release": dict(dur=0.055, transient_hz=3800, lp_hz=7000),
    },
}

# Per-group character. Bigger keys sit lower and ring longer because they are
# physically larger and stabilised; modifiers get struck more glancingly.
GROUP_PROFILE = {
    "default":   dict(pitch=1.00, dur=1.00, gain=0.82),
    "space":     dict(pitch=0.74, dur=1.35, gain=1.00),
    "backspace": dict(pitch=1.20, dur=0.92, gain=0.86),
    "enter":     dict(pitch=0.86, dur=1.20, gain=0.94),
    "modifier":  dict(pitch=1.08, dur=0.86, gain=0.66),
    "number":    dict(pitch=1.12, dur=0.94, gain=0.80),
}


def seed_for(pack_id, group, kind, index):
    """Stable per-file seed, so output is reproducible across runs and machines."""
    key = f"{pack_id}/{group}/{kind}/{index}"
    # Hash the whole key. Reading the raw bytes little-endian and taking mod 2**32
    # only ever kept the first four characters, so every file in a pack shared
    # one seed and the "alternates" came out as identical copies.
    return int.from_bytes(hashlib.sha256(key.encode("utf-8")).digest()[:4], "little")


def build_pack(pack_id, spec):
    pack_dir = OUT / pack_id
    if pack_dir.exists():
        shutil.rmtree(pack_dir)

    sounds = {}
    for group in GROUPS:
        prof = GROUP_PROFILE[group]
        down_files, up_files = [], []

        for i in range(1, VARIANTS + 1):
            voice = dict(spec["voice"])
            voice["dur"] *= prof["dur"]
            for k in ("transient_hz", "body_hz", "thump_hz"):
                voice[k] *= prof["pitch"]

            rng = np.random.default_rng(seed_for(pack_id, group, "down", i))
            # Nudge each variant so the four alternates are not clones.
            voice["body_hz"] *= 1.0 + rng.uniform(-0.05, 0.05)
            voice["transient_hz"] *= 1.0 + rng.uniform(-0.07, 0.07)

            rel = f"down/{group}-{i}.wav"
            write_wav(pack_dir / rel, keypress(rng, **voice), prof["gain"])
            down_files.append(rel)

            r = dict(spec["release"])
            r["dur"] *= prof["dur"]
            r["transient_hz"] *= prof["pitch"]
            r["lp_hz"] *= prof["pitch"]
            rng_up = np.random.default_rng(seed_for(pack_id, group, "up", i))
            rel_up = f"up/{group}-{i}.wav"
            write_wav(
                pack_dir / rel_up,
                keyrelease(rng_up, voice["body_hz"], **r),
                prof["gain"] * 0.72,
            )
            up_files.append(rel_up)

        sounds[group] = {"down": down_files, "up": up_files}

    manifest = {
        "id": pack_id,
        "name": spec["name"],
        "description": spec["description"],
        "author": "Typeback",
        "version": "1.0.0",
        "generated": True,
        "sounds": sounds,
    }
    (pack_dir / "pack.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    return manifest


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    for pack_id, spec in PACKS.items():
        build_pack(pack_id, spec)
        count = len(GROUPS) * VARIANTS * 2
        total += count
        print(f"  {spec['name']:<12} {count:>3} files  -  {spec['description']}")
    print(f"\nwrote {total} wavs across {len(PACKS)} packs into {OUT}")


if __name__ == "__main__":
    main()
