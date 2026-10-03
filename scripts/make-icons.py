"""Regenerates the PWA icons in public/icons (requires Pillow)."""
from PIL import Image, ImageDraw

ACCENT, SUN, CREAM = (196, 58, 34), (244, 183, 64), (255, 246, 236)

def icon(size, maskable=False):
    s = size * 4  # supersample for smooth edges
    img = Image.new('RGB', (s, s), ACCENT)
    d = ImageDraw.Draw(img)
    if not maskable:
        img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=ACCENT)
    scale = 0.62 if maskable else 0.78
    r = s * 0.17 * scale / 0.78
    cy = s / 2
    gap = r * 0.82
    d.ellipse([s / 2 - gap - r, cy - r, s / 2 - gap + r, cy + r], fill=CREAM)
    d.ellipse([s / 2 + gap - r, cy - r, s / 2 + gap + r, cy + r], fill=SUN)
    return img.resize((size, size), Image.LANCZOS)

for size in (192, 512):
    icon(size).save(f'public/icons/icon-{size}.png')
    icon(size, maskable=True).save(f'public/icons/maskable-{size}.png')
icon(180, maskable=True).save('public/icons/icon-180.png')
