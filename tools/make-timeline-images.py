"""The images of the front timeline (src/timeline.ts): the end of a marquee, fading into the plate.

  python tools/make-timeline-images.py

fade_<fill>.png: 4x6, the plate's fill rising from 25 % to 100 % opacity, for each service's fill and lit fill.
Keep FILLS in step with LOOKS in src/timeline.ts.
"""
from pathlib import Path
from PIL import Image

FILLS = ["15253A", "1E3655", "202C40", "2D3E5A", "2E1E22", "432A30", "241F3D", "342C57", "132A40", "1C3B5A", "24272D", "33373F"]
OUT = Path(__file__).resolve().parent.parent / "src" / "images"
OUT.mkdir(parents=True, exist_ok=True)
for fill in FILLS:
    rgb = tuple(int(fill[i : i + 2], 16) for i in (0, 2, 4))
    im = Image.new("RGBA", (4, 6), (0, 0, 0, 0))
    for x, a in enumerate([0x40, 0x80, 0xC0, 0xFF]):
        for y in range(6):
            im.putpixel((x, y), rgb + (a,))
    im.save(OUT / f"fade_{fill}.png")
print(len(FILLS), "fades in", OUT)
