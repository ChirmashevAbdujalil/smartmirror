"""Statistika hisob-kitoblari: eski /staff/stats/ sahifasi va boshqaruv paneli ikkalasi ham ishlatadi."""
from datetime import timedelta

from django.db.models import Count, F, Q, Sum
from django.db.models.functions import TruncDate
from django.utils import timezone

from .models import (
    JobStatus, MirrorSession, Order, OrderItem, OrderStatus, PhotorealJob, Product, ProductSize, TryOn,
)

# Taxmin: an'anaviy kiyinish xonasida bitta kiyimga ~8 daqiqa ketadi.
MINUTES_PER_FITTING = 8


def money(v):
    return f"{int(v or 0):,}".replace(",", " ") + " so'm"


def parse_days(value, default=30):
    try:
        return max(1, min(365, int(value)))
    except (TypeError, ValueError):
        return default


def _revenue(orders_qs):
    items = OrderItem.objects.filter(order__in=orders_qs.filter(status=OrderStatus.SOLD))
    return items.aggregate(s=Sum(F("price") * F("quantity")))["s"] or 0


def stats_context(days):
    since = timezone.now() - timedelta(days=days)
    sessions = MirrorSession.objects.filter(started_at__gte=since)
    session_count = sessions.count()
    durations = [s.duration_seconds for s in sessions.only("started_at", "last_activity", "ended_at")]
    avg_duration = int(sum(durations) / len(durations)) if durations else 0
    tryon_count = TryOn.objects.filter(created_at__gte=since).count()

    orders = Order.objects.filter(created_at__gte=since)
    revenue = _revenue(orders)
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
    saved_minutes = max(0, tryon_count * MINUTES_PER_FITTING - sum(durations) // 60)

    return {
        "days": days,
        "cards": [
            ("Sessiyalar", session_count),
            ("Sinab ko'rishlar", tryon_count),
            ("O'rtacha sessiya", f"{avg_duration // 60}:{avg_duration % 60:02d}"),
            ("Kiyim / sessiya", f"{tryon_count / session_count:.1f}" if session_count else "0"),
            ("Buyurtmalar", orders.count()),
            ("Konversiya", f"{round(100 * sessions_with_order / session_count) if session_count else 0}%"),
            ("Sotuv", money(revenue)),
            ("Tejalgan vaqt (taxm.)", f"{saved_minutes} daq"),
        ],
        "rows": rows,
        "low_stock": low_stock,
        "by_status": [(label, by_status.get(value, 0)) for value, label in OrderStatus.choices],
        "by_status_map": {value: by_status.get(value, 0) for value in OrderStatus.values},
    }


def _daily(qs, date_field, days, value=None):
    """Oxirgi `days` kun uchun kunlik qiymatlar (bo'sh kunlar 0 bilan)."""
    today = timezone.localdate()
    start = today - timedelta(days=days - 1)
    rows = (
        qs.filter(**{f"{date_field}__date__gte": start})
        .annotate(day=TruncDate(date_field))
        .values("day")
        .annotate(v=value if value is not None else Count("pk"))
    )
    by_day = {r["day"]: r["v"] or 0 for r in rows}
    return [
        {"date": (start + timedelta(days=i)).isoformat(), "value": int(by_day.get(start + timedelta(days=i), 0))}
        for i in range(days)
    ]


def _delta(today, yesterday):
    if not yesterday:
        return None
    return round(100 * (today - yesterday) / yesterday)


def dashboard_context(days=14):
    now = timezone.now()
    today = timezone.localdate()
    yesterday = today - timedelta(days=1)

    def count_on(qs, field, day):
        return qs.filter(**{f"{field}__date": day}).count()

    sessions_t = count_on(MirrorSession.objects, "started_at", today)
    sessions_y = count_on(MirrorSession.objects, "started_at", yesterday)
    tries_t = count_on(TryOn.objects, "created_at", today)
    tries_y = count_on(TryOn.objects, "created_at", yesterday)
    orders_t = count_on(Order.objects, "created_at", today)
    orders_y = count_on(Order.objects, "created_at", yesterday)
    revenue_t = _revenue(Order.objects.filter(created_at__date=today))
    revenue_y = _revenue(Order.objects.filter(created_at__date=yesterday))

    sold_line = Sum(F("price") * F("quantity"))
    revenue_daily = _daily(
        OrderItem.objects.filter(order__status=OrderStatus.SOLD), "order__created_at", days, sold_line)
    tries_daily = _daily(TryOn.objects.all(), "created_at", days)

    active = Order.objects.filter(status__in=[OrderStatus.NEW, OrderStatus.PREPARING, OrderStatus.FITTING])
    since30 = now - timedelta(days=30)
    top = list(
        Product.objects.annotate(tries=Count("tryons", filter=Q(tryons__created_at__gte=since30)))
        .filter(tries__gt=0).select_related("color").order_by("-tries")[:6]
    )
    low_stock = (
        ProductSize.objects.filter(product__is_active=True, stock__lte=1)
        .select_related("product").order_by("stock", "product__name")
    )
    return {
        "kpis": [
            {"label": "Bugungi sotuv", "value": money(revenue_t), "delta": _delta(revenue_t, revenue_y), "icon": "wallet"},
            {"label": "Bugungi buyurtmalar", "value": orders_t, "delta": _delta(orders_t, orders_y), "icon": "bag"},
            {"label": "Sinab ko'rishlar", "value": tries_t, "delta": _delta(tries_t, tries_y), "icon": "hanger"},
            {"label": "Ko'zgu tashriflari", "value": sessions_t, "delta": _delta(sessions_t, sessions_y), "icon": "mirror"},
        ],
        "chart_days": days,
        "revenue_daily": revenue_daily,
        "tries_daily": tries_daily,
        "revenue_period": sum(d["value"] for d in revenue_daily),
        "tries_period": sum(d["value"] for d in tries_daily),
        "active_orders": active.select_related("device").prefetch_related("items__product").order_by("created_at")[:6],
        "active_count": active.count(),
        "new_count": active.filter(status=OrderStatus.NEW).count(),
        "top": top,
        "top_max": top[0].tries if top else 1,
        "low_stock": low_stock[:5],
        "low_stock_count": low_stock.count(),
        "product_count": Product.objects.filter(is_active=True).count(),
        "ai_jobs_today": PhotorealJob.objects.filter(created_at__date=today, status=JobStatus.DONE).count(),
    }
