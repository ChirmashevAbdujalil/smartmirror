from django.conf import settings
from django.contrib import admin
from django.urls import include, path, re_path
from django.views.static import serve

admin.site.site_header = "Smart Mirror — boshqaruv"
admin.site.site_title = "Smart Mirror"
admin.site.index_title = "Do'kon boshqaruvi"

urlpatterns = [
    path("admin/", admin.site.urls),
    path("", include("mirror.urls")),
]

if settings.SERVE_MEDIA:
    # Kiosk (bitta qurilma / kichik do'kon) uchun qulay. Katta o'rnatishda media'ni nginx bersin.
    urlpatterns += [
        re_path(r"^%s(?P<path>.*)$" % settings.MEDIA_URL.lstrip("/"), serve, {"document_root": settings.MEDIA_ROOT}),
    ]
