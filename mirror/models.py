import secrets
import uuid

from django.core.validators import MaxValueValidator, MinValueValidator, RegexValidator
from django.db import models, transaction
from django.db.models import F
from django.urls import reverse
from django.utils import timezone


class Kind(models.TextChoices):
    BLUZKA = "bluzka", "Bluzka"
    FUTBOLKA = "futbolka", "Futbolka"
    PIDJAK = "pidjak", "Pidjak"
    KURTKA = "kurtka", "Kurtka"
    SHIM = "shim", "Shim"
    YUBKA = "yubka", "Yubka"
    KOYLAK = "koylak", "Ko'ylak"


# Kiyim qaysi "qatlam"ga kiyiladi: bir qatlamda bitta kiyim bo'ladi.
SLOTS = {
    "bluzka": "ichki", "futbolka": "ichki",
    "pidjak": "ustki", "kurtka": "ustki",
    "shim": "past", "yubka": "past",
    "koylak": "toliq",
}


class Style(models.TextChoices):
    KLASSIK = "klassik", "Klassik"
    KUNDALIK = "kundalik", "Kundalik"
    KECHKI = "kechki", "Kechki"
    SPORT = "sport", "Sport"


class Size(models.TextChoices):
    XS = "XS", "XS"
    S = "S", "S"
    M = "M", "M"
    L = "L", "L"
    XL = "XL", "XL"
    XXL = "XXL", "XXL"


SIZE_ORDER = [s.value for s in Size]


class City(models.TextChoices):
    TOSHKENT = "toshkent", "Toshkent"
    SAMARQAND = "samarqand", "Samarqand"
    BUXORO = "buxoro", "Buxoro"
    ANDIJON = "andijon", "Andijon"
    NAMANGAN = "namangan", "Namangan"
    FARGONA = "fargona", "Farg'ona"
    NUKUS = "nukus", "Nukus"
    QARSHI = "qarshi", "Qarshi"
    TERMIZ = "termiz", "Termiz"
    URGANCH = "urganch", "Urganch"
    JIZZAX = "jizzax", "Jizzax"
    NAVOIY = "navoiy", "Navoiy"
    GULISTON = "guliston", "Guliston"


class Color(models.Model):
    name = models.CharField("nomi", max_length=40, unique=True)
    hex = models.CharField(
        "rang kodi", max_length=7, default="#cccccc",
        validators=[RegexValidator(r"^#[0-9a-fA-F]{6}$", "Format: #RRGGBB")],
    )
    is_neutral = models.BooleanField(
        "neytral rang", default=False,
        help_text="Qora, oq, bej, kulrang kabi — hamma rang bilan mos keladi (tavsiyalar uchun).",
    )
    sort_order = models.PositiveSmallIntegerField("tartib", default=0)

    class Meta:
        ordering = ["sort_order", "name"]
        verbose_name = "rang"
        verbose_name_plural = "ranglar"

    def __str__(self):
        return self.name


class Product(models.Model):
    name = models.CharField("nomi", max_length=80)
    kind = models.CharField("turi", max_length=20, choices=Kind.choices)
    style = models.CharField("uslub", max_length=20, choices=Style.choices, default=Style.KUNDALIK)
    color = models.ForeignKey(Color, verbose_name="rang", on_delete=models.PROTECT, related_name="products")
    price = models.PositiveIntegerField("narx (so'm)")
    description = models.TextField("tavsif", blank=True)
    photo = models.ImageField(
        "rasm", upload_to="products/original/", blank=True,
        help_text="Kiyimning old tomondan tushirilgan rasmi. Oq yoki bir xil rangli fonda bo'lsa, "
                  "fon avtomatik olib tashlanadi. Shaffof PNG ham bo'ladi. Rasm bo'lmasa — avtomatik tasvir chiziladi.",
    )
    remove_background = models.BooleanField("fonni avtomatik olib tashlash", default=True)
    tryon_image = models.ImageField("kiyib ko'rish tasviri", upload_to="products/tryon/", blank=True, editable=False)
    processed_from = models.CharField(max_length=300, blank=True, editable=False)
    fit_scale = models.FloatField(
        "o'lcham koeffitsienti", default=1.0,
        validators=[MinValueValidator(0.5), MaxValueValidator(1.8)],
        help_text="Tanaga nisbatan kattalik (1.0 — standart).",
    )
    fit_offset_x = models.FloatField("gorizontal siljish", default=0, validators=[MinValueValidator(-60), MaxValueValidator(60)])
    fit_offset_y = models.FloatField("vertikal siljish", default=0, validators=[MinValueValidator(-80), MaxValueValidator(80)])
    is_active = models.BooleanField("ko'zguda ko'rsatish", default=True)
    is_new = models.BooleanField("yangi kolleksiya", default=False)
    sort_order = models.PositiveIntegerField("tartib", default=0)
    created_at = models.DateTimeField("qo'shilgan", auto_now_add=True)
    updated_at = models.DateTimeField("yangilangan", auto_now=True)

    class Meta:
        ordering = ["sort_order", "-created_at"]
        verbose_name = "kiyim"
        verbose_name_plural = "kiyimlar"

    def __str__(self):
        return self.name

    @property
    def slot(self):
        return SLOTS[self.kind]

    @property
    def total_stock(self):
        return sum(s.stock for s in self.sizes.all())

    def _processing_key(self):
        return f"{self.photo.name}|{int(self.remove_background)}" if self.photo else ""

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        key = self._processing_key()
        if key == self.processed_from:
            return
        from .imaging import make_tryon_image  # Pillow faqat kerak bo'lganda

        if self.tryon_image:
            self.tryon_image.delete(save=False)
        if self.photo:
            self.photo.open("rb")
            try:
                content = make_tryon_image(self.photo, remove_bg=self.remove_background)
            finally:
                self.photo.close()
            self.tryon_image.save(f"p{self.pk}-{secrets.token_hex(4)}.png", content, save=False)
        else:
            self.tryon_image = ""
        self.processed_from = key
        super().save(update_fields=["tryon_image", "processed_from"])


class ProductSize(models.Model):
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="sizes")
    size = models.CharField("o'lcham", max_length=4, choices=Size.choices)
    stock = models.PositiveIntegerField("omborda (dona)", default=0)

    class Meta:
        unique_together = [("product", "size")]
        verbose_name = "o'lcham"
        verbose_name_plural = "o'lchamlar va ombor"

    def __str__(self):
        return f"{self.product} — {self.size}"


class MirrorDevice(models.Model):
    name = models.CharField("nomi", max_length=80)
    slug = models.SlugField("manzil (slug)", unique=True, help_text="Ko'zgu sahifasi: /mirror/<slug>/")
    location = models.CharField("joylashuvi", max_length=120, blank=True)
    city = models.CharField("shahar (ob-havo)", max_length=20, choices=City.choices, default=City.TOSHKENT)
    idle_seconds = models.PositiveIntegerField(
        "kutish rejimi (soniya)", default=90, validators=[MinValueValidator(20), MaxValueValidator(900)]
    )
    is_active = models.BooleanField("faol", default=True)

    class Meta:
        verbose_name = "ko'zgu qurilmasi"
        verbose_name_plural = "ko'zgu qurilmalari"

    def __str__(self):
        return self.name

    def get_absolute_url(self):
        return reverse("mirror:kiosk", args=[self.slug])


class MirrorSession(models.Model):
    """Bitta xaridorning ko'zgu oldidagi tashrifi."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    device = models.ForeignKey(MirrorDevice, verbose_name="ko'zgu", null=True, blank=True, on_delete=models.SET_NULL)
    started_at = models.DateTimeField("boshlandi", default=timezone.now)
    last_activity = models.DateTimeField("oxirgi faollik", default=timezone.now)
    ended_at = models.DateTimeField("tugadi", null=True, blank=True)

    class Meta:
        ordering = ["-started_at"]
        verbose_name = "sessiya"
        verbose_name_plural = "sessiyalar"

    def __str__(self):
        return f"{self.started_at:%d.%m %H:%M} ({self.device or '—'})"

    @property
    def duration_seconds(self):
        end = self.ended_at or self.last_activity
        return max(0, int((end - self.started_at).total_seconds()))


class TryOn(models.Model):
    session = models.ForeignKey(MirrorSession, on_delete=models.CASCADE, related_name="tryons")
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="tryons")
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "sinab ko'rish"
        verbose_name_plural = "sinab ko'rishlar"


def _look_token():
    return secrets.token_urlsafe(9)


class Look(models.Model):
    """Saqlangan obraz: xaridor QR orqali telefoniga oladi."""
    token = models.CharField(max_length=20, unique=True, default=_look_token, editable=False)
    session = models.ForeignKey(MirrorSession, null=True, blank=True, on_delete=models.SET_NULL, related_name="looks")
    products = models.ManyToManyField(Product, verbose_name="kiyimlar", related_name="looks")
    snapshot = models.ImageField("surat", upload_to="looks/", blank=True)
    created_at = models.DateTimeField("yaratilgan", default=timezone.now)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "obraz"
        verbose_name_plural = "saqlangan obrazlar"

    def __str__(self):
        return f"Obraz {self.token}"

    def get_absolute_url(self):
        return reverse("mirror:look", args=[self.token])


class OrderStatus(models.TextChoices):
    NEW = "new", "Yangi"
    PREPARING = "preparing", "Tayyorlanmoqda"
    FITTING = "fitting", "Kiyinish xonasida"
    SOLD = "sold", "Sotildi"
    CANCELLED = "cancelled", "Bekor qilindi"


class Order(models.Model):
    """Ko'zgudan berilgan buyurtma: konsultant kiyimni tanlangan o'lchamda olib keladi.

    Buyurtma yaratilganda ombordan zaxiralanadi, bekor qilinsa qaytariladi.
    """
    number = models.CharField("raqam", max_length=8, editable=False)
    session = models.ForeignKey(MirrorSession, null=True, blank=True, on_delete=models.SET_NULL, related_name="orders")
    device = models.ForeignKey(MirrorDevice, verbose_name="ko'zgu", null=True, blank=True, on_delete=models.SET_NULL)
    status = models.CharField("holati", max_length=12, choices=OrderStatus.choices, default=OrderStatus.NEW)
    customer_name = models.CharField("mijoz ismi", max_length=60, blank=True)
    phone = models.CharField("telefon", max_length=20, blank=True)
    note = models.CharField("izoh", max_length=200, blank=True)
    created_at = models.DateTimeField("yaratilgan", default=timezone.now)
    updated_at = models.DateTimeField("yangilangan", auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "buyurtma"
        verbose_name_plural = "buyurtmalar"

    def __str__(self):
        return f"#{self.number}"

    @property
    def total(self):
        return sum(i.price * i.quantity for i in self.items.all())

    @staticmethod
    def next_number():
        today = timezone.localdate()
        count = Order.objects.filter(created_at__date=today).count()
        return f"{count + 1:03d}"

    def _adjust_stock(self, sign):
        for item in self.items.all():
            qs = ProductSize.objects.filter(product_id=item.product_id, size=item.size)
            if sign > 0:
                qs.update(stock=F("stock") + item.quantity)
            else:
                qs.filter(stock__gte=item.quantity).update(stock=F("stock") - item.quantity)

    @transaction.atomic
    def set_status(self, status):
        """Holatni o'zgartiradi va ombor zaxirasini moslaydi."""
        old = Order.objects.select_for_update().get(pk=self.pk).status if self.pk else None
        if old == status:
            return
        if status == OrderStatus.CANCELLED and old != OrderStatus.CANCELLED:
            self._adjust_stock(+1)
        elif old == OrderStatus.CANCELLED and status != OrderStatus.CANCELLED:
            self._adjust_stock(-1)
        self.status = status
        self.save(update_fields=["status", "updated_at"])


class OrderItem(models.Model):
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey(Product, verbose_name="kiyim", on_delete=models.PROTECT)
    size = models.CharField("o'lcham", max_length=4, choices=Size.choices)
    quantity = models.PositiveSmallIntegerField("soni", default=1)
    price = models.PositiveIntegerField("narx (so'm)")

    class Meta:
        verbose_name = "buyurtma qatori"
        verbose_name_plural = "buyurtma qatorlari"

    def __str__(self):
        return f"{self.product} ({self.size})"
