#!/usr/bin/env python3
"""Иконки приложения в палитре Windows 9x.

Нужен Pillow:  python3 -m venv .venv && .venv/bin/pip install pillow
Запуск:        .venv/bin/python tools/make-icons.py

Кладёт в electron/icons:
  icon.png                 — 512×512, иконка окна (BrowserWindow)
  icon.ico                 — Windows, 16…256 px
  16x16.png … 512x512.png  — набор для deb/AppImage (electron-builder ищет имена по размеру)
"""

from pathlib import Path
import math

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "electron" / "icons"
S = 512
u = S / 32.0

FACE = (192, 192, 192, 255)
WHITE = (255, 255, 255, 255)
DARK = (10, 10, 10, 255)
SHADOW = (128, 128, 128, 255)
NAVY = (0, 0, 128, 255)
TEAL = (0, 110, 110, 255)
GREEN = (0, 128, 0, 255)
CLEAR = (0, 0, 0, 0)
SIZES = [16, 24, 32, 48, 64, 128, 256, 512]


def build() -> Image.Image:
    img = Image.new("RGBA", (S, S), CLEAR)
    d = ImageDraw.Draw(img)

    def rect(x0, y0, x1, y1, color):
        d.rectangle([x0 * u, y0 * u, x1 * u - 1, y1 * u - 1], fill=color)

    # окно с тенью
    rect(4, 4, 30, 30, DARK)
    rect(2, 2, 28, 28, FACE)
    rect(2, 2, 28, 3, WHITE)
    rect(2, 2, 3, 28, WHITE)
    rect(27, 3, 28, 28, SHADOW)
    rect(2, 27, 28, 28, SHADOW)

    # заголовок и его кнопки
    rect(3, 3, 27, 7, NAVY)
    rect(4, 4, 14, 6, WHITE)
    rect(19, 4, 21, 6, FACE)
    rect(22, 4, 24, 6, FACE)

    # рабочая область
    rect(3, 7, 27, 27, FACE)

    # телефонная трубка: дуга и две «чашки» на концах
    cx, cy, r = 15.0, 17.0, 6.6
    d.arc(
        [(cx - r) * u, (cy - r) * u, (cx + r) * u, (cy + r) * u],
        start=195,
        end=345,
        fill=TEAL,
        width=int(3.2 * u),
    )
    for ang, sign in ((195, -1), (345, 1)):
        px = cx + r * math.cos(math.radians(ang))
        py = cy + r * math.sin(math.radians(ang))
        cap = Image.new("RGBA", (int(9 * u), int(9 * u)), CLEAR)
        ImageDraw.Draw(cap).rounded_rectangle(
            [0, 0, int(9 * u) - 1, int(4.6 * u) - 1], radius=int(2.3 * u), fill=TEAL
        )
        cap = cap.rotate(45 * sign, resample=Image.NEAREST, expand=True)
        img.paste(cap, (int(px * u - cap.width / 2), int(py * u - cap.height / 2)), cap)

    # зелёный «на связи»
    rect(22, 23, 25, 24, GREEN)
    rect(23, 22, 24, 25, GREEN)
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    img = build()

    img.save(OUT / "icon.png")
    img.save(OUT / "icon-512.png")
    img.save(
        OUT / "icon.ico",
        sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)],
    )
    for size in SIZES:
        img.resize((size, size), Image.LANCZOS).save(OUT / f"{size}x{size}.png")
    print("icons →", OUT)


if __name__ == "__main__":
    main()
