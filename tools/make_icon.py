#!/usr/bin/env python3
"""生成应用图标（多密度 PNG），不依赖任何第三方素材。"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(ROOT, "app", "res")

DENSITIES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}

BG_TOP = (61, 90, 128)
BG_BOTTOM = (33, 52, 74)
GOLD = (240, 196, 106)
PAPER = (247, 250, 252)


def rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def make_icon(size):
    # 渐变背景
    grad = Image.new("RGB", (1, size))
    for y in range(size):
        t = y / max(1, size - 1)
        grad.putpixel((0, y), tuple(
            int(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t) for i in range(3)))
    grad = grad.resize((size, size))

    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    img.paste(grad, (0, 0), rounded_mask(size, int(size * 0.22)))
    d = ImageDraw.Draw(img)

    s = size / 100.0
    # 立柱（记忆宫殿）
    col_w = 7 * s
    for x in (20, 46.5, 73):
        d.rounded_rectangle([x * s, 34 * s, x * s + col_w * s / s * s, 74 * s],
                            radius=2 * s, fill=GOLD)
    # 楣梁
    d.rounded_rectangle([14 * s, 26 * s, 86 * s, 33 * s], radius=2.5 * s, fill=PAPER)
    # 台基
    d.rounded_rectangle([14 * s, 74 * s, 86 * s, 81 * s], radius=2.5 * s, fill=PAPER)
    # 山墙
    d.polygon([(50 * s, 10 * s), (92 * s, 28 * s), (8 * s, 28 * s)], fill=PAPER)
    return img


def main():
    for folder, px in DENSITIES.items():
        out_dir = os.path.join(RES, folder)
        os.makedirs(out_dir, exist_ok=True)
        icon = make_icon(px)
        icon.save(os.path.join(out_dir, "ic_launcher.png"), "PNG")
        print("wrote", os.path.join(out_dir, "ic_launcher.png"), px)


if __name__ == "__main__":
    main()
