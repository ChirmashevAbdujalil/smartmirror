"""Demo ma'lumotlar: ranglar, ko'zgu qurilmasi va kiyimlar.

    python manage.py seed_demo            # bo'sh bazaga
    python manage.py seed_demo --reset    # mavjud kiyimlarni o'chirib, qaytadan
"""
import io

from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand
from PIL import Image, ImageDraw, ImageFilter

from mirror.models import Color, MirrorDevice, Product, ProductSize

COLORS = [
    ("Pushti", "#e8a3b5", False), ("Qizil", "#c8324a", False), ("Qora", "#25232a", True),
    ("Oq", "#f2efe9", True), ("Bej", "#d8bfa2", True), ("Ko'k", "#3b5ea8", False),
    ("Havorang", "#8fb8de", False), ("Yashil", "#4f7d5c", False), ("Jigarrang", "#7a5236", False),
    ("Kulrang", "#8d8f96", True),
]

# (nomi, turi, uslub, rang, narx, {o'lcham: soni}, yangi)
PRODUCTS = [
    ("Ipak bluzka", "bluzka", "klassik", "Oq", 289000, {"XS": 2, "S": 4, "M": 5, "L": 3, "XL": 1}, False),
    ("Pushti bluzka", "bluzka", "kechki", "Pushti", 315000, {"S": 3, "M": 4, "L": 2}, True),
    ("Paxta futbolka", "futbolka", "kundalik", "Qora", 129000, {"XS": 5, "S": 8, "M": 8, "L": 6, "XL": 4}, False),
    ("Sport futbolka", "futbolka", "sport", "Havorang", 149000, {"S": 5, "M": 6, "L": 5, "XL": 2}, False),
    ("Bej pidjak", "pidjak", "klassik", "Bej", 690000, {"XS": 1, "S": 2, "M": 3, "L": 2, "XL": 1}, False),
    ("Pushti pidjak", "pidjak", "klassik", "Pushti", 720000, {"S": 2, "M": 2, "L": 1}, True),
    ("Qora pidjak", "pidjak", "kechki", "Qora", 750000, {"XS": 1, "S": 3, "M": 3, "L": 3, "XL": 2}, False),
    ("Kuzgi kurtka", "kurtka", "kundalik", "Jigarrang", 890000, {"S": 2, "M": 4, "L": 3, "XL": 2}, True),
    ("Issiq kurtka", "kurtka", "sport", "Yashil", 940000, {"S": 2, "M": 3, "L": 3, "XL": 1}, False),
    ("Klassik shim", "shim", "klassik", "Bej", 359000, {"XS": 2, "S": 4, "M": 4, "L": 3, "XL": 2}, False),
    ("Jinsi shim", "shim", "kundalik", "Ko'k", 399000, {"XS": 3, "S": 6, "M": 6, "L": 5, "XL": 3}, False),
    ("Qora shim", "shim", "kechki", "Qora", 379000, {"S": 3, "M": 4, "L": 3, "XL": 1}, False),
    ("Plisse yubka", "yubka", "kechki", "Pushti", 330000, {"S": 3, "M": 3, "L": 2}, False),
    ("Kulrang yubka", "yubka", "klassik", "Kulrang", 299000, {"XS": 2, "S": 3, "M": 3, "L": 2, "XL": 1}, False),
    ("Qizil kechki ko'ylak", "koylak", "kechki", "Qizil", 1150000, {"S": 2, "M": 2, "L": 1}, True),
    ("Yozgi ko'ylak", "koylak", "kundalik", "Havorang", 460000, {"XS": 2, "S": 3, "M": 4, "L": 2, "XL": 1}, False),
]


def demo_photo(hex_color):
    """Oq fonda futbolka 'surati' — fonni avtomatik olib tashlashni namoyish qilish uchun."""
    im = Image.new("RGB", (600, 640), (246, 246, 244))
    d = ImageDraw.Draw(im)
    body = [(220, 80), (300, 130), (380, 80), (470, 110), (560, 230), (480, 280), (450, 240),
            (450, 600), (150, 600), (150, 240), (120, 280), (40, 230), (130, 110)]
    shadow = Image.new("L", im.size, 0)
    ImageDraw.Draw(shadow).polygon([(x + 8, y + 10) for x, y in body], fill=60)
    im.paste((215, 215, 212), mask=shadow.filter(ImageFilter.GaussianBlur(8)))
    rgb = tuple(int(hex_color[i:i + 2], 16) for i in (1, 3, 5))
    d.polygon(body, fill=rgb, outline=tuple(max(0, c - 40) for c in rgb), width=4)
    d.arc((220, 40, 380, 170), 20, 160, fill=tuple(max(0, c - 50) for c in rgb), width=8)
    d.text((270, 330), "SMART", fill=(255, 255, 255))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=92)
    return ContentFile(buf.getvalue())


class Command(BaseCommand):
    help = "Demo ma'lumotlarni yaratadi (ranglar, ko'zgu, kiyimlar)."

    def add_arguments(self, parser):
        parser.add_argument("--reset", action="store_true", help="Mavjud kiyimlarni o'chirib, qaytadan yaratish")
        parser.add_argument("--activity", action="store_true",
                            help="Oxirgi 14 kunlik demo faollik (tashriflar, sinab ko'rishlar, buyurtmalar) — "
                                 "boshqaruv paneli grafiklarini ko'rish uchun")

    def handle(self, *args, reset=False, activity=False, **opts):
        colors = {}
        for i, (name, hex_, neutral) in enumerate(COLORS):
            colors[name], _ = Color.objects.get_or_create(
                name=name, defaults={"hex": hex_, "is_neutral": neutral, "sort_order": i})

        device, created = MirrorDevice.objects.get_or_create(
            slug="asosiy", defaults={"name": "Asosiy ko'zgu", "location": "Kirish yonida"})
        if created:
            self.stdout.write(f"Ko'zgu qurilmasi yaratildi: /mirror/{device.slug}/")

        if reset:
            Product.objects.filter(orderitem__isnull=True).delete()
        if Product.objects.exists():
            self.stdout.write("Kiyimlar allaqachon bor (qaytadan yaratish uchun --reset).")
        else:
            self.create_products(colors)
        if activity:
            self.create_activity(device)

    def create_products(self, colors):

        for i, (name, kind, style, color, price, sizes, is_new) in enumerate(PRODUCTS):
            p = Product(name=name, kind=kind, style=style, color=colors[color], price=price,
                        is_new=is_new, sort_order=i)
            if name == "Sport futbolka":
                p.photo.save("demo-futbolka.jpg", demo_photo(colors[color].hex), save=False)
            p.save()
            ProductSize.objects.bulk_create([ProductSize(product=p, size=s, stock=n) for s, n in sizes.items()])
        self.stdout.write(self.style.SUCCESS(f"{len(PRODUCTS)} ta kiyim yaratildi."))

    def create_activity(self, device, days=14, seed=7):
        """Tasodifiy, lekin takrorlanuvchan demo faollik. Ombor o'zgarmaydi (faqat statistika uchun)."""
        import random
        from datetime import timedelta

        from django.utils import timezone

        from mirror.models import MirrorSession, Order, OrderItem, OrderStatus, TryOn

        rnd = random.Random(seed)
        products = list(Product.objects.filter(is_active=True))
        if not products:
            return
        weights = [rnd.uniform(0.3, 3) for _ in products]
        now = timezone.now()
        statuses = [OrderStatus.SOLD] * 6 + [OrderStatus.CANCELLED] * 2
        n_sessions = n_orders = 0
        for d in range(days, 0, -1):
            day = now - timedelta(days=d - 1)
            for _ in range(rnd.randint(4, 14) + (6 if day.weekday() >= 5 else 0)):
                start = day.replace(hour=rnd.randint(10, 20), minute=rnd.randint(0, 59))
                if start > now:
                    start = now - timedelta(minutes=rnd.randint(5, 60))
                tried = rnd.sample(products, k=min(len(products), rnd.randint(1, 5)))
                dur = timedelta(seconds=rnd.randint(50, 260))
                s = MirrorSession.objects.create(device=device, started_at=start, last_activity=start + dur,
                                                 ended_at=start + dur)
                n_sessions += 1
                TryOn.objects.bulk_create([
                    TryOn(session=s, product=p, created_at=start + timedelta(seconds=10 * i))
                    for i, p in enumerate(rnd.choices(products, weights=weights, k=len(tried)))
                ])
                if rnd.random() < 0.32:
                    o = Order.objects.create(number=f"{rnd.randint(1, 999):03d}", session=s, device=device,
                                             status=rnd.choice(statuses), created_at=start + dur)
                    for p in rnd.sample(tried, k=min(len(tried), rnd.randint(1, 2))):
                        size = p.sizes.order_by("?").values_list("size", flat=True).first() or "M"
                        OrderItem.objects.create(order=o, product=p, size=size, price=p.price)
                    n_orders += 1
        self.stdout.write(self.style.SUCCESS(f"Demo faollik: {n_sessions} ta tashrif, {n_orders} ta buyurtma."))
