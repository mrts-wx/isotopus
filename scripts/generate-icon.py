from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent
out = root / "src" / "assets" / "icons"
out.mkdir(parents=True, exist_ok=True)
source = root / "assets" / "branding" / "brand-source-512x512.png"
im = Image.open(source).convert("RGBA")
if im.size != (512, 512):
    im = im.resize((512, 512), Image.Resampling.LANCZOS)
for side in (512, 256, 128, 64, 32):
    im.resize((side, side), Image.Resampling.LANCZOS).save(out / f"{side}x{side}.png", optimize=True)
im.save(out / "isotopus.ico", format="ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
