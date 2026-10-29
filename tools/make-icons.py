#!/usr/bin/env python3
"""Иконки и картинки установщика в палитре Windows 9x.

Нужен Pillow:  python3 -m venv .venv && .venv/bin/pip install pillow
Запуск:        .venv/bin/python tools/make-icons.py

Кладёт в electron/icons:
  icon.png                 — 512×512, иконка окна (BrowserWindow)
  icon.ico                 — Windows, 16…256 px
  16x16.png … 512x512.png  — набор для deb/AppImage (electron-builder ищет имена по размеру)
  installerSidebar.bmp     — боковая панель мастера установки, 164×314
  installerHeader.bmp      — шапка страниц мастера, 150×57
"""

from pathlib import Path
import math

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / "electron" / "icons"

FACE = (192, 192, 192, 255)
WHITE = (255, 255, 255, 255)
DARK = (10, 10, 10, 255)
SHADOW = (128, 128, 128, 255)
NAVY = (0, 0, 128, 255)
TEAL = (0, 110, 110, 255)
PALE = (198, 226, 226, 255)
GREEN = (0, 128, 0, 255)
CLEAR = (0, 0, 0, 0)
INK = (64, 64, 64, 255)

SIZES = [16, 24, 32, 48, 64, 128, 256, 512]
FONT_DIR = "/usr/share/fonts/truetype/dejavu"
FONT_BOLD = f"{FONT_DIR}/DejaVuSans-Bold.ttf"
FONT_UI = f"{FONT_DIR}/DejaVuSans.ttf"


def font(path: str, size: int):
    try:
        return ImageFont.truetype(path, size)
    except OSError:  # шрифта нет — берём встроенный bitmap
        return ImageFont.load_default()


def draw_phone(d: ImageDraw.ImageDraw, cx: float, cy: float, r: float, thick: float,
               color=TEAL) -> None:
    """Телефонная трубка: дуга и две «чашки» на концах."""
    d.arc([cx - r, cy - r, cx + r, cy + r], start=195, end=345, fill=color,
          width=max(2, int(thick)))
    cap_w, cap_h = r * 1.4, r * 0.72
    for ang, sign in ((195, -1), (345, 1)):
        px = cx + r * math.cos(math.radians(ang))
        py = cy + r * math.sin(math.radians(ang))
        cap = Image.new("RGBA", (int(cap_w) + 2, int(cap_h) + 2), CLEAR)
        ImageDraw.Draw(cap).rounded_rectangle(
            [0, 0, int(cap_w) - 1, int(cap_h) - 1], radius=int(cap_h / 2), fill=color
        )
        cap = cap.rotate(45 * sign, resample=Image.NEAREST, expand=True)
        d._image.paste(
            cap,
            (int(px - cap.width / 2), int(py - cap.height / 2)),
            cap,
        )


def bevel(d: ImageDraw.ImageDraw, box, face=FACE, width=1) -> None:
    """Выпуклая рамка окна Win98."""
    x0, y0, x1, y1 = box
    d.rectangle(box, fill=face)
    d.line([x0, y0, x1, y0], fill=WHITE, width=width)
    d.line([x0, y0, x0, y1], fill=WHITE, width=width)
    d.line([x1, y0, x1, y1], fill=SHADOW, width=width)
    d.line([x0, y1, x1, y1], fill=SHADOW, width=width)


def window_mockup(size: int, title: str, caption: str = "") -> Image.Image:
    """Окно Win98 с заголовком и трубкой — крупный вариант иконки."""
    img = Image.new("RGBA", (size, size), CLEAR)
    d = ImageDraw.Draw(img)
    d._image = img  # чтобы draw_phone мог вставлять «чашки»

    # тень
    d.rectangle((2, 2, size - 1, size - 1), fill=DARK)
    bevel(d, (0, 0, size - 3, size - 3))

    bar = max(10, size // 7)
    d.rectangle((1, 1, size - 4, bar), fill=NAVY)
    if title:
        f = font(FONT_BOLD, max(7, size // 15))
        d.text((5, bar / 2), title, font=f, fill=WHITE, anchor="lm")
    for i in range(2):
        bw = max(6, size // 10)
        bx = size - 6 - (i + 1) * (bw + 2)
        d.rectangle((bx, 4, bx + bw, bar - 4), fill=FACE)

    body_top = bar + 2
    body_bottom = size - 4
    cx = (size - 3) / 2
    cy = body_top + (body_bottom - body_top) / 2 - (size * 0.06 if caption else 0)
    r = size * 0.26
    draw_phone(d, cx, cy, r, r * 0.48)

    # «на связи»
    gx = size - size * 0.22
    gy = body_bottom - size * 0.12
    d.rectangle((gx, gy - 3, gx + 9, gy + 6), fill=GREEN)
    d.rectangle((gx + 3, gy - 6, gx + 6, gy + 9), fill=GREEN)

    if caption:
        d.text((6, size - 6), caption, font=font(FONT_UI, max(7, size // 12)),
               fill=INK, anchor="ls")
    return img


def app_icon() -> Image.Image:
    """Иконка приложения: окно с синим заголовком и трубкой."""
    base = window_mockup(496, "LongCall 98")
    img = Image.new("RGBA", (512, 512), CLEAR)
    img.paste(base, (8, 8), base)
    return img


def build_sidebar() -> Image.Image:
    """Боковая панель мастера установки: 164×314."""
    w, h = 164, 314
    img = Image.new("RGB", (w, h), FACE)
    d = ImageDraw.Draw(img)

    d.rectangle((0, 0, w, 48), fill=TEAL)
    d.text((10, 7), "LongCall 98", font=font(FONT_BOLD, 15), fill=WHITE)
    d.text((10, 28), "Установка программы", font=font(FONT_UI, 9), fill=PALE)

    bevel(d, (0, 48, w - 1, h - 1))

    art = window_mockup(112, "LongCall 98")
    img.paste(art, ((w - 112) // 2, 62), art)

    lines = [
        ("LongCall 98 —", FONT_BOLD, 11),
        ("аудиозвонки", FONT_BOLD, 11),
        ("до 4 человек", FONT_BOLD, 11),
    ]
    y = 190
    for text, kind, size in lines:
        d.text((14, y), text, font=font(kind, size), fill=(0, 0, 0))
        y += 15

    for i, line in enumerate(["Windows 9x издание", "версия 1.0", "только звук"]):
        d.text((14, 244 + i * 13), line, font=font(FONT_UI, 8), fill=INK)

    d.line((12, 292, w - 13, 292), fill=SHADOW)
    d.text((14, 296), "© 1998—2026 LongCall", font=font(FONT_UI, 7), fill=(96, 96, 96))
    return img


def build_header() -> Image.Image:
    """Шапка страниц мастера: 150×57."""
    w, h = 150, 57
    img = Image.new("RGB", (w, h), FACE)
    d = ImageDraw.Draw(img)
    d.line((0, 0, w, 0), fill=WHITE)
    d.line((0, h - 1, w, h - 1), fill=SHADOW)

    # в шапке окно совсем маленькое — заголовок там не читается, только рамка и трубка
    art = window_mockup(46, "").resize((46, 46), Image.LANCZOS)
    img.paste(art, (5, 6), art)

    d.text((58, 8), "LongCall 98", font=font(FONT_BOLD, 12), fill=NAVY)
    d.text((58, 26), "версия 1.0", font=font(FONT_UI, 9), fill=INK)
    d.text((58, 38), "Windows 9x Edition", font=font(FONT_UI, 8), fill=INK)
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    img = app_icon()

    img.save(OUT / "icon.png")
    img.save(OUT / "icon-512.png")
    img.save(
        OUT / "icon.ico",
        sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)],
    )
    for size in SIZES:
        img.resize((size, size), Image.LANCZOS).save(OUT / f"{size}x{size}.png")

    # картинки мастера установки Windows (NSIS): нужны именно 24-битные BMP
    build_sidebar().save(OUT / "installerSidebar.bmp")
    build_header().save(OUT / "installerHeader.bmp")
    print("icons →", OUT)


if __name__ == "__main__":
    main()
