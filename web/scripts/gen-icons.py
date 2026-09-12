"""Generate every raster brand asset from static/icon.svg.

Run:  python scripts/gen-icons.py      (from web/)

WHY THIS EXISTS
---------------
Two things were broken and one was missing:

  - `og:image` pointed at an SVG. X, Facebook, LinkedIn, Slack and Discord all
    refuse to render SVG previews, so every shared link showed a blank card.
    Social cards must be PNG or JPEG. This writes a real 1200x630 PNG.
  - The PWA manifest offered SVG icons only. Android's installer and the iOS
    home screen both want raster; `apple-touch-icon` has never accepted SVG.
  - The old icons drew a "▶" as an SVG <text> element in
    font-family="system-ui", so the mark was whatever glyph the host font
    happened to have - a different shape per platform, and a tofu box where
    none existed.

The mark now lives once, as geometry, in static/icon.svg. Everything here is
derived from that file, so there is no second copy to drift.

OUTPUTS (all committed - the build never runs this script)
    static/icon-192.png            PWA, purpose "any"
    static/icon-512.png            PWA, purpose "any"
    static/icon-maskable-512.png   PWA, purpose "maskable" (padded to the
                                   40% safe radius Android may crop to)
    static/apple-touch-icon.png    180x180, iOS home screen
    static/favicon-32.png          fallback for browsers without SVG favicons
    static/og.png                  1200x630 social card

REQUIREMENTS
    Pillow           - present in this environment
    node + sharp     - sharp rasterises the SVG. It is NOT a declared
                       dependency: it arrives transitively under wrangler. If
                       that ever stops being true:  npm i --no-save sharp
    node + wawoff2   - converts the brand woff2 to TTF so the card is set in
                       the real typefaces rather than a system substitute.
                       Install on demand:           npm i --no-save wawoff2

Both node packages are deliberately NOT in package.json. They are needed to
regenerate art perhaps once a year; carrying them in every CI install to serve
that is not a trade worth making.
"""

from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

WEB = Path(__file__).resolve().parent.parent
STATIC = WEB / "static"
MARK = STATIC / "icon.svg"

# Supersampling factor for the card. FreeType already antialiases glyphs, but
# the rounded rectangles and the glow need it, and text only improves.
SS = 2

# Straight from the dark theme in src/index.css. Kept as literals rather than
# parsed out of the CSS: this runs once in a blue moon, and a silent parse
# failure that yields black-on-black is worse than a stale constant.
INK = (20, 18, 15)  # --background  30 14%  7%
AMBER = (251, 162, 45)  # --primary     34 96% 58%
PAPER = (246, 240, 232)  # --foreground  40 20% 95%
MUTED = (169, 157, 143)  # --muted-foreground
DIM = (122, 112, 101)

FONTS = {
    "display": "@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2",
    "body": "@fontsource-variable/ibm-plex-sans/files/ibm-plex-sans-latin-wght-normal.woff2",
}


def node(script: str) -> str:
    """Run an ESM snippet in web/ so its bare imports resolve."""
    with tempfile.NamedTemporaryFile(
        "w", suffix=".mjs", dir=WEB, delete=False, encoding="utf-8"
    ) as fh:
        fh.write(script)
        path = fh.name
    try:
        out = subprocess.run(
            ["node", path], cwd=WEB, capture_output=True, text=True, encoding="utf-8"
        )
        if out.returncode != 0:
            sys.exit(f"node failed:\n{out.stderr.strip()}")
        return out.stdout
    finally:
        os.unlink(path)


def rasterise(sizes: dict[str, int], tmp: Path) -> None:
    """icon.svg -> PNG at each size, via sharp."""
    spec = json.dumps([{"out": str(tmp / n), "px": px} for n, px in sizes.items()])
    node(
        "import sharp from 'sharp';\n"
        "import { readFileSync } from 'node:fs';\n"
        f"const svg = readFileSync({json.dumps(str(MARK))});\n"
        f"for (const j of {spec}) {{\n"
        "  await sharp(svg, { density: 384 }).resize(j.px, j.px).png().toFile(j.out);\n"
        "}\n"
        "console.log('ok');\n"
    )


def to_ttf(tmp: Path) -> dict[str, Path]:
    """Brand woff2 -> TTF, so PIL can set the card in the real typefaces."""
    jobs = {k: str(WEB / "node_modules" / v) for k, v in FONTS.items()}
    out = {k: tmp / f"{k}.ttf" for k in jobs}
    node(
        "import { decompress } from 'wawoff2';\n"
        "import { readFileSync, writeFileSync } from 'node:fs';\n"
        f"for (const [k, src] of Object.entries({json.dumps(jobs)})) {{\n"
        f"  const dst = {json.dumps(str(tmp))} + '/' + k + '.ttf';\n"
        "  writeFileSync(dst, Buffer.from(await decompress(readFileSync(src))));\n"
        "}\n"
        "console.log('ok');\n"
    )
    return out


def face(path: Path, size: int, weight: float) -> ImageFont.FreeTypeFont:
    """Load a variable font at a named weight.

    These are variable fonts whose DEFAULT instance is Regular. Without the
    axis set, every heading renders at 400 and the card has no typographic
    hierarchy at all - which looks like a design choice rather than the bug it
    is, so it is easy to ship by accident.
    """
    f = ImageFont.truetype(str(path), size * SS)
    try:
        f.set_variation_by_axes([weight])
    except Exception as exc:  # noqa: BLE001 - see docstring
        print(f"  ! could not set wght={weight} on {path.name}: {exc}")
    return f


def tracked(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    text: str,
    font: ImageFont.FreeTypeFont,
    fill: tuple[int, int, int],
    track: float,
) -> None:
    """Draw letter-spaced text. PIL has no tracking, so step glyph by glyph."""
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=font, fill=fill)
        x += draw.textlength(ch, font=font) + track * SS


def wrap(
    draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, width: int
) -> list[str]:
    lines, cur = [], ""
    for word in text.split():
        trial = f"{cur} {word}".strip()
        if draw.textlength(trial, font=font) <= width * SS:
            cur = trial
        else:
            lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def card(mark: Image.Image, fonts: dict[str, Path]) -> Image.Image:
    w, h = 1200 * SS, 630 * SS
    img = Image.new("RGB", (w, h), INK)

    # ── warm glow, upper left ────────────────────────────────────────────────
    # Built as a blurred mask rather than a gradient: one ellipse plus a heavy
    # blur gives a softer falloff than any stepped gradient PIL can draw.
    glow = Image.new("L", (w, h), 0)
    ImageDraw.Draw(glow).ellipse(
        [-260 * SS, -360 * SS, 760 * SS, 420 * SS], fill=46
    )
    glow = glow.filter(ImageFilter.GaussianBlur(150 * SS))
    img = Image.composite(Image.new("RGB", (w, h), AMBER), img, glow)

    # ── oversized bars bleeding off the bottom-right ─────────────────────────
    # The mark's own proportions, scaled up and cropped by the canvas. Ties the
    # card to the icon without repeating it at the same size.
    deco = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(deco)
    for i, (bx, top) in enumerate([(905, 392), (1010, 300), (1115, 196)]):
        d.rounded_rectangle(
            [bx * SS, top * SS, (bx + 70) * SS, 700 * SS],
            radius=20 * SS,
            fill=AMBER + (16 + i * 9,),
        )
    img = Image.alpha_composite(img.convert("RGBA"), deco).convert("RGB")

    draw = ImageDraw.Draw(img)

    # ── eyebrow: mark + wordmark ─────────────────────────────────────────────
    img.paste(mark, (72 * SS, 56 * SS), mark)
    eyebrow = face(fonts["body"], 22, 600)
    tracked(
        draw,
        (184 * SS, 71 * SS),
        "STEAM F2P TRACKER",
        eyebrow,
        PAPER,
        3.4,
    )
    tracked(
        draw,
        (184 * SS, 106 * SS),
        "free-steam-games.win",
        face(fonts["body"], 21, 400),
        DIM,
        0.6,
    )

    # ── headline ─────────────────────────────────────────────────────────────
    head = face(fonts["display"], 82, 700)
    y = 206 * SS
    for line in ["Every free-to-play", "game on Steam"]:
        draw.text((72 * SS, y), line, font=head, fill=PAPER)
        y += 92 * SS

    # A short amber rule under the headline, echoing the baseline in the mark.
    draw.rounded_rectangle(
        [72 * SS, y + 26 * SS, (72 + 88) * SS, y + 33 * SS],
        radius=4 * SS,
        fill=AMBER,
    )

    # ── subtitle ─────────────────────────────────────────────────────────────
    sub = face(fonts["body"], 27, 400)
    sy = y + 58 * SS
    for line in wrap(
        draw,
        "Players, reviews, anti-cheat and DRM for 3,600+ games — "
        "tracked daily from a public, open dataset.",
        sub,
        740,
    ):
        draw.text((72 * SS, sy), line, font=sub, fill=MUTED)
        sy += 40 * SS

    # ── chips ────────────────────────────────────────────────────────────────
    chip = face(fonts["body"], 20, 500)
    cx = 72 * SS
    for label in ["3,600+ games", "Updated daily", "Open data · CC BY 4.0"]:
        tw = draw.textlength(label, font=chip)
        draw.rounded_rectangle(
            [cx, 548 * SS, cx + tw + 34 * SS, 592 * SS],
            radius=22 * SS,
            outline=(58, 52, 46),
            width=SS,
        )
        draw.text((cx + 17 * SS, 558 * SS), label, font=chip, fill=MUTED)
        cx += tw + 34 * SS + 14 * SS

    return img.resize((1200, 630), Image.LANCZOS)


def main() -> None:
    if not MARK.exists():
        sys.exit(f"missing {MARK}")

    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)

        sizes = {
            "icon-192.png": 192,
            "icon-512.png": 512,
            "apple-touch-icon.png": 180,
            "favicon-32.png": 32,
            "mark.png": 96,
            "maskable-src.png": 410,
        }
        print("rasterising icon.svg ...")
        rasterise(sizes, tmp)

        for name in ("icon-192.png", "icon-512.png", "apple-touch-icon.png", "favicon-32.png"):
            (STATIC / name).write_bytes((tmp / name).read_bytes())
            print(f"  {name}")

        # Maskable: Android crops to a circle of 40% radius, so the artwork has
        # to sit inside 80% of the canvas. icon.svg is already safe for that on
        # its own, but a maskable icon must also fill the frame edge-to-edge -
        # its own rounded corners would be cropped into a lumpy outline. Paint
        # the ink to the edges and inset the mark.
        mask = Image.new("RGBA", (512, 512), INK + (255,))
        inner = Image.open(tmp / "maskable-src.png").convert("RGBA")
        mask.alpha_composite(inner, (51, 51))
        mask.convert("RGB").save(STATIC / "icon-maskable-512.png")
        print("  icon-maskable-512.png")

        print("converting brand fonts ...")
        fonts = to_ttf(tmp)

        print("composing og.png ...")
        mark = Image.open(tmp / "mark.png").convert("RGBA").resize((96 * SS, 96 * SS), Image.LANCZOS)
        card(mark, fonts).save(STATIC / "og.png", optimize=True)
        print(f"  og.png ({(STATIC / 'og.png').stat().st_size // 1024} KB)")

    print("done")


if __name__ == "__main__":
    main()
