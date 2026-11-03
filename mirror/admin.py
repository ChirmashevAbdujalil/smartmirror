import json

from django.contrib import admin, messages
from django.templatetags.static import static
from django.utils.html import format_html, format_html_join

from django import forms
from django.shortcuts import redirect

from .models import (
    PLACEMENT_LIMITS, normalize_placement, SIZE_ORDER, AISettings, PhotorealJob, Color, Look, MirrorDevice, MirrorSession, Order, OrderItem, OrderStatus,
    Product, ProductSize, TryOn,
)


def money(v):
    return f"{v:,}".replace(",", " ") + " so'm"


@admin.register(Color)
class ColorAdmin(admin.ModelAdmin):
    list_display = ("swatch", "name", "hex", "is_neutral", "sort_order")
    list_display_links = ("swatch", "name")
    list_editable = ("is_neutral", "sort_order")

    @admin.display(description="")
    def swatch(self, obj):
        return format_html(
            '<span style="display:inline-block;width:22px;height:22px;border-radius:50%;'
            'background:{};border:1px solid #ccc"></span>', obj.hex)


class ProductSizeInline(admin.TabularInline):
    model = ProductSize
    extra = 0
    min_num = 0
    max_num = len(SIZE_ORDER)

    def get_extra(self, request, obj=None, **kwargs):
        # Yangi kiyim uchun barcha o'lchamlar qatori tayyor turadi (0 qoldirilganlari saqlanmaydi).
        return len(SIZE_ORDER) if obj is None else 1


class ProductForm(forms.ModelForm):
    class Meta:
        model = Product
        fields = "__all__"
        widgets = {"placement": forms.HiddenInput()}

    def clean_placement(self):
        try:
            return normalize_placement(self.cleaned_data.get("placement"))
        except ValueError as e:
            raise forms.ValidationError(str(e))

    def clean(self):
        data = super().clean()
        # Yashirin maydon xatosi ko'rinmay qolmasin — formaning yuqorisida chiqaramiz.
        if "placement" in self.errors:
            self.add_error(None, "Kiyim joylashuvi: " + "; ".join(self.errors["placement"]))
        return data


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    form = ProductForm
    list_display = ("thumb", "name", "kind", "style", "color", "price_fmt", "stock_fmt", "is_active", "is_new")
    list_display_links = ("thumb", "name")
    list_filter = ("is_active", "is_new", "kind", "style", "color")
    list_editable = ("is_active", "is_new")
    search_fields = ("name", "description")
    inlines = [ProductSizeInline]
    readonly_fields = ("placement_editor",)
    actions = ["activate", "deactivate", "reprocess"]
    fieldsets = (
        (None, {"fields": ("name", "kind", "style", "color", "price", "description", "is_active", "is_new", "sort_order")}),
        ("Rasm va tanadagi joyi", {
            "description": "Rasm yuklang, so'ng muharrirda kiyimni manekin ustiga joylang: surib qo'ying, burchaklaridan "
                           "kattalashtiring, tepadagi doiracha bilan buring. Tana chiziqlari (yelka, bel, son, tizza, "
                           "to'piq) qayerga tushishini ko'rsatadi. Ko'zguda kiyim xaridorning aynan shu tana qismiga "
                           "kiydiriladi.",
            "fields": ("photo", "remove_background", "placement_editor", "placement"),
        }),
    )

    def get_queryset(self, request):
        return super().get_queryset(request).select_related("color").prefetch_related("sizes")

    def get_formset_kwargs(self, request, obj, inline, prefix):
        kwargs = super().get_formset_kwargs(request, obj, inline, prefix)
        if isinstance(inline, ProductSizeInline) and not obj.pk:
            kwargs["initial"] = [{"size": s, "stock": 0} for s in SIZE_ORDER]
        return kwargs

    @admin.display(description="")
    def thumb(self, obj):
        if obj.tryon_image:
            return format_html('<img src="{}" style="height:56px;width:44px;object-fit:contain;'
                               'background:#f3eaee;border-radius:6px">', obj.tryon_image.url)
        return format_html('<span style="display:inline-block;height:56px;width:44px;border-radius:6px;'
                           'background:{};opacity:.8"></span>', obj.color.hex)

    @admin.display(description="Narx", ordering="price")
    def price_fmt(self, obj):
        return money(obj.price)

    @admin.display(description="Ombor")
    def stock_fmt(self, obj):
        sizes = {s.size: s.stock for s in obj.sizes.all()}
        return format_html_join(
            " ", '<span style="padding:1px 5px;border-radius:4px;background:{}">{}:{}</span>',
            (("#fde2e2" if sizes[s] == 0 else "#eef3ee", s, sizes[s]) for s in SIZE_ORDER if s in sizes),
        ) or "—"

    @admin.display(description="Tanadagi joyi")
    def placement_editor(self, obj):
        has_obj = bool(obj and obj.pk)
        return format_html(
            '<div class="sm-place" data-image="{}" data-kind="{}" data-color="{}" data-limits="{}">'
            '<noscript>Muharrir uchun JavaScript kerak.</noscript></div>'
            '<link rel="stylesheet" href="{}">'
            '<script type="module" src="{}"></script>',
            obj.tryon_image.url if has_obj and obj.tryon_image else "",
            obj.kind if has_obj else "bluzka",
            obj.color.hex if has_obj else "#e8a3b5",
            json.dumps(PLACEMENT_LIMITS),
            static("mirror/css/admin-place.css"),
            static("mirror/js/admin-place.js"),
        )

    def formfield_for_dbfield(self, db_field, request, **kwargs):
        field = super().formfield_for_dbfield(db_field, request, **kwargs)
        if db_field.name == "color":
            field.widget.attrs["data-colors"] = "|".join(f"{c.pk}:{c.hex}" for c in Color.objects.all())
        return field

    @admin.action(description="Ko'zguda ko'rsatish")
    def activate(self, request, qs):
        qs.update(is_active=True)

    @admin.action(description="Ko'zgudan yashirish")
    def deactivate(self, request, qs):
        qs.update(is_active=False)

    @admin.action(description="Rasmni qayta ishlash (fonni qayta olib tashlash)")
    def reprocess(self, request, qs):
        n = 0
        for p in qs:
            p.processed_from = "-"
            p.save()
            n += 1
        self.message_user(request, f"{n} ta rasm qayta ishlandi.", messages.SUCCESS)


@admin.register(MirrorDevice)
class MirrorDeviceAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "location", "city", "idle_seconds", "is_active", "open_link")
    prepopulated_fields = {"slug": ("name",)}

    @admin.display(description="Ko'zgu sahifasi")
    def open_link(self, obj):
        return format_html('<a href="{}" target="_blank">Ochish ↗</a>', obj.get_absolute_url())


class OrderItemInline(admin.TabularInline):
    model = OrderItem
    extra = 0
    readonly_fields = ("product", "size", "quantity", "price")
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = ("__str__", "created_at", "status", "items_fmt", "total_fmt", "customer_name", "phone", "device")
    list_filter = ("status", "device", "created_at")
    search_fields = ("number", "customer_name", "phone")
    inlines = [OrderItemInline]
    readonly_fields = ("number", "session", "device", "created_at")
    actions = ["mark_sold", "mark_cancelled"]
    date_hierarchy = "created_at"

    def get_queryset(self, request):
        return super().get_queryset(request).select_related("device").prefetch_related("items__product")

    @admin.display(description="Kiyimlar")
    def items_fmt(self, obj):
        return ", ".join(f"{i.product.name} ({i.size})" for i in obj.items.all())

    @admin.display(description="Jami")
    def total_fmt(self, obj):
        return money(obj.total)

    def save_model(self, request, obj, form, change):
        # Holat o'zgarishi ombor zaxirasiga ta'sir qiladi — set_status orqali o'tkazamiz.
        new_status = obj.status
        if change and "status" in form.changed_data:
            obj.status = form.initial["status"]
            super().save_model(request, obj, form, change)
            obj.set_status(new_status)
        else:
            super().save_model(request, obj, form, change)

    def has_add_permission(self, request):
        return False  # buyurtmalar ko'zgudan keladi

    @admin.action(description="Sotildi deb belgilash")
    def mark_sold(self, request, qs):
        for o in qs:
            o.set_status(OrderStatus.SOLD)

    @admin.action(description="Bekor qilish (omborga qaytarish)")
    def mark_cancelled(self, request, qs):
        for o in qs:
            o.set_status(OrderStatus.CANCELLED)


class TryOnInline(admin.TabularInline):
    model = TryOn
    extra = 0
    readonly_fields = ("product", "created_at")
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(MirrorSession)
class MirrorSessionAdmin(admin.ModelAdmin):
    list_display = ("started_at", "device", "duration_fmt", "tries")
    list_filter = ("device",)
    date_hierarchy = "started_at"
    readonly_fields = ("device", "started_at", "last_activity", "ended_at")
    inlines = [TryOnInline]

    def has_add_permission(self, request):
        return False

    @admin.display(description="Davomiyligi")
    def duration_fmt(self, obj):
        d = obj.duration_seconds
        return f"{d // 60}:{d % 60:02d}"

    @admin.display(description="Sinab ko'rildi")
    def tries(self, obj):
        return obj.tryons.count()


@admin.register(Look)
class LookAdmin(admin.ModelAdmin):
    list_display = ("__str__", "created_at", "snap", "open_link")
    readonly_fields = ("token", "session", "created_at", "snapshot")
    filter_horizontal = ("products",)

    @admin.display(description="Surat")
    def snap(self, obj):
        if obj.snapshot:
            return format_html('<img src="{}" style="height:60px;border-radius:6px">', obj.snapshot.url)
        return "—"

    @admin.display(description="Havola")
    def open_link(self, obj):
        return format_html('<a href="{}" target="_blank">Ochish ↗</a>', obj.get_absolute_url())


class AISettingsForm(forms.ModelForm):
    class Meta:
        model = AISettings
        fields = "__all__"
        widgets = {"api_key": forms.PasswordInput(render_value=True, attrs={"autocomplete": "off", "size": 60})}


@admin.register(AISettings)
class AISettingsAdmin(admin.ModelAdmin):
    form = AISettingsForm
    fieldsets = ((None, {
        "fields": ("provider", "api_key", "model", "endpoint", "timeout"),
        "description": "Fotorealistik kiyib ko'rish: ko'zgudagi \"✨ AI foto\" tugmasi xaridor suratini va tanlangan "
                       "kiyimlarni shu xizmatga yuboradi. FASHN yoki Replicate'dan API kalit oling, yoki o'z GPU "
                       "serveringiz manzilini kiriting (README'da kontrakt yozilgan). Kalit serverda saqlanadi va "
                       "ko'zguga yuborilmaydi.",
    }),)

    def has_add_permission(self, request):
        return not AISettings.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False

    def changelist_view(self, request, extra_context=None):
        obj = AISettings.load()
        return redirect("admin:mirror_aisettings_change", obj.pk)


@admin.register(PhotorealJob)
class PhotorealJobAdmin(admin.ModelAdmin):
    list_display = ("created_at", "provider", "status", "seconds_fmt", "thumbs", "error")
    list_filter = ("status", "provider")
    readonly_fields = ("session", "provider", "status", "product_ids", "person_image", "result_image",
                       "error", "created_at", "finished_at")
    exclude = ("garment_files",)

    def has_add_permission(self, request):
        return False

    @admin.display(description="Vaqt")
    def seconds_fmt(self, obj):
        return f"{obj.seconds} s"

    @admin.display(description="Surat → natija")
    def thumbs(self, obj):
        img = '<img src="{}" style="height:70px;border-radius:6px;margin-right:4px">'
        parts = [obj.person_image, obj.result_image]
        return format_html_join("", img, ((p.url,) for p in parts if p)) or "—"


# Admin bosh sahifasiga tezkor havolalar (konsultant paneli, statistika, ko'zgu).
admin.site.index_template = "mirror/admin_index.html"
