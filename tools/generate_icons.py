#!/usr/bin/env python3
"""
Draw Typeback's icons.

The mark is a keycap with three equaliser bars on its face - "a key that makes
sound". Anything more detailed turns to mush at 16px, which is the size that
actually matters for a tray app.

Everything is drawn at 8x and downsampled with Lanczos, which is a cheap way to
get clean antialiasing without hinting each size by hand.

    python tools/generate_icons.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"

SS = 8  # supersample factor

ACCENT_DARK = (52, 96, 220, 255)     # keycap side / shadow
ACCENT = (91, 140, 255, 255)         # keycap top face
FACE = (232, 238, 255, 255)          # bars
MUTED_DARK = (78, 84, 98, 255)
MUTED = (122, 129, 145, 255)
MUTED_FACE = (196, 201, 212, 255)
SLASH = (255, 92, 92, 255)


def draw_mark(px, *, muted=False):
    """Render the icon at `px` pixels square, transparent background."""
    n = px * SS
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    side = MUTED_DARK if muted else ACCENT_DARK
    top = MUTED if muted else ACCENT
    face = MUTED_FACE if muted else FACE

    pad = n * 0.09
    radius = n * 0.22

    # Body of the keycap, plus a lighter top face offset upward so it reads as a
    # physical key rather than a flat square.
    d.rounded_rectangle([pad, pad, n - pad, n - pad], radius=radius, fill=side)
    d.rounded_rectangle(
        [pad + n * 0.06, pad + n * 0.04, n - pad - n * 0.06, n - pad - n * 0.14],
        radius=radius * 0.8,
        fill=top,
    )

    # Three equaliser bars, centre tallest.
    heights = [0.30, 0.52, 0.38]
    bar_w = n * 0.085
    gap = n * 0.075
    total = len(heights) * bar_w + (len(heights) - 1) * gap
    x = (n - total) / 2
    mid = pad + n * 0.04 + (n - 2 * pad - n * 0.18) / 2

    for h in heights:
        half = n * h / 2
        d.rounded_rectangle(
            [x, mid - half, x + bar_w, mid + half],
            radius=bar_w / 2,
            fill=face,
        )
        x += bar_w + gap

    if muted:
        # A diagonal slash, drawn with a dark outline underneath so it stays
        # visible against both the keycap and whatever is behind the tray.
        w = n * 0.075
        d.line([n * 0.14, n * 0.14, n * 0.86, n * 0.86], fill=(20, 21, 26, 255), width=int(w * 2.0))
        d.line([n * 0.14, n * 0.14, n * 0.86, n * 0.86], fill=SLASH, width=int(w))

    return img.resize((px, px), Image.LANCZOS)


def save_ico(path, sizes, *, muted=False):
    largest = draw_mark(max(sizes), muted=muted)
    # Pillow rebuilds each embedded size from the image it is given; passing the
    # largest render keeps every frame sharp.
    largest.save(path, format="ICO", sizes=[(s, s) for s in sizes])
    return path


def main():
    BUILD.mkdir(parents=True, exist_ok=True)

    save_ico(BUILD / "icon.ico", [16, 24, 32, 48, 64, 128, 256])
    save_ico(BUILD / "tray.ico", [16, 20, 24, 32, 40, 48])
    save_ico(BUILD / "tray-muted.ico", [16, 20, 24, 32, 40, 48], muted=True)

    # A plain PNG is handy for the readme and for any non-Windows tooling.
    draw_mark(256).save(BUILD / "icon.png")

    for f in sorted(BUILD.iterdir()):
        print(f"  {f.name:<18} {f.stat().st_size / 1024:6.1f} KB")


if __name__ == "__main__":
    main()
