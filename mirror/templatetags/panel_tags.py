from django import template
from django.utils import timezone
from django.utils.html import format_html

register = template.Library()

# Oddiy chiziqli ikonkalar (24x24, currentColor).
ICONS = {
    "home": "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z",
    "hanger": "M12 7a2 2 0 1 1 2-2M12 7v2l-9 7.5A1.5 1.5 0 0 0 4 19h16a1.5 1.5 0 0 0 1-2.5L12 9",
    "box": "M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8",
    "bag": "M5 8h14l-1 13H6zM9 8V6a3 3 0 0 1 6 0v2",
    "chart": "M4 20V11M10 20V5M16 20v-6M2 20h20",
    "palette": "M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2s-1-1.5-1-2.5.8-1.5 2-1.5h2a4 4 0 0 0 4-4c0-4.4-4-8-9-8zM7.5 11h.01M10 7h.01M15 7.5h.01",
    "mirror": "M8 3h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM12 19v2M9 21h6",
    "sparkles": "M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7-4.7-1.8 4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z",
    "image": "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01",
    "clock": "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
    "users": "M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 20v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
    "logout": "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
    "plus": "M12 5v14M5 12h14",
    "search": "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
    "external": "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
    "sun": "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
    "moon": "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
    "menu": "M3 6h18M3 12h18M3 18h18",
    "wallet": "M3 7a2 2 0 0 1 2-2h13v4M3 7v10a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2zM16 14h.01",
    "trash": "M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14",
    "edit": "M4 20h4L19 9l-4-4L4 16zM14 6l4 4",
    "eye": "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
    "eyeoff": "M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2",
    "check": "M5 12l5 5L20 7",
    "alert": "M12 3l10 18H2zM12 10v4M12 17.5h.01",
    "up": "M12 19V5M5 12l7-7 7 7",
    "down": "M12 5v14M19 12l-7 7-7-7",
    "refresh": "M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5",
    "qr": "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM18 18h3v3h-3z",
    "back": "M15 18l-6-6 6-6",
    "bell": "M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0",
    "shield": "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
}


@register.simple_tag
def icon(name, size=18, cls=""):
    path = ICONS.get(name, ICONS["alert"])
    return format_html(
        '<svg class="ic {}" width="{}" height="{}" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
        'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="{}"/></svg>',
        cls, size, size, path,
    )


@register.filter
def money(value):
    try:
        return f"{int(value or 0):,}".replace(",", " ") + " so'm"
    except (TypeError, ValueError):
        return value


@register.filter
def num(value):
    try:
        return f"{int(value or 0):,}".replace(",", " ")
    except (TypeError, ValueError):
        return value


@register.filter
def duration(seconds):
    try:
        s = int(seconds or 0)
    except (TypeError, ValueError):
        return "—"
    return f"{s // 60}:{s % 60:02d}"


@register.filter
def ago(dt):
    """Qisqa "qancha oldin" ko'rinishi."""
    if not dt:
        return "hech qachon"
    sec = int((timezone.now() - dt).total_seconds())
    if sec < 60:
        return "hozirgina"
    if sec < 3600:
        return f"{sec // 60} daqiqa oldin"
    if sec < 86400:
        return f"{sec // 3600} soat oldin"
    return f"{sec // 86400} kun oldin"


@register.filter
def online(dt):
    return bool(dt and (timezone.now() - dt).total_seconds() < 180)


@register.filter
def pct_of(value, total):
    try:
        return max(2, round(100 * float(value) / float(total))) if float(total) else 0
    except (TypeError, ValueError, ZeroDivisionError):
        return 0


@register.simple_tag
def status_badge(status, label):
    return format_html('<span class="badge st-{}"><i></i>{}</span>', status, label)


@register.filter
def is_checkbox(field):
    return field.field.widget.input_type == "checkbox" if hasattr(field.field.widget, "input_type") else False


@register.simple_tag(takes_context=True)
def qs_with(context, **kwargs):
    """Joriy GET parametrlarini saqlab, ba'zilarini almashtirish (filtr havolalari uchun)."""
    q = context["request"].GET.copy()
    for k, v in kwargs.items():
        if v in (None, ""):
            q.pop(k, None)
        else:
            q[k] = v
    q.pop("page", None)
    return "?" + q.urlencode()


@register.simple_tag
def new_orders_count():
    from mirror.models import Order, OrderStatus
    return Order.objects.filter(status=OrderStatus.NEW).count()


@register.filter
def initials(user):
    name = (user.get_full_name() or user.username or "?").strip()
    parts = name.split()
    return "".join(p[0] for p in parts[:2]).upper()


@register.filter
def abs_val(value):
    try:
        return abs(value)
    except TypeError:
        return value
