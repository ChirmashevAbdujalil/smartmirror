import base64
import io
import json
import shutil
import tempfile

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse
from PIL import Image

from .imaging import make_tryon_image
from .models import (
    Color, Look, MirrorDevice, MirrorSession, Order, OrderStatus, Product, ProductSize, TryOn,
)

TMP_MEDIA = tempfile.mkdtemp()


def jpeg_on_white(color=(200, 30, 60)):
    im = Image.new("RGB", (300, 300), (250, 250, 250))
    for x in range(80, 220):
        for y in range(60, 260):
            im.putpixel((x, y), color)
    im.putpixel((150, 150), (250, 250, 250))  # kiyim ichidagi oq nuqta saqlanishi kerak
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


@override_settings(MEDIA_ROOT=TMP_MEDIA)
class BaseCase(TestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(TMP_MEDIA, ignore_errors=True)

    def setUp(self):
        self.color = Color.objects.create(name="Qizil", hex="#c8324a")
        self.device = MirrorDevice.objects.create(name="Test", slug="test")
        self.p = Product.objects.create(name="Ko'ylak", kind="koylak", style="kechki", color=self.color, price=500000)
        ProductSize.objects.create(product=self.p, size="M", stock=1)
        ProductSize.objects.create(product=self.p, size="S", stock=0)

    def post(self, name, data, **kw):
        return self.client.post(reverse(name, kwargs=kw), json.dumps(data), content_type="application/json")


class ImagingTests(BaseCase):
    def test_background_removed_and_cropped(self):
        out = Image.open(make_tryon_image(io.BytesIO(jpeg_on_white())))
        self.assertEqual(out.mode, "RGBA")
        # Qirqilgan: kiyim o'lchamiga yaqin (140x200), fon yo'q.
        self.assertLess(out.width, 160)
        self.assertLess(out.height, 220)
        self.assertGreater(out.getpixel((out.width // 2, out.height // 4))[3], 200)
        # Kiyim ichidagi oq nuqta chetga tutashmagani uchun shaffof bo'lmaydi.
        cx, cy = 150 - (300 - out.width) // 2, 150 - 60 + (out.height - 200) // 2
        self.assertGreater(out.getpixel((min(cx, out.width - 1), min(cy, out.height - 1)))[3], 100)

    def test_product_photo_processed_on_save(self):
        self.p.photo = SimpleUploadedFile("k.png", jpeg_on_white(), content_type="image/png")
        self.p.save()
        self.p.refresh_from_db()
        self.assertTrue(self.p.tryon_image.name.endswith(".png"))
        first = self.p.tryon_image.name
        self.p.price = 1
        self.p.save()  # rasm o'zgarmadi — qayta ishlanmaydi
        self.p.refresh_from_db()
        self.assertEqual(self.p.tryon_image.name, first)


class ApiTests(BaseCase):
    def test_catalog(self):
        r = self.client.get(reverse("mirror:api_catalog"), {"device": "test"})
        data = r.json()
        self.assertEqual(data["device"]["slug"], "test")
        prod = data["products"][0]
        self.assertEqual(prod["slot"], "toliq")
        self.assertEqual(prod["sizes"], {"S": 0, "M": 1})
        self.assertIsNone(prod["image"])

    def test_inactive_hidden(self):
        self.p.is_active = False
        self.p.save()
        self.assertEqual(self.client.get(reverse("mirror:api_catalog")).json()["products"], [])

    def test_session_flow(self):
        sid = self.post("mirror:api_session_start", {"device": "test"}).json()["session"]
        r = self.post("mirror:api_session_try", {"product": self.p.id}, session_id=sid)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(TryOn.objects.count(), 1)
        self.assertEqual(self.post("mirror:api_session_end", {}, session_id=sid).status_code, 200)
        self.assertIsNotNone(MirrorSession.objects.get(pk=sid).ended_at)
        # Tugagan sessiyaga yozib bo'lmaydi.
        self.assertEqual(self.post("mirror:api_session_try", {"product": self.p.id}, session_id=sid).status_code, 404)

    def test_order_reserves_stock_and_rejects_when_empty(self):
        r = self.post("mirror:api_order_create", {"device": "test", "items": [{"product": self.p.id, "size": "M"}],
                                                   "phone": "+998 90 123 45 67"})
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["number"], "001")
        self.assertEqual(r.json()["total"], 500000)
        self.assertEqual(ProductSize.objects.get(product=self.p, size="M").stock, 0)
        self.assertEqual(Order.objects.get().phone, "+998901234567")

        r = self.post("mirror:api_order_create", {"items": [{"product": self.p.id, "size": "M"}]})
        self.assertEqual(r.status_code, 409)
        self.assertEqual(Order.objects.count(), 1)  # tranzaksiya qaytarildi

    def test_order_validation(self):
        self.assertEqual(self.post("mirror:api_order_create", {"items": []}).status_code, 400)
        self.assertEqual(self.post("mirror:api_order_create", {"items": [{"product": self.p.id, "size": "Q"}]}).status_code, 400)
        r = self.client.post(reverse("mirror:api_order_create"), "nojson", content_type="application/json")
        self.assertEqual(r.status_code, 400)

    def test_cancel_returns_stock(self):
        self.post("mirror:api_order_create", {"items": [{"product": self.p.id, "size": "M"}]})
        order = Order.objects.get()
        order.set_status(OrderStatus.CANCELLED)
        self.assertEqual(ProductSize.objects.get(product=self.p, size="M").stock, 1)
        order.set_status(OrderStatus.CANCELLED)  # takroriy — o'zgarmaydi
        self.assertEqual(ProductSize.objects.get(product=self.p, size="M").stock, 1)
        order.set_status(OrderStatus.PREPARING)  # qayta faollashtirish — yana zaxira
        self.assertEqual(ProductSize.objects.get(product=self.p, size="M").stock, 0)

    def test_look_with_snapshot_and_qr(self):
        buf = io.BytesIO()
        Image.new("RGB", (40, 60), (10, 10, 10)).save(buf, "JPEG")
        snap = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
        r = self.post("mirror:api_look_create", {"products": [self.p.id], "snapshot": snap})
        self.assertEqual(r.status_code, 201, r.content)
        data = r.json()
        self.assertIn("<svg", data["qr"])
        look = Look.objects.get(token=data["token"])
        self.assertTrue(look.snapshot.name.endswith(".jpg"))
        page = self.client.get(look.get_absolute_url())
        self.assertContains(page, "Ko&#x27;ylak")

    def test_look_rejects_bad_snapshot(self):
        r = self.post("mirror:api_look_create", {"products": [self.p.id], "snapshot": "data:image/png;base64,AAAA"})
        self.assertEqual(r.status_code, 400)


class PageTests(BaseCase):
    def test_home_redirects_to_device(self):
        r = self.client.get("/")
        self.assertRedirects(r, "/mirror/test/")
        page = self.client.get("/mirror/test/")
        self.assertContains(page, 'data-device="test"')
        self.assertIn("csrftoken", page.cookies)

    def test_staff_pages_require_login(self):
        for name in ("mirror:staff_orders", "mirror:stats", "mirror:staff_orders_api"):
            self.assertEqual(self.client.get(reverse(name)).status_code, 302)

    def test_staff_pages_and_status_change(self):
        admin = get_user_model().objects.create_superuser("admin", "a@a.uz", "pass12345")
        self.client.force_login(admin)
        self.post("mirror:api_order_create", {"items": [{"product": self.p.id, "size": "M"}]})
        order = Order.objects.get()
        data = self.client.get(reverse("mirror:staff_orders_api")).json()
        self.assertEqual(data["orders"][0]["number"], order.number)
        r = self.client.post(reverse("mirror:staff_order_status", args=[order.pk]), {"status": "sold"})
        self.assertEqual(r.status_code, 200)
        order.refresh_from_db()
        self.assertEqual(order.status, "sold")
        self.assertEqual(self.client.get(reverse("mirror:stats")).status_code, 200)
        self.assertEqual(self.client.get(reverse("mirror:staff_orders")).status_code, 200)
        # Admin sahifalari ham ochiladi.
        for url in ("/admin/", "/admin/mirror/product/", "/admin/mirror/product/add/",
                    f"/admin/mirror/product/{self.p.pk}/change/", "/admin/mirror/order/", "/admin/mirror/mirrorsession/"):
            self.assertEqual(self.client.get(url).status_code, 200, url)

    def test_admin_add_product_with_sizes(self):
        admin = get_user_model().objects.create_superuser("admin", "a@a.uz", "pass12345")
        self.client.force_login(admin)
        data = {
            "name": "Yangi bluzka", "kind": "bluzka", "style": "klassik", "color": self.color.pk, "price": 100000,
            "description": "", "is_active": "on", "sort_order": 0, "remove_background": "on",
            "fit_scale": 1.0, "fit_offset_x": 0, "fit_offset_y": 0,
            "sizes-TOTAL_FORMS": 6, "sizes-INITIAL_FORMS": 0, "sizes-MIN_NUM_FORMS": 0, "sizes-MAX_NUM_FORMS": 6,
        }
        for i, s in enumerate(["XS", "S", "M", "L", "XL", "XXL"]):
            data[f"sizes-{i}-size"] = s
            data[f"sizes-{i}-stock"] = 3 if s == "M" else 0
        r = self.client.post("/admin/mirror/product/add/", data)
        self.assertEqual(r.status_code, 302, r.content.decode()[:2000])
        p = Product.objects.get(name="Yangi bluzka")
        self.assertEqual({s.size: s.stock for s in p.sizes.all()}, {"M": 3})
