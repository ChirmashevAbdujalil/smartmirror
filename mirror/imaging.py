"""Kiyim rasmini kiyib ko'rish uchun tayyorlash.

Do'kon odatda kiyimni oq yoki bir xil rangli fonda suratga oladi. Bu yerda:
  1. EXIF bo'yicha aylantiriladi, o'lchami kichraytiriladi;
  2. rasm chetidan boshlab fonga o'xshash piksellar "to'ldirish" (flood fill) usulida shaffof qilinadi
     — kiyim ichidagi oq detallar (tugma, yoqa) saqlanib qoladi, chunki ular chetga tutashmagan;
  3. qirralar biroz yumshatiladi va rasm kiyim chegarasigacha qirqiladi.
Agar rasmda shaffoflik allaqachon bo'lsa (PNG), fon olib tashlanmaydi.
"""
import io

from django.core.files.base import ContentFile
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps

MAX_SIDE = 900
TOLERANCE = 60  # RGB kanallar bo'yicha farqlar yig'indisi


def _has_transparency(im: Image.Image) -> bool:
    if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
        alpha = im.convert("RGBA").getchannel("A")
        return alpha.getextrema()[0] < 250
    return False


def _border_points(w, h, step):
    for x in range(0, w, step):
        yield (x, 0)
        yield (x, h - 1)
    for y in range(0, h, step):
        yield (0, y)
        yield (w - 1, y)


def remove_background(im: Image.Image, tolerance: int = TOLERANCE) -> Image.Image:
    """Chetga tutashgan bir xil fonni shaffof qiladi."""
    rgb = im.convert("RGB")
    w, h = rgb.size
    # Mask: 255 — fon. Flood fill RGB nusxada, natija alfa kanalga o'tkaziladi.
    marker = (255, 0, 255)
    work = rgb.copy()
    corner = rgb.getpixel((0, 0))
    for pt in _border_points(w, h, max(1, min(w, h) // 40)):
        px = work.getpixel(pt)
        if px == marker:
            continue
        # Faqat burchak rangiga yaqin chet nuqtalardan boshlaymiz (kiyim chetga tegib tursa, uni yemaslik uchun).
        if sum(abs(a - b) for a, b in zip(px, corner)) > tolerance * 1.5:
            continue
        ImageDraw.floodfill(work, pt, marker, thresh=tolerance)

    diff = ImageChops.difference(work, Image.new("RGB", (w, h), marker))
    mask = diff.convert("L").point(lambda v: 0 if v == 0 else 255)
    # Qirralarni tozalash va yumshatish.
    mask = mask.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.2))
    out = rgb.convert("RGBA")
    out.putalpha(mask)
    return out


def make_tryon_image(fileobj, remove_bg: bool = True) -> ContentFile:
    im = Image.open(fileobj)
    im = ImageOps.exif_transpose(im)
    im.thumbnail((MAX_SIDE, MAX_SIDE))
    if remove_bg and not _has_transparency(im):
        im = remove_background(im)
    else:
        im = im.convert("RGBA")
    bbox = im.getchannel("A").point(lambda a: 255 if a > 16 else 0).getbbox()
    if bbox:
        im = im.crop(bbox)
    buf = io.BytesIO()
    im.save(buf, "PNG", optimize=True)
    return ContentFile(buf.getvalue())
