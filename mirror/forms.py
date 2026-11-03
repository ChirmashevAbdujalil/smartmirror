"""Formalar: Django admin va maxsus boshqaruv paneli (panel) ikkalasi ham ishlatadi."""
from django import forms
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.forms import inlineformset_factory

from .models import (
    SIZE_ORDER, AISettings, Color, MirrorDevice, Product, ProductSize, normalize_placement,
)

User = get_user_model()


class ProductForm(forms.ModelForm):
    class Meta:
        model = Product
        fields = "__all__"
        widgets = {
            "placement": forms.HiddenInput(),
            "description": forms.Textarea(attrs={"rows": 3}),
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Joylash muharriri rang o'zgarganda tasvirni qayta chizishi uchun.
        self.fields["color"].widget.attrs["data-colors"] = "|".join(
            f"{c.pk}:{c.hex}" for c in Color.objects.all())

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


class BaseSizeFormSet(forms.BaseInlineFormSet):
    def clean(self):
        super().clean()
        seen = set()
        for form in self.forms:
            if not hasattr(form, "cleaned_data") or form.cleaned_data.get("DELETE"):
                continue
            size = form.cleaned_data.get("size")
            if size in seen:
                raise forms.ValidationError(f"{size} o'lchami ikki marta kiritilgan")
            if size:
                seen.add(size)


def make_size_formset(extra=0):
    """O'lchamlar formseti. `extra` — hali kiritilmagan o'lchamlar uchun bo'sh qatorlar soni."""
    return inlineformset_factory(
        Product, ProductSize, formset=BaseSizeFormSet, fields=("size", "stock"),
        extra=extra, max_num=len(SIZE_ORDER), can_delete=True,
        widgets={"stock": forms.NumberInput(attrs={"min": 0, "class": "num"})},
    )


class ColorForm(forms.ModelForm):
    class Meta:
        model = Color
        fields = ("name", "hex", "is_neutral", "sort_order")
        widgets = {"hex": forms.TextInput(attrs={"type": "color"})}


class DeviceForm(forms.ModelForm):
    class Meta:
        model = MirrorDevice
        fields = ("name", "slug", "location", "city", "idle_seconds", "is_active")


class AISettingsForm(forms.ModelForm):
    class Meta:
        model = AISettings
        fields = "__all__"
        widgets = {"api_key": forms.PasswordInput(render_value=True, attrs={"autocomplete": "off", "size": 60})}


class StaffCreateForm(forms.ModelForm):
    password = forms.CharField(label="Parol", widget=forms.PasswordInput(attrs={"autocomplete": "new-password"}))

    class Meta:
        model = User
        fields = ("username", "first_name", "last_name", "is_superuser")
        labels = {"is_superuser": "To'liq huquq (administrator)"}
        help_texts = {
            "is_superuser": "Belgilanmasa — konsultant: kiyimlar, ombor va buyurtmalar bilan ishlaydi.",
            "username": "",
        }

    def clean_password(self):
        password = self.cleaned_data["password"]
        validate_password(password)
        return password

    def save(self, commit=True):
        user = super().save(commit=False)
        user.is_staff = True
        user.set_password(self.cleaned_data["password"])
        if commit:
            user.save()
        return user


class StaffEditForm(forms.ModelForm):
    new_password = forms.CharField(
        label="Yangi parol", required=False, widget=forms.PasswordInput(attrs={"autocomplete": "new-password"}),
        help_text="Bo'sh qoldirilsa — parol o'zgarmaydi.",
    )

    class Meta:
        model = User
        fields = ("first_name", "last_name", "is_active", "is_superuser")
        labels = {"is_superuser": "To'liq huquq (administrator)", "is_active": "Faol (tizimga kira oladi)"}

    def clean_new_password(self):
        password = self.cleaned_data.get("new_password")
        if password:
            validate_password(password, self.instance)
        return password

    def save(self, commit=True):
        user = super().save(commit=False)
        if self.cleaned_data.get("new_password"):
            user.set_password(self.cleaned_data["new_password"])
        if commit:
            user.save()
        return user
