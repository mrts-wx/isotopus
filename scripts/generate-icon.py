from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent
out = root / "build" / "icons"
out.mkdir(parents=True, exist_ok=True)
size = 512
im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
d = ImageDraw.Draw(im)

# Warm cream tile and a single, record-like Isótopus mark.
d.rounded_rectangle((18, 18, 494, 494), radius=126, fill="#eddbc4")
d.ellipse((94, 94, 418, 418), fill="#5c5259")
d.ellipse((122, 122, 390, 390), outline="#a3c9a7", width=12)
d.ellipse((158, 158, 354, 354), outline="#ffb353", width=8)
d.ellipse((210, 210, 302, 302), fill="#eddbc4")
d.ellipse((239, 239, 273, 273), fill="#ff6e4a")
# The small offset line makes the disc read like a music record at launcher size.
d.arc((124, 124, 388, 388), start=208, end=300, fill="#ff6e4a", width=12)

for side in (512, 256, 128, 64, 32):
    im.resize((side, side), Image.Resampling.LANCZOS).save(out / f"{side}x{side}.png", optimize=True)
