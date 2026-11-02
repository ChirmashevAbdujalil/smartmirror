"""Ko'zgu (kiosk) uchun JSON API."""
import base64
import binascii
import io
import json
import re
from datetime import timedelta

import qrcode
import qrcode.image.svg
from django.core.files.base import ContentFile
from django.db import transaction
from django.db.models import Count, Q
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.http import require_GET, require_POST

from .models import (
    SIZE_ORDER, SLOTS, AISettings, Color, JobStatus, Kind, Look, MirrorDevice, MirrorSession, Order,
    OrderItem, PhotorealJob, Product, ProductSize, Size, Style, TryOn,
)

MAX_CART_ITEMS = 10
MAX_SNAPSHOT_BYTES = 6 * 1024 * 1024


class ApiError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def api_view(func):
    def wrapper(request, *args, **kwargs):
        try:
            return func(request, *args, **kwargs)
        except ApiError as e:
            return JsonResponse({"error": str(e)}, status=e.status)
    wrapper.__name__ = func.__name__
    return wrapper


def _body(request):
    try:
        data = json.loads(request.body or b"{}")
    except (ValueError, UnicodeDecodeError):
        raise ApiError("JSON formati noto'g'ri")
    if not isinstance(data, dict):
        raise ApiError("JSON obyekt kutilgan")
    return data


def _session(session_id):
    try:
        session = MirrorSession.objects.get(pk=session_id, ended_at__isnull=True)
    except (MirrorSession.DoesNotExist, ValueError, TypeError):
        raise ApiError("Sessiya topilmadi", 404)
    return session


def _touch(session):
    session.last_activity = timezone.now()
    session.save(update_fields=["last_activity"])


def product_json(p, popularity=0):
    sizes = {s.size: s.stock for s in p.sizes.all()}
    return {
        "id": p.id,
        "name": p.name,
        "kind": p.kind,
        "kindLabel": p.get_kind_display(),
        "slot": SLOTS[p.kind],
        "style": p.style,
        "styleLabel": p.get_style_display(),
        "color": {"id": p.color_id, "name": p.color.name, "hex": p.color.hex, "neutral": p.color.is_neutral},
        "price": p.price,
        "description": p.description,
        "sizes": {s: sizes[s] for s in SIZE_ORDER if s in sizes},
        "image": p.tryon_image.url if p.tryon_image else None,
        "fit": {"scale": p.fit_scale, "dx": p.fit_offset_x, "dy": p.fit_offset_y},
        "isNew": p.is_new,
        "popularity": popularity,
    }


@require_GET
@api_view
def catalog(request):
    since = timezone.now() - timedelta(days=30)
    products = (
        Product.objects.filter(is_active=True)
        .select_related("color")
        .prefetch_related("sizes")
        .annotate(pop=Count("tryons", filter=Q(tryons__created_at__gte=since)))
    )
    device = MirrorDevice.objects.filter(slug=request.GET.get("device"), is_active=True).first()
    return JsonResponse({
        "products": [product_json(p, p.pop) for p in products],
        "colors": [{"id": c.id, "name": c.name, "hex": c.hex, "neutral": c.is_neutral} for c in Color.objects.all()],
        "kinds": [{"id": k.value, "label": k.label, "slot": SLOTS[k.value]} for k in Kind],
        "styles": [{"id": s.value, "label": s.label} for s in Style],
        "sizes": SIZE_ORDER,
        "device": {
            "slug": device.slug, "name": device.name, "city": device.city, "idleSeconds": device.idle_seconds,
        } if device else None,
        "version": _catalog_version(),
        "ai": {"enabled": AISettings.load().enabled},
    })


def _catalog_version():
    """Katalog o'zgarganini aniqlash uchun (ko'zgu davriy tekshiradi)."""
    last = Product.objects.order_by("-updated_at").values_list("updated_at", flat=True).first()
    stock = ProductSize.objects.order_by().values_list("stock", flat=True)
    return f"{last.timestamp() if last else 0}-{Product.objects.count()}-{sum(stock)}"


@require_GET
def catalog_version(request):
    return JsonResponse({"version": _catalog_version()})


@require_POST
@api_view
def session_start(request):
    data = _body(request)
    device = MirrorDevice.objects.filter(slug=data.get("device")).first()
    session = MirrorSession.objects.create(device=device)
    return JsonResponse({"session": str(session.id)}, status=201)


@require_POST
@api_view
def session_try(request, session_id):
    session = _session(session_id)
    data = _body(request)
    product = Product.objects.filter(pk=data.get("product"), is_active=True).first()
    if not product:
        raise ApiError("Kiyim topilmadi", 404)
    TryOn.objects.create(session=session, product=product)
    _touch(session)
    return JsonResponse({"ok": True})


@require_POST
@api_view
def session_end(request, session_id):
    session = _session(session_id)
    session.ended_at = timezone.now()
    session.save(update_fields=["ended_at"])
    return JsonResponse({"ok": True, "duration": session.duration_seconds})


def _decode_snapshot(data_url):
    m = re.match(r"^data:image/(png|jpeg|webp);base64,(.+)$", data_url or "", re.S)
    if not m:
        raise ApiError("Surat formati noto'g'ri")
    try:
        raw = base64.b64decode(m.group(2), validate=True)
    except (binascii.Error, ValueError):
        raise ApiError("Surat formati noto'g'ri")
    if len(raw) > MAX_SNAPSHOT_BYTES:
        raise ApiError("Surat juda katta")
    from PIL import Image  # rasm haqiqatan ham rasm ekanini tekshirish
    try:
        Image.open(io.BytesIO(raw)).verify()
    except Exception:
        raise ApiError("Surat o'qilmadi")
    return m.group(1).replace("jpeg", "jpg"), raw


def qr_svg(url):
    img = qrcode.make(url, image_factory=qrcode.image.svg.SvgPathImage, box_size=10, border=2)
    return img.to_string(encoding="unicode")


@require_POST
@api_view
def look_create(request):
    data = _body(request)
    session = _session(data.get("session")) if data.get("session") else None
    ids = [int(i) for i in data.get("products", []) if str(i).isdigit()][:6]
    products = list(Product.objects.filter(pk__in=ids))
    if not products:
        raise ApiError("Obrazda kiyim yo'q")
    look = Look.objects.create(session=session)
    look.products.set(products)
    job = PhotorealJob.objects.filter(pk=data.get("photoreal"), status=JobStatus.DONE).first() \
        if _is_uuid(data.get("photoreal")) else None
    if job and job.result_image:
        # Fotorealistik AI natijasi bo'lsa — obraz surati sifatida o'shani saqlaymiz.
        job.result_image.open("rb")
        try:
            look.snapshot.save(f"{look.token}.jpg", ContentFile(job.result_image.read()), save=True)
        finally:
            job.result_image.close()
    elif data.get("snapshot"):
        ext, raw = _decode_snapshot(data["snapshot"])
        look.snapshot.save(f"{look.token}.{ext}", ContentFile(raw), save=True)
    if session:
        _touch(session)
    url = request.build_absolute_uri(look.get_absolute_url())
    return JsonResponse({"token": look.token, "url": url, "qr": qr_svg(url)}, status=201)


@require_POST
@api_view
def order_create(request):
    data = _body(request)
    items = data.get("items") or []
    if not isinstance(items, list) or not items:
        raise ApiError("Savat bo'sh")
    if len(items) > MAX_CART_ITEMS:
        raise ApiError(f"Bir buyurtmada ko'pi bilan {MAX_CART_ITEMS} ta kiyim")
    session = _session(data.get("session")) if data.get("session") else None
    device = MirrorDevice.objects.filter(slug=data.get("device")).first()
    name = str(data.get("name", "")).strip()[:60]
    phone = re.sub(r"[^\d+]", "", str(data.get("phone", "")))[:20]

    with transaction.atomic():
        order = Order.objects.create(
            number=Order.next_number(), session=session, device=device or (session.device if session else None),
            customer_name=name, phone=phone,
        )
        for it in items:
            size = str(it.get("size", ""))
            if size not in Size.values:
                raise ApiError("O'lcham noto'g'ri")
            row = (
                ProductSize.objects.select_for_update()
                .select_related("product")
                .filter(product_id=it.get("product"), size=size, product__is_active=True)
                .first()
            )
            if not row or row.stock < 1:
                name_ = row.product.name if row else "Kiyim"
                raise ApiError(f"{name_} ({size}) omborda qolmagan", 409)
            row.stock -= 1
            row.save(update_fields=["stock"])
            OrderItem.objects.create(order=order, product=row.product, size=size, price=row.product.price)

    if session:
        _touch(session)
    return JsonResponse({"number": order.number, "total": order.total, "id": order.id}, status=201)


def _is_uuid(value):
    import uuid
    try:
        uuid.UUID(str(value))
        return True
    except (ValueError, TypeError):
        return False


# ---------------- Fotorealistik AI ----------------

def _job_json(job):
    return {
        "id": str(job.pk),
        "status": job.status,
        "error": job.error,
        "seconds": job.seconds,
        "result": job.result_image.url if job.result_image else None,
    }


@require_POST
@api_view
def photoreal_create(request):
    from . import vton

    cfg = AISettings.load()
    if not cfg.enabled:
        raise ApiError("AI xizmati sozlanmagan. Admin panel → AI sozlamalari.", 503)
    data = _body(request)
    session = _session(data.get("session")) if data.get("session") else None
    if session and session.photoreal_jobs.filter(status__in=[JobStatus.QUEUED, JobStatus.RUNNING]).exists():
        raise ApiError("Oldingi AI surat hali tayyorlanmoqda", 409)
    ids = [int(i) for i in data.get("products", []) if str(i).isdigit()][:4]
    products = list(Product.objects.filter(pk__in=ids, is_active=True))
    if not products:
        raise ApiError("Kiyim tanlanmagan")
    ext, person = _decode_snapshot(data.get("person"))

    job = PhotorealJob(session=session, provider=cfg.provider, product_ids=[p.pk for p in products])
    job.person_image.save(f"{job.pk}.{ext}", ContentFile(person), save=False)
    garments = data.get("garments") or {}
    if not isinstance(garments, dict):
        raise ApiError("garments obyekt bo'lishi kerak")
    for p in products:
        uri = garments.get(str(p.pk))
        if uri and not p.photo:
            g_ext, raw = _decode_snapshot(uri)
            from django.core.files.storage import default_storage
            job.garment_files[str(p.pk)] = default_storage.save(f"photoreal/garment/{job.pk}-{p.pk}.{g_ext}", ContentFile(raw))
    job.save()
    if session:
        _touch(session)
    vton.start_job(job)
    job.refresh_from_db()
    return JsonResponse(_job_json(job), status=202)


@require_GET
@api_view
def photoreal_status(request, job_id):
    job = get_object_or_404(PhotorealJob, pk=job_id)
    return JsonResponse(_job_json(job))
