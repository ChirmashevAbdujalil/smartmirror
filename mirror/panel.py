"""Smart Mirror boshqaruv paneli (/panel/).

Django admin'dagi barcha ishlarni o'z dizaynidagi panelda bajarish uchun: kiyimlar (joylash muharriri
bilan), ombor, buyurtmalar, statistika, ranglar, ko'zgular, AI sozlamalari, obrazlar, sessiyalar va xodimlar.

Huquqlar: panelga faqat xodimlar (is_staff) kiradi. Xodimlar boshqaruvi va AI sozlamalari — faqat
administrator (is_superuser).
"""
import json
from functools import wraps

from django import forms
from django.contrib import messages
from django.contrib.auth import get_user_model
from django.contrib.auth.forms import AuthenticationForm
from django.contrib.auth.views import LoginView, LogoutView, redirect_to_login
from django.core.paginator import Paginator
from django.db import transaction
from django.db.models import Count, Max, OuterRef, ProtectedError, Q, Subquery, Sum
from django.db.models.functions import Coalesce
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse, reverse_lazy
from django.utils import timezone
from django.views.decorators.http import require_POST

from .analytics import dashboard_context, parse_days, stats_context
from .forms import (
    AISettingsForm, ColorForm, DeviceForm, ProductForm, StaffCreateForm, StaffEditForm, make_size_formset,
)
from .models import (
    PLACEMENT_LIMITS, SIZE_ORDER, AISettings, Color, Kind, Look, MirrorDevice, MirrorSession, Order, OrderStatus,
    PhotorealJob, Product, ProductSize, Style,
)

User = get_user_model()
PAGE_SIZE = 24


# ---------------- Kirish va huquqlar ----------------

def panel_view(superuser=False):
    def decorator(view):
        @wraps(view)
        def wrapper(request, *args, **kwargs):
            if not request.user.is_authenticated:
                return redirect_to_login(request.get_full_path(), reverse("panel:login"))
            if not request.user.is_staff or (superuser and not request.user.is_superuser):
                return render(request, "panel/forbidden.html", status=403)
            return view(request, *args, **kwargs)
        return wrapper
    return decorator


class StaffAuthForm(AuthenticationForm):
    def confirm_login_allowed(self, user):
        super().confirm_login_allowed(user)
        if not user.is_staff:
            raise forms.ValidationError("Bu foydalanuvchida boshqaruv paneliga kirish huquqi yo'q.", code="no_staff")


class PanelLoginView(LoginView):
    template_name = "panel/login.html"
    authentication_form = StaffAuthForm
    redirect_authenticated_user = True

    def get_default_redirect_url(self):
        return reverse("panel:dashboard")


class PanelLogoutView(LogoutView):
    next_page = reverse_lazy("panel:login")


def _page(request, qs):
    return Paginator(qs, PAGE_SIZE).get_page(request.GET.get("page"))


def _query_without_page(request):
    q = request.GET.copy()
    q.pop("page", None)
    return q.urlencode()


# ---------------- Bosh sahifa ----------------

@panel_view()
def dashboard(request):
    ctx = dashboard_context(days=14)
    ctx["devices"] = (
        MirrorDevice.objects.annotate(last=Max("mirrorsession__last_activity"))
        .order_by("-is_active", "name")
    )
    ctx["ai"] = AISettings.load()
    return render(request, "panel/dashboard.html", {"nav": "dashboard", **ctx})


# ---------------- Kiyimlar ----------------

@panel_view()
def products(request):
    # Ombor yig'indisi alohida so'rovda — sinab ko'rishlar bilan birlashganda ko'payib ketmasligi uchun.
    stock_sum = (ProductSize.objects.filter(product=OuterRef("pk")).order_by()
                 .values("product").annotate(s=Sum("stock")).values("s"))
    qs = Product.objects.select_related("color").annotate(
        stock=Coalesce(Subquery(stock_sum), 0), tries=Count("tryons", distinct=True),
    )
    q = request.GET.get("q", "").strip()
    if q:
        qs = qs.filter(Q(name__icontains=q) | Q(description__icontains=q))
    if request.GET.get("kind") in Kind.values:
        qs = qs.filter(kind=request.GET["kind"])
    if request.GET.get("style") in Style.values:
        qs = qs.filter(style=request.GET["style"])
    status = request.GET.get("status", "")
    if status == "active":
        qs = qs.filter(is_active=True)
    elif status == "hidden":
        qs = qs.filter(is_active=False)
    elif status == "out":
        qs = qs.filter(stock=0)
    elif status == "nophoto":
        qs = qs.filter(photo="")
    sort = request.GET.get("sort", "")
    qs = qs.order_by({"name": "name", "price": "price", "-price": "-price", "popular": "-tries",
                      "stock": "stock"}.get(sort, "sort_order"), "-created_at")
    return render(request, "panel/products.html", {
        "nav": "products", "page": _page(request, qs), "qs": _query_without_page(request),
        "kinds": Kind.choices, "styles": Style.choices, "f": request.GET,
        "total": Product.objects.count(),
    })


def _product_form(request, product):
    is_new = product.pk is None
    existing = set() if is_new else set(product.sizes.values_list("size", flat=True))
    missing = [s for s in SIZE_ORDER if s not in existing]
    FormSet = make_size_formset(extra=len(missing))
    initial = [{"size": s, "stock": 0} for s in missing]

    if request.method == "POST":
        form = ProductForm(request.POST, request.FILES, instance=product)
        formset = FormSet(request.POST, instance=product, initial=initial, prefix="sizes")
        if form.is_valid() and formset.is_valid():
            with transaction.atomic():
                product = form.save()
                formset.instance = product
                formset.save()
            messages.success(request, f"\"{product.name}\" saqlandi.")
            if "_add_another" in request.POST:
                return redirect("panel:product_add")
            return redirect("panel:product_edit", product.pk)
        messages.error(request, "Formada xatolar bor — quyida belgilangan.")
    else:
        form = ProductForm(instance=product)
        formset = FormSet(instance=product, initial=initial, prefix="sizes")

    return render(request, "panel/product_form.html", {
        "nav": "products", "form": form, "formset": formset, "product": product, "is_new": is_new,
        "limits_json": json.dumps(PLACEMENT_LIMITS),
        "orders_count": 0 if is_new else product.orderitem_set.count(),
        "tries_count": 0 if is_new else product.tryons.count(),
    })


@panel_view()
def product_add(request):
    return _product_form(request, Product())


@panel_view()
def product_edit(request, pk):
    return _product_form(request, get_object_or_404(Product, pk=pk))


@panel_view()
@require_POST
def product_toggle(request, pk):
    p = get_object_or_404(Product, pk=pk)
    p.is_active = not p.is_active
    p.save(update_fields=["is_active", "updated_at"])
    messages.success(request, f"\"{p.name}\" {'ko‘zguda ko‘rsatiladi' if p.is_active else 'ko‘zgudan yashirildi'}.")
    return redirect(request.POST.get("next") or "panel:products")


@panel_view()
@require_POST
def product_reprocess(request, pk):
    p = get_object_or_404(Product, pk=pk)
    p.processed_from = "-"
    p.save()
    messages.success(request, "Rasm qayta ishlandi.")
    return redirect("panel:product_edit", pk)


@panel_view()
def product_delete(request, pk):
    p = get_object_or_404(Product, pk=pk)
    if request.method == "POST":
        try:
            name = p.name
            p.delete()
            messages.success(request, f"\"{name}\" o'chirildi.")
        except ProtectedError:
            p.is_active = False
            p.save(update_fields=["is_active", "updated_at"])
            messages.warning(request, f"\"{p.name}\" buyurtmalarda bor, shuning uchun o'chirilmadi — ko'zgudan yashirildi.")
        return redirect("panel:products")
    return render(request, "panel/confirm_delete.html", {
        "nav": "products", "title": f"\"{p.name}\" o'chirilsinmi?",
        "text": "Kiyim, uning rasmlari va ombor ma'lumotlari o'chadi. Buyurtmalarda bo'lsa, o'chirilmaydi — yashiriladi.",
        "back": reverse("panel:product_edit", args=[p.pk]),
    })


# ---------------- Ombor ----------------

@panel_view()
def stock(request):
    qs = Product.objects.select_related("color").prefetch_related("sizes").order_by("kind", "name")
    q = request.GET.get("q", "").strip()
    if q:
        qs = qs.filter(name__icontains=q)
    if request.GET.get("kind") in Kind.values:
        qs = qs.filter(kind=request.GET["kind"])

    if request.method == "POST":
        changed = 0
        errors = []
        with transaction.atomic():
            for p in qs:
                current = {s.size: s for s in p.sizes.all()}
                for size in SIZE_ORDER:
                    key = f"s-{p.pk}-{size}"
                    if key not in request.POST:
                        continue
                    raw = request.POST[key].strip()
                    row = current.get(size)
                    if raw == "":
                        if row:
                            row.delete()
                            changed += 1
                        continue
                    if not raw.isdigit() or int(raw) > 100000:
                        errors.append(f"{p.name} ({size}): «{raw}» — butun son kiriting")
                        continue
                    value = int(raw)
                    if row is None:
                        ProductSize.objects.create(product=p, size=size, stock=value)
                        changed += 1
                    elif row.stock != value:
                        row.stock = value
                        row.save(update_fields=["stock"])
                        changed += 1
            if changed:
                # Ko'zgu katalog o'zgarganini sezishi uchun.
                Product.objects.filter(pk__in=[p.pk for p in qs]).update(updated_at=timezone.now())
        for e in errors:
            messages.error(request, e)
        messages.success(request, f"Ombor yangilandi: {changed} ta o'zgarish." if changed else "O'zgarish yo'q.")
        return redirect(f"{reverse('panel:stock')}?{request.GET.urlencode()}")

    rows = []
    for p in qs:
        sizes = {s.size: s.stock for s in p.sizes.all()}
        rows.append({"p": p, "cells": [(s, sizes.get(s)) for s in SIZE_ORDER],
                     "total": sum(sizes.values())})
    return render(request, "panel/stock.html", {
        "nav": "stock", "rows": rows, "sizes": SIZE_ORDER, "kinds": Kind.choices, "f": request.GET,
    })


# ---------------- Buyurtmalar ----------------

@panel_view()
def orders(request):
    qs = Order.objects.select_related("device").prefetch_related("items__product").order_by("-created_at")
    status = request.GET.get("status")
    if status in OrderStatus.values:
        qs = qs.filter(status=status)
    q = request.GET.get("q", "").strip()
    if q:
        qs = qs.filter(Q(number__icontains=q) | Q(phone__icontains=q) | Q(customer_name__icontains=q))
    return render(request, "panel/orders.html", {
        "nav": "orders", "page": _page(request, qs), "qs": _query_without_page(request),
        "statuses": OrderStatus.choices, "f": request.GET,
    })


@panel_view()
def order_detail(request, pk):
    order = get_object_or_404(Order.objects.select_related("device", "session"), pk=pk)
    if request.method == "POST":
        status = request.POST.get("status")
        if status in OrderStatus.values:
            order.set_status(status)
            messages.success(request, f"#{order.number}: {order.get_status_display()}.")
        note = request.POST.get("note")
        if note is not None and note != order.note:
            order.note = note[:200]
            order.save(update_fields=["note", "updated_at"])
            messages.success(request, "Izoh saqlandi.")
        return redirect("panel:order_detail", pk)
    return render(request, "panel/order_detail.html", {
        "nav": "orders", "order": order, "items": order.items.select_related("product__color"),
        "statuses": OrderStatus.choices,
    })


# ---------------- Statistika ----------------

@panel_view()
def stats(request):
    days = parse_days(request.GET.get("days"))
    return render(request, "panel/stats.html", {"nav": "stats", **stats_context(days)})


# ---------------- Ranglar ----------------

@panel_view()
def colors(request):
    editing = None
    if request.GET.get("edit"):
        editing = get_object_or_404(Color, pk=request.GET["edit"])
    if request.method == "POST":
        if "delete" in request.POST:
            c = get_object_or_404(Color, pk=request.POST["delete"])
            try:
                c.delete()
                messages.success(request, f"\"{c.name}\" rangi o'chirildi.")
            except ProtectedError:
                messages.error(request, f"\"{c.name}\" rangida kiyimlar bor — avval ularni boshqa rangga o'tkazing.")
            return redirect("panel:colors")
        form = ColorForm(request.POST, instance=editing)
        if form.is_valid():
            c = form.save()
            messages.success(request, f"\"{c.name}\" saqlandi.")
            return redirect("panel:colors")
    else:
        form = ColorForm(instance=editing)
    return render(request, "panel/colors.html", {
        "nav": "colors", "form": form, "editing": editing,
        "colors": Color.objects.annotate(n=Count("products")),
    })


# ---------------- Ko'zgular ----------------

@panel_view()
def devices(request):
    today = timezone.localdate()
    qs = MirrorDevice.objects.annotate(
        last=Max("mirrorsession__last_activity"),
        today=Count("mirrorsession", filter=Q(mirrorsession__started_at__date=today)),
        total=Count("mirrorsession"),
    ).order_by("-is_active", "name")
    return render(request, "panel/devices.html", {"nav": "devices", "devices": qs})


@panel_view()
def device_form(request, pk=None):
    device = get_object_or_404(MirrorDevice, pk=pk) if pk else None
    if request.method == "POST":
        if "delete" in request.POST and device:
            device.delete()
            messages.success(request, f"\"{device.name}\" o'chirildi.")
            return redirect("panel:devices")
        form = DeviceForm(request.POST, instance=device)
        if form.is_valid():
            d = form.save()
            messages.success(request, f"\"{d.name}\" saqlandi.")
            return redirect("panel:devices")
    else:
        form = DeviceForm(instance=device)
    return render(request, "panel/device_form.html", {"nav": "devices", "form": form, "device": device})


# ---------------- AI ----------------

@panel_view(superuser=True)
def ai(request):
    cfg = AISettings.load()
    if request.method == "POST":
        form = AISettingsForm(request.POST, instance=cfg)
        if form.is_valid():
            form.save()
            messages.success(request, "AI sozlamalari saqlandi.")
            return redirect("panel:ai")
    else:
        form = AISettingsForm(instance=cfg)
    jobs = PhotorealJob.objects.order_by("-created_at")[:18]
    return render(request, "panel/ai.html", {"nav": "ai", "form": form, "cfg": cfg, "jobs": jobs})


# ---------------- Obrazlar va sessiyalar ----------------

@panel_view()
def looks(request):
    if request.method == "POST" and request.POST.get("delete"):
        look = get_object_or_404(Look, pk=request.POST["delete"])
        if look.snapshot:
            look.snapshot.delete(save=False)
        look.delete()
        messages.success(request, "Obraz o'chirildi.")
        return redirect(f"{reverse('panel:looks')}?{request.GET.urlencode()}")
    qs = Look.objects.prefetch_related("products").order_by("-created_at")
    return render(request, "panel/looks.html", {"nav": "looks", "page": _page(request, qs),
                                                "qs": _query_without_page(request)})


@panel_view()
def sessions(request):
    qs = (
        MirrorSession.objects.select_related("device")
        .annotate(tries=Count("tryons", distinct=True), orders_n=Count("orders", distinct=True))
        .order_by("-started_at")
    )
    if request.GET.get("device"):
        qs = qs.filter(device__slug=request.GET["device"])
    if request.GET.get("ordered") == "1":
        qs = qs.filter(orders_n__gt=0)
    return render(request, "panel/sessions.html", {
        "nav": "sessions", "page": _page(request, qs), "qs": _query_without_page(request),
        "devices": MirrorDevice.objects.all(), "f": request.GET,
    })


# ---------------- Xodimlar ----------------

@panel_view(superuser=True)
def users(request):
    return render(request, "panel/users.html", {
        "nav": "users", "users": User.objects.filter(is_staff=True).order_by("-is_active", "username"),
    })


@panel_view(superuser=True)
def user_form(request, pk=None):
    user = get_object_or_404(User, pk=pk, is_staff=True) if pk else None
    Form = StaffEditForm if user else StaffCreateForm
    if request.method == "POST":
        form = Form(request.POST, instance=user)
        if form.is_valid():
            if user and user == request.user and (
                    not form.cleaned_data["is_active"] or not form.cleaned_data["is_superuser"]):
                form.add_error(None, "O'zingizni o'chira olmaysiz yoki administrator huquqini olib tashlay olmaysiz.")
            else:
                u = form.save()
                messages.success(request, f"\"{u.username}\" saqlandi.")
                return redirect("panel:users")
    else:
        form = Form(instance=user)
    return render(request, "panel/user_form.html", {"nav": "users", "form": form, "staff": user})
