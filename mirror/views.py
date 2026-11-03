from datetime import timedelta

from django.contrib.admin.views.decorators import staff_member_required
from django.db.models import Count, F, Q, Sum
from django.http import Http404, HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST

from .analytics import parse_days

from .models import (
    Look, MirrorDevice, MirrorSession, Order, OrderItem, OrderStatus, Product, ProductSize, TryOn,
)


def home(request):
    device = MirrorDevice.objects.filter(is_active=True).order_by("pk").first()
    if device:
        url = device.get_absolute_url()
        if request.META.get("QUERY_STRING"):
            url += "?" + request.META["QUERY_STRING"]
        return redirect(url)
    return render(request, "mirror/no_device.html")


@ensure_csrf_cookie
def kiosk(request, slug):
    device = get_object_or_404(MirrorDevice, slug=slug, is_active=True)
    return render(request, "mirror/kiosk.html", {"device": device})


def look(request, token):
    obj = get_object_or_404(Look.objects.prefetch_related("products__color", "products__sizes"), token=token)
    products = list(obj.products.all())
    return render(request, "mirror/look.html", {
        "look": obj,
        "products": products,
        "total": sum(p.price for p in products),
    })


# ---------------- Konsultant paneli ----------------

@staff_member_required
def staff_orders(request):
    return redirect("panel:orders")


def _order_json(o):
    return {
        "id": o.id,
        "number": o.number,
        "status": o.status,
        "statusLabel": o.get_status_display(),
        "customer": o.customer_name,
        "phone": o.phone,
        "device": o.device.name if o.device else "",
        "created": timezone.localtime(o.created_at).strftime("%H:%M"),
        "minutes": int((timezone.now() - o.created_at).total_seconds() // 60),
        "total": o.total,
        "items": [
            {
                "name": i.product.name, "size": i.size, "price": i.price,
                "image": i.product.tryon_image.url if i.product.tryon_image else None,
                "color": i.product.color.hex, "kind": i.product.kind,
            }
            for i in o.items.all()
        ],
    }


@staff_member_required
@require_GET
def staff_orders_api(request):
    since = timezone.now() - timedelta(hours=24)
    active = [OrderStatus.NEW, OrderStatus.PREPARING, OrderStatus.FITTING]
    qs = (
        Order.objects.filter(Q(status__in=active) | Q(updated_at__gte=since))
        .select_related("device")
        .prefetch_related("items__product__color")
        .order_by("-created_at")[:60]
    )
    return JsonResponse({"orders": [_order_json(o) for o in qs]})


@staff_member_required
@require_POST
def staff_order_status(request, pk):
    order = get_object_or_404(Order, pk=pk)
    status = request.POST.get("status")
    if status not in OrderStatus.values:
        return JsonResponse({"error": "Holat noto'g'ri"}, status=400)
    order.set_status(status)
    return JsonResponse({"ok": True})


# ---------------- Statistika ----------------

@staff_member_required
def stats(request):
    # Eski manzil — yangi boshqaruv paneliga yo'naltiramiz.
    return redirect(f"{reverse('panel:stats')}?days={parse_days(request.GET.get('days'))}")


# ---------------- Admin: kiyim rasmini oldindan qayta ishlash ----------------

PREVIEW_MAX_BYTES = 15 * 1024 * 1024


@staff_member_required
@require_POST
def tryon_preview(request):
    """Admin yangi rasm tanlaganda (yoki "fonni olib tashlash" belgisini o'zgartirganda) muharrir
    saqlashdan oldin aynan saqlangandagi natijani ko'rsatishi uchun: rasm saqlashdagi bilan bir xil
    `make_tryon_image` orqali o'tkaziladi va fonsiz, qirqilgan PNG qaytariladi. Hech narsa saqlanmaydi."""
    from .imaging import make_tryon_image

    remove_bg = request.POST.get("remove_background", "1") not in ("0", "false", "")
    upload = request.FILES.get("photo")
    try:
        if upload:
            if upload.size > PREVIEW_MAX_BYTES:
                return JsonResponse({"error": "Rasm juda katta (15 MB dan oshmasin)"}, status=400)
            content = make_tryon_image(upload, remove_bg=remove_bg)
        else:
            product = Product.objects.filter(pk=request.POST.get("product")).first()
            if not product or not product.photo:
                return JsonResponse({"error": "Rasm topilmadi"}, status=400)
            product.photo.open("rb")
            try:
                content = make_tryon_image(product.photo, remove_bg=remove_bg)
            finally:
                product.photo.close()
    except Exception:
        return JsonResponse({"error": "Rasm o'qilmadi — PNG, JPG yoki WEBP yuklang"}, status=400)
    response = HttpResponse(content.read(), content_type="image/png")
    response["Cache-Control"] = "no-store"
    return response
