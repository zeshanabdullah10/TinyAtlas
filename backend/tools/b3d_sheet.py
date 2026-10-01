"""Contact sheet of every candidate (front + 35 deg render) for one building: python b3d_sheet.py thal"""
import glob, sys
from PIL import Image, ImageDraw
slug = sys.argv[1]
files = sorted(glob.glob(f"{slug}_*_a.png"))
W, H = 480, 360
sheet = Image.new("RGB", (W * 2, H * ((len(files) + 1) // 1)), "white")
for i, f in enumerate(files):
    for j, t in enumerate("ab"):
        im = Image.open(f.replace("_a.png", f"_{t}.png")).resize((W, H))
        sheet.paste(im, (j * W, i * H))
    ImageDraw.Draw(sheet).text((5, i * H + 5), f[:-6], fill="red")
sheet.crop((0, 0, W * 2, H * len(files))).save(f"{slug}_sheet.png")
