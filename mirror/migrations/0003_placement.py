"""fit_scale / fit_offset_x / fit_offset_y o'rniga aniq joylashuv (placement).

Eski sozlamalar yo'qolmasin: standartdan farq qilgan kiyimlar uchun ko'zgu ilgari hisoblagan
qutini (garments.js placeBox) shu yerda qayta hisoblab, placement sifatida saqlaymiz.
"""
from django.db import migrations, models

FRAME = (200, 360)
UPLOAD_BOX = {
    "bluzka": (22, 18, 156, 160), "futbolka": (20, 18, 160, 154), "pidjak": (16, 16, 168, 178),
    "kurtka": (14, 12, 172, 188), "shim": (50, 148, 100, 204), "yubka": (36, 148, 128, 126),
    "koylak": (26, 20, 148, 290),
}

# Avtomatik (SVG) tasvirning ramkadagi chegarasi — garments.js SVG_BOUNDS bilan bir xil.
SVG_BOUNDS = {
    "bluzka": (24, 26, 152, 154), "futbolka": (22, 26, 156, 144), "pidjak": (22, 24, 156, 168),
    "kurtka": (16, 10, 168, 194), "shim": (50, 146, 100, 206), "yubka": (36, 146, 128, 132),
    "koylak": (26, 26, 148, 288),
}


def legacy_box(kind, image_size, scale, dx, dy):
    if image_size is None:
        # Ilgari tasvir butun ramkani egallardi; endi u kiyim chegarasigacha qirqilgan.
        fx = 100 - 100 * scale + dx
        fy = dy - (scale - 1) * 6
        bx, by, bw, bh = SVG_BOUNDS.get(kind, (0, 0, *FRAME))
        return {
            "x": round(fx + bx * scale, 2), "y": round(fy + by * scale, 2),
            "w": round(bw * scale, 2), "h": round(bh * scale, 2), "r": 0.0,
        }
    else:
        bx, by, bw, bh = UPLOAD_BOX.get(kind, UPLOAD_BOX["bluzka"])
        ar = image_size[0] / max(1, image_size[1])
        w, h = bw, bw / ar
        if h > bh:
            h, w = bh, bh * ar
        x, y = bx + (bw - w) / 2, by
    cx = x + w / 2
    return {
        "x": round(cx - w * scale / 2 + dx, 2), "y": round(y + dy - (scale - 1) * 6, 2),
        "w": round(w * scale, 2), "h": round(h * scale, 2), "r": 0.0,
    }


def forwards(apps, schema_editor):
    Product = apps.get_model("mirror", "Product")
    for p in Product.objects.exclude(fit_scale=1.0, fit_offset_x=0, fit_offset_y=0):
        size = None
        if p.tryon_image:
            try:
                from PIL import Image
                with p.tryon_image.open("rb") as f:
                    size = Image.open(f).size
            except Exception:
                size = None
        p.placement = legacy_box(p.kind, size, p.fit_scale, p.fit_offset_x, p.fit_offset_y)
        p.save(update_fields=["placement"])


class Migration(migrations.Migration):
    dependencies = [("mirror", "0002_photoreal")]

    operations = [
        migrations.AddField(
            model_name="product",
            name="placement",
            field=models.JSONField(
                blank=True, null=True, verbose_name="tanadagi joylashuvi",
                help_text="Kiyimning tana ramkasidagi joyi: {x, y, w, h, r}. Bo'sh — turiga qarab avtomatik joylanadi.",
            ),
        ),
        migrations.RunPython(forwards, migrations.RunPython.noop),
        migrations.RemoveField(model_name="product", name="fit_offset_x"),
        migrations.RemoveField(model_name="product", name="fit_offset_y"),
        migrations.RemoveField(model_name="product", name="fit_scale"),
    ]
