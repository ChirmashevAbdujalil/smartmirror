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
    AISettings, Color, Look, MirrorDevice, MirrorSession, Order, OrderStatus, Product, ProductSize, TryOn,
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
        # Eski manzillar yangi boshqaruv paneliga yo'naltiradi.
        self.assertRedirects(self.client.get(reverse("mirror:stats")), "/panel/stats/?days=30")
        self.assertRedirects(self.client.get(reverse("mirror:staff_orders")), "/panel/orders/")
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
            "placement": '{"x": 30, "y": 24, "w": 140, "h": 150, "r": -4.5}',
            "sizes-TOTAL_FORMS": 6, "sizes-INITIAL_FORMS": 0, "sizes-MIN_NUM_FORMS": 0, "sizes-MAX_NUM_FORMS": 6,
        }
        for i, s in enumerate(["XS", "S", "M", "L", "XL", "XXL"]):
            data[f"sizes-{i}-size"] = s
            data[f"sizes-{i}-stock"] = 3 if s == "M" else 0
        r = self.client.post("/admin/mirror/product/add/", data)
        self.assertEqual(r.status_code, 302, r.content.decode()[:2000])
        p = Product.objects.get(name="Yangi bluzka")
        self.assertEqual({s.size: s.stock for s in p.sizes.all()}, {"M": 3})
        self.assertEqual(p.placement, {"x": 30.0, "y": 24.0, "w": 140.0, "h": 150.0, "r": -4.5})


# ---------------- Fotorealistik AI ----------------
from unittest import mock

from . import vton
from .models import AISettings, PhotorealJob


def _img_bytes(fmt="JPEG", color=(120, 80, 90)):
    buf = io.BytesIO()
    Image.new("RGB", (64, 96), color).save(buf, fmt)
    return buf.getvalue()


def _uri(raw, mime="image/jpeg"):
    return f"data:{mime};base64," + base64.b64encode(raw).decode()


@override_settings(VTON_SYNC=True)
@mock.patch.object(vton, "POLL_SECONDS", 0)
class PhotorealTests(BaseCase):
    def setUp(self):
        super().setUp()
        self.top = Product.objects.create(name="Bluzka", kind="bluzka", style="klassik", color=self.color, price=1)
        self.pants = Product.objects.create(name="Shim", kind="shim", style="klassik", color=self.color, price=1)
        self.pants.photo = SimpleUploadedFile("s.png", jpeg_on_white(), content_type="image/png")
        self.pants.save()

    def configure(self, **kw):
        cfg = AISettings.load()
        for k, v in kw.items():
            setattr(cfg, k, v)
        cfg.save()

    def start(self, products, garments=None):
        return self.post("mirror:api_photoreal_create", {
            "person": _uri(_img_bytes()), "products": [p.id for p in products],
            "garments": garments or {},
        })

    def test_disabled_returns_503(self):
        self.assertFalse(self.client.get(reverse("mirror:api_catalog")).json()["ai"]["enabled"])
        self.assertEqual(self.start([self.top]).status_code, 503)

    def test_http_provider_chains_garments_in_order(self):
        self.configure(provider="http", endpoint="https://gpu.local/tryon", api_key="k")
        calls = []

        def fake_http(method, url, headers=None, body=None, timeout=60):
            calls.append((url, body["category"], headers))
            return json.dumps({"image": _uri(_img_bytes("PNG"), "image/png")}).encode()

        with mock.patch.object(vton, "_http", side_effect=fake_http):
            r = self.start([self.pants, self.top], garments={str(self.top.id): _uri(_img_bytes())})
        self.assertEqual(r.status_code, 202, r.content)
        data = r.json()
        self.assertEqual(data["status"], "done", data)
        self.assertTrue(data["result"].endswith(".jpg"))
        self.assertEqual([c[1] for c in calls], ["ichki", "past"])  # avval yuqori, keyin past
        self.assertEqual(calls[0][2]["Authorization"], "Bearer k")
        status = self.client.get(reverse("mirror:api_photoreal_status", args=[data["id"]])).json()
        self.assertEqual(status["status"], "done")

        # Obraz AI natijasi bilan saqlanadi.
        look = self.post("mirror:api_look_create", {"products": [self.top.id], "photoreal": data["id"]}).json()
        self.assertTrue(Look.objects.get(token=look["token"]).snapshot.name.endswith(".jpg"))

    def test_fashn_provider_polls_until_completed(self):
        self.configure(provider="fashn", api_key="fa-key")
        seq = iter([{"status": "processing"}, {"status": "completed", "output": ["https://cdn.fashn.ai/out.png"]}])
        bodies = []

        def fake_http(method, url, headers=None, body=None, timeout=60):
            if url.endswith("/run"):
                bodies.append(body)
                return b'{"id": "job1", "error": null}'
            if "/status/job1" in url:
                return json.dumps(next(seq)).encode()
            if url == "https://cdn.fashn.ai/out.png":
                return _img_bytes("PNG")
            raise AssertionError(url)

        with mock.patch.object(vton, "_http", side_effect=fake_http):
            data = self.start([self.pants]).json()
        self.assertEqual(data["status"], "done", data)
        self.assertEqual(bodies[0]["model_name"], "tryon-v1.6")
        self.assertEqual(bodies[0]["inputs"]["category"], "bottoms")
        self.assertTrue(bodies[0]["inputs"]["garment_image"].startswith("data:image/"))

    def test_replicate_provider(self):
        self.configure(provider="replicate", api_key="r8")
        seen = []

        def fake_http(method, url, headers=None, body=None, timeout=60):
            seen.append((method, url))
            if url.endswith("/models/cuuupid/idm-vton"):
                return b'{"latest_version": {"id": "v123"}}'
            if url.endswith("/predictions"):
                self.assertEqual(body["version"], "v123")
                self.assertEqual(body["input"]["category"], "lower_body")
                return b'{"status": "starting", "urls": {"get": "https://api.replicate.com/v1/predictions/p1"}}'
            if url.endswith("/predictions/p1"):
                return b'{"status": "succeeded", "output": "https://replicate.delivery/x.jpg"}'
            if url == "https://replicate.delivery/x.jpg":
                return _img_bytes()
            raise AssertionError(url)

        with mock.patch.object(vton, "_http", side_effect=fake_http):
            data = self.start([self.pants]).json()
        self.assertEqual(data["status"], "done", data)

    def test_provider_error_is_reported(self):
        self.configure(provider="fashn", api_key="bad")
        with mock.patch.object(vton, "_http", side_effect=vton.VtonError("AI xizmati kalitni qabul qilmadi")):
            data = self.start([self.pants]).json()
        self.assertEqual(data["status"], "failed")
        self.assertIn("kalit", data["error"])

    def test_product_without_image_fails_clearly(self):
        self.configure(provider="http", endpoint="https://gpu.local/tryon")
        with mock.patch.object(vton, "_http") as http:
            data = self.start([self.top]).json()  # garments berilmagan
        self.assertEqual(data["status"], "failed")
        self.assertIn("rasm yuklanmagan", data["error"])
        http.assert_not_called()

    def test_one_running_job_per_session(self):
        self.configure(provider="http", endpoint="https://gpu.local/tryon")
        sid = self.post("mirror:api_session_start", {}).json()["session"]
        PhotorealJob.objects.create(session_id=sid, provider="http", status="running", person_image="x.jpg")
        r = self.post("mirror:api_photoreal_create", {"session": sid, "person": _uri(_img_bytes()), "products": [self.pants.id]})
        self.assertEqual(r.status_code, 409)



# ---------------- Tanaga joylash (placement) ----------------
from django.core.exceptions import ValidationError as DjangoValidationError

from .models import normalize_placement


class PlacementTests(BaseCase):
    def test_normalize(self):
        self.assertIsNone(normalize_placement(None))
        self.assertIsNone(normalize_placement({}))
        self.assertEqual(normalize_placement({"x": 1.234, "y": 2, "w": 50, "h": 60}),
                         {"x": 1.23, "y": 2.0, "w": 50.0, "h": 60.0, "r": 0.0})
        for bad in ({"x": 1, "y": 2, "w": 3, "h": 60},        # juda kichik
                    {"x": "a", "y": 2, "w": 50, "h": 60},      # son emas
                    {"x": 1, "y": 2, "w": 50, "h": 60, "r": 90},
                    [1, 2, 3]):
            with self.assertRaises(ValueError):
                normalize_placement(bad)

    def test_model_clean(self):
        self.p.placement = {"x": 1, "y": 2, "w": 50}
        with self.assertRaises(DjangoValidationError):
            self.p.full_clean()

    def test_catalog_returns_placement(self):
        self.p.placement = {"x": 20, "y": 30, "w": 160, "h": 280, "r": 2}
        self.p.save()
        prod = self.client.get(reverse("mirror:api_catalog")).json()["products"][0]
        self.assertEqual(prod["placement"], {"x": 20, "y": 30, "w": 160, "h": 280, "r": 2})

    def test_admin_shows_error_for_bad_placement(self):
        admin = get_user_model().objects.create_superuser("admin", "a@a.uz", "pass12345")
        self.client.force_login(admin)
        data = {
            "name": "X", "kind": "bluzka", "style": "klassik", "color": self.color.pk, "price": 1,
            "description": "", "sort_order": 0, "placement": '{"x": 0, "y": 0, "w": 1, "h": 1}',
            "sizes-TOTAL_FORMS": 0, "sizes-INITIAL_FORMS": 0, "sizes-MIN_NUM_FORMS": 0, "sizes-MAX_NUM_FORMS": 6,
        }
        r = self.client.post("/admin/mirror/product/add/", data)
        self.assertEqual(r.status_code, 200)
        self.assertContains(r, "Kiyim joylashuvi")
        self.assertFalse(Product.objects.filter(name="X").exists())

    def test_legacy_fit_migration_math(self):
        import importlib
        mig = importlib.import_module("mirror.migrations.0003_placement")
        # Rasm yo'q (avtomatik tasvir): ilgari butun ramka 1.1 marta kattalashtirilgan edi;
        # endi tasvir ko'ylak chegarasigacha qirqilgan (26, 26, 148, 288).
        self.assertEqual(mig.legacy_box("koylak", None, 1.1, 0, 0),
                         {"x": 18.6, "y": 28.0, "w": 162.8, "h": 316.8, "r": 0.0})
        # Shim rasmi 100x200: qutiga 100 kenglikda, y=148 dan.
        self.assertEqual(mig.legacy_box("shim", (100, 200), 1.0, 5, -4),
                         {"x": 55.0, "y": 144.0, "w": 100.0, "h": 200.0, "r": 0.0})


# ---------------- Admin: rasmni oldindan qayta ishlash ----------------

class TryonPreviewTests(BaseCase):
    def setUp(self):
        super().setUp()
        self.admin = get_user_model().objects.create_superuser("admin", "a@a.uz", "pass12345")
        self.url = reverse("mirror:tryon_preview")

    def test_requires_staff(self):
        r = self.client.post(self.url, {"photo": SimpleUploadedFile("k.png", jpeg_on_white())})
        self.assertEqual(r.status_code, 302)

    def test_preview_matches_saved_result(self):
        self.client.force_login(self.admin)
        raw = jpeg_on_white()
        r = self.client.post(self.url, {"photo": SimpleUploadedFile("k.png", raw), "remove_background": "1"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r["Content-Type"], "image/png")
        preview = Image.open(io.BytesIO(r.content))
        self.assertEqual(preview.mode, "RGBA")
        # Fon olib tashlanib, kiyim chegarasigacha qirqilgan (300x300 dan kichik, burchak deyarli shaffof).
        self.assertLess(preview.width, 300)
        self.assertLess(preview.getpixel((0, 0))[3], 64)

        # Saqlangandagi natija aynan shu bo'lishi kerak (muharrirdagi joy mos kelsin).
        self.p.photo = SimpleUploadedFile("k.png", raw)
        self.p.save()
        self.p.refresh_from_db()
        saved = Image.open(self.p.tryon_image.path)
        self.assertEqual(saved.size, preview.size)
        self.assertEqual(saved.tobytes(), preview.tobytes())
        self.assertEqual(Product.objects.count(), 1)  # oldindan ko'rish hech narsa saqlamaydi

    def test_without_background_removal(self):
        self.client.force_login(self.admin)
        r = self.client.post(self.url, {"photo": SimpleUploadedFile("k.png", jpeg_on_white()), "remove_background": "0"})
        im = Image.open(io.BytesIO(r.content))
        self.assertEqual(im.getpixel((0, 0))[3], 255)  # fon qoldi
        self.assertEqual(im.size, (300, 300))

    def test_existing_product_photo(self):
        self.client.force_login(self.admin)
        self.p.photo = SimpleUploadedFile("k.png", jpeg_on_white())
        self.p.save()
        r = self.client.post(self.url, {"product": self.p.pk, "remove_background": "0"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(Image.open(io.BytesIO(r.content)).size, (300, 300))

    def test_bad_input(self):
        self.client.force_login(self.admin)
        r = self.client.post(self.url, {"photo": SimpleUploadedFile("x.png", b"not an image")})
        self.assertEqual(r.status_code, 400)
        self.assertIn("o'qilmadi", r.json()["error"])
        self.assertEqual(self.client.post(self.url, {"product": self.p.pk}).status_code, 400)  # rasmi yo'q



# ---------------- Boshqaruv paneli (/panel/) ----------------

class PanelTests(BaseCase):
    def setUp(self):
        super().setUp()
        User = get_user_model()
        self.admin = User.objects.create_superuser("boss", "b@b.uz", "pass12345")
        self.staff = User.objects.create_user("kons", password="pass12345", is_staff=True)
        self.customer = User.objects.create_user("mijoz", password="pass12345")

    def test_login_flow_and_access(self):
        r = self.client.get("/panel/")
        self.assertRedirects(r, "/panel/login/?next=/panel/")
        # Xodim bo'lmagan foydalanuvchi kira olmaydi.
        r = self.client.post("/panel/login/", {"username": "mijoz", "password": "pass12345"})
        self.assertContains(r, "kirish huquqi yo")
        r = self.client.post("/panel/login/", {"username": "kons", "password": "pass12345"})
        self.assertRedirects(r, "/panel/")
        # Konsultant: oddiy bo'limlar ochiladi, administrator bo'limlari yo'q.
        for url in ("/panel/", "/panel/products/", "/panel/products/new/", f"/panel/products/{self.p.pk}/",
                    "/panel/stock/", "/panel/orders/", "/panel/stats/", "/panel/colors/", "/panel/devices/",
                    "/panel/devices/new/", "/panel/looks/", "/panel/sessions/"):
            self.assertEqual(self.client.get(url).status_code, 200, url)
        for url in ("/panel/users/", "/panel/ai/", "/panel/users/new/"):
            self.assertEqual(self.client.get(url).status_code, 403, url)
        self.client.post("/panel/logout/")
        self.assertEqual(self.client.get("/panel/").status_code, 302)

    def test_dashboard_with_data(self):
        self.client.force_login(self.admin)
        sid = self.post("mirror:api_session_start", {"device": "test"}).json()["session"]
        self.post("mirror:api_session_try", {"product": self.p.id}, session_id=sid)
        self.post("mirror:api_order_create", {"session": sid, "items": [{"product": self.p.id, "size": "M"}]})
        Order.objects.update(status="sold")
        r = self.client.get("/panel/")
        self.assertContains(r, "500 000 so&#x27;m")       # bugungi sotuv
        self.assertContains(r, 'id="revenue-data"')
        self.assertContains(r, "Ko&#x27;ylak")             # eng ko'p sinab ko'rilgan
        series = r.context["revenue_daily"]
        self.assertEqual(len(series), 14)
        self.assertEqual(series[-1]["value"], 500000)
        self.assertEqual(r.context["tries_daily"][-1]["value"], 1)

    def _product_post(self, **over):
        data = {
            "name": "Panel bluzka", "kind": "bluzka", "style": "klassik", "color": self.color.pk, "price": 150000,
            "description": "", "is_active": "on", "sort_order": 0, "remove_background": "on",
            "placement": '{"x": 30, "y": 24, "w": 140, "h": 150, "r": 0}',
            "sizes-TOTAL_FORMS": 6, "sizes-INITIAL_FORMS": 0, "sizes-MIN_NUM_FORMS": 0, "sizes-MAX_NUM_FORMS": 6,
        }
        for i, s in enumerate(["XS", "S", "M", "L", "XL", "XXL"]):
            data[f"sizes-{i}-size"] = s
            data[f"sizes-{i}-stock"] = {"M": 4, "L": 2}.get(s, 0)
        data.update(over)
        return self.client.post("/panel/products/new/", data)

    def test_product_create_edit_toggle_delete(self):
        self.client.force_login(self.staff)
        r = self._product_post()
        p = Product.objects.get(name="Panel bluzka")
        self.assertRedirects(r, f"/panel/products/{p.pk}/")
        self.assertEqual({s.size: s.stock for s in p.sizes.all()}, {"M": 4, "L": 2})
        self.assertEqual(p.placement["w"], 140.0)

        # Tahrirlash sahifasi: mavjud o'lchamlar + yetishmayotganlari uchun bo'sh qatorlar.
        r = self.client.get(f"/panel/products/{p.pk}/")
        self.assertEqual(len(r.context["formset"].forms), 6)
        self.assertContains(r, 'class="sm-place"')

        self.client.post(f"/panel/products/{p.pk}/toggle/")
        p.refresh_from_db()
        self.assertFalse(p.is_active)

        r = self.client.get("/panel/products/?status=hidden&q=Panel")
        self.assertContains(r, "Panel bluzka")
        self.client.post(f"/panel/products/{p.pk}/delete/")
        self.assertFalse(Product.objects.filter(pk=p.pk).exists())

    def test_product_validation_errors(self):
        self.client.force_login(self.staff)
        r = self._product_post(name="", placement='{"x": 0, "y": 0, "w": 1, "h": 1}')
        self.assertEqual(r.status_code, 200)
        self.assertContains(r, "Kiyim joylashuvi")
        self.assertFalse(Product.objects.filter(name="").exists())
        r = self._product_post(**{"sizes-1-size": "M"})  # M ikki marta
        self.assertContains(r, "takroriy")
        self.assertContains(r, '<b>M</b>', count=2)  # yorliq yuborilgan qiymatni ko'rsatadi

    def test_delete_protected_product_hides_it(self):
        self.client.force_login(self.staff)
        self.post("mirror:api_order_create", {"items": [{"product": self.p.id, "size": "M"}]})
        r = self.client.post(f"/panel/products/{self.p.pk}/delete/", follow=True)
        self.assertContains(r, "buyurtmalarda bor")
        self.p.refresh_from_db()
        self.assertFalse(self.p.is_active)

    def test_stock_matrix(self):
        self.client.force_login(self.staff)
        r = self.client.get("/panel/stock/")
        self.assertContains(r, f'name="s-{self.p.pk}-M" value="1"')
        r = self.client.post("/panel/stock/", {f"s-{self.p.pk}-M": "7", f"s-{self.p.pk}-S": "",
                                                f"s-{self.p.pk}-L": "3", f"s-{self.p.pk}-XL": "abc"}, follow=True)
        sizes = {s.size: s.stock for s in self.p.sizes.all()}
        self.assertEqual(sizes, {"M": 7, "L": 3})   # S olib tashlandi, L qo'shildi, XL noto'g'ri — o'zgarmadi
        self.assertContains(r, "butun son kiriting")
        self.assertContains(r, "3 ta o&#x27;zgarish")

    def test_order_detail_status_and_note(self):
        self.client.force_login(self.staff)
        self.post("mirror:api_order_create", {"items": [{"product": self.p.id, "size": "M"}]})
        o = Order.objects.get()
        self.client.post(f"/panel/orders/{o.pk}/", {"status": "cancelled"})
        o.refresh_from_db()
        self.assertEqual(o.status, "cancelled")
        self.assertEqual(ProductSize.objects.get(product=self.p, size="M").stock, 1)  # omborga qaytdi
        self.client.post(f"/panel/orders/{o.pk}/", {"note": "Qo'ng'iroq qilindi"})
        o.refresh_from_db()
        self.assertEqual(o.note, "Qo'ng'iroq qilindi")
        r = self.client.get("/panel/orders/?status=cancelled")
        self.assertContains(r, f"#{o.number}")

    def test_colors_and_devices(self):
        self.client.force_login(self.staff)
        self.client.post("/panel/colors/", {"name": "Moviy", "hex": "#2244aa", "sort_order": 3})
        self.assertTrue(Color.objects.filter(name="Moviy").exists())
        r = self.client.post("/panel/colors/", {"delete": self.color.pk}, follow=True)
        self.assertContains(r, "rangida kiyimlar bor")  # kiyimi bor rang o'chmaydi
        self.client.post("/panel/devices/new/", {"name": "Ikkinchi", "slug": "ikkinchi", "location": "",
                                                 "city": "toshkent", "idle_seconds": 60, "is_active": "on"})
        d = MirrorDevice.objects.get(slug="ikkinchi")
        self.client.post(f"/panel/devices/{d.pk}/", {"delete": "1"})
        self.assertFalse(MirrorDevice.objects.filter(slug="ikkinchi").exists())

    def test_ai_settings_and_users_superuser_only(self):
        self.client.force_login(self.admin)
        self.client.post("/panel/ai/", {"provider": "http", "api_key": "", "model": "",
                                        "endpoint": "https://gpu.local/tryon", "timeout": 120})
        self.assertTrue(AISettings.load().enabled)
        r = self.client.post("/panel/users/new/", {"username": "yangi", "password": "Kuchli-parol-2026",
                                                   "first_name": "Dilnoza", "last_name": ""})
        self.assertRedirects(r, "/panel/users/")
        u = get_user_model().objects.get(username="yangi")
        self.assertTrue(u.is_staff and not u.is_superuser and u.check_password("Kuchli-parol-2026"))
        # Zaif parol rad etiladi.
        r = self.client.post("/panel/users/new/", {"username": "zaif", "password": "123", "first_name": ""})
        self.assertEqual(r.status_code, 200)
        # Administrator o'zini o'chira olmaydi.
        r = self.client.post(f"/panel/users/{self.admin.pk}/", {"first_name": "", "last_name": "",
                                                                "is_superuser": "on"})
        self.assertContains(r, "O&#x27;zingizni o&#x27;chira olmaysiz")
        # Parolni almashtirish.
        self.client.post(f"/panel/users/{u.pk}/", {"first_name": "Dilnoza", "last_name": "", "is_active": "on",
                                                   "new_password": "Yana-kuchli-2027"})
        u.refresh_from_db()
        self.assertTrue(u.check_password("Yana-kuchli-2027"))

    def test_looks_and_sessions_pages(self):
        self.client.force_login(self.staff)
        look = Look.objects.create()
        look.products.set([self.p])
        self.assertContains(self.client.get("/panel/looks/"), look.get_absolute_url())
        self.client.post("/panel/looks/", {"delete": look.pk})
        self.assertFalse(Look.objects.filter(pk=look.pk).exists())
        MirrorSession.objects.create(device=self.device)
        r = self.client.get("/panel/sessions/?device=test")
        self.assertEqual(len(r.context["page"].object_list), 1)

    def test_products_list_stock_not_multiplied_by_tryons(self):
        self.client.force_login(self.staff)
        ProductSize.objects.filter(product=self.p, size="S").update(stock=4)   # M=1, S=4 -> 5
        s = MirrorSession.objects.create()
        TryOn.objects.bulk_create([TryOn(session=s, product=self.p) for _ in range(3)])
        r = self.client.get("/panel/products/")
        item = r.context["page"].object_list[0]
        self.assertEqual((item.stock, item.tries), (5, 3))
        self.assertContains(r, "5 dona")
