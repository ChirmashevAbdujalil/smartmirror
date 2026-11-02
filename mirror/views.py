from datetime import timedelta

from django.contrib.admin.views.decorators import staff_member_required
from django.db.models import Count, F, Q, Sum
from django.http import Http404, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST

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
    return render(request, "mirror/staff_orders.html", {"statuses": OrderStatus.choices})


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
    try:
        days = max(1, min(365, int(request.GET.get("days", 30))))
    except ValueError:
        days = 30
    since = timezone.now() - timedelta(days=days)

    sessions = MirrorSession.objects.filter(started_at__gte=since)
    session_count = sessions.count()
    durations = [s.duration_seconds for s in sessions.only("started_at", "last_activity", "ended_at")]
    avg_duration = int(sum(durations) / len(durations)) if durations else 0
    tryons = TryOn.objects.filter(created_at__gte=since)
    tryon_count = tryons.count()

    orders = Order.objects.filter(created_at__gte=since)
    sold_items = OrderItem.objects.filter(order__in=orders.filter(status=OrderStatus.SOLD))
    revenue = sold_items.aggregate(s=Sum(F("price") * F("quantity")))["s"] or 0
    sessions_with_order = sessions.filter(orders__isnull=False).distinct().count()

    top = (
        Product.objects.annotate(
            tries=Count("tryons", filter=Q(tryons__created_at__gte=since), distinct=True),
            ordered=Count("orderitem", filter=Q(orderitem__order__created_at__gte=since), distinct=True),
            sold=Count("orderitem", filter=Q(
                orderitem__order__created_at__gte=since, orderitem__order__status=OrderStatus.SOLD), distinct=True),
        )
        .filter(tries__gt=0)
        .select_related("color")
        .order_by("-tries")[:12]
    )
    max_tries = top[0].tries if top else 1
    rows = [{
        "p": p, "tries": p.tries, "ordered": p.ordered, "sold": p.sold,
        "conv": round(100 * p.sold / p.tries) if p.tries else 0,
        "bar": round(100 * p.tries / max_tries),
    } for p in top]

    low_stock = (
        ProductSize.objects.filter(product__is_active=True, stock__lte=1)
        .select_related("product").order_by("stock", "product__name")[:20]
    )
    by_status = dict(orders.values_list("status").annotate(n=Count("id")))
    # Taxmin: an'anaviy kiyinish xonasida bitta kiyimga ~8 daqiqa ketadi.
    saved_minutes = max(0, tryon_count * 8 - sum(durations) // 60)

    return render(request, "mirror/stats.html", {
        "days": days,
        "cards": [
            ("Sessiyalar", session_count),
            ("Sinab ko'rishlar", tryon_count),
            ("O'rtacha sessiya", f"{avg_duration // 60}:{avg_duration % 60:02d}"),
            ("Kiyim / sessiya", f"{tryon_count / session_count:.1f}" if session_count else "0"),
            ("Buyurtmalar", orders.count()),
            ("Konversiya", f"{round(100 * sessions_with_order / session_count) if session_count else 0}%"),
            ("Sotuv", f"{revenue:,}".replace(",", " ") + " so'm"),
            ("Tejalgan vaqt (taxm.)", f"{saved_minutes} daq"),
        ],
        "rows": rows,
        "low_stock": low_stock,
        "by_status": [(label, by_status.get(value, 0)) for value, label in OrderStatus.choices],
    })
