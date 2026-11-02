from django.urls import path

from . import api, views

app_name = "mirror"

urlpatterns = [
    path("", views.home, name="home"),
    path("mirror/<slug:slug>/", views.kiosk, name="kiosk"),
    path("l/<str:token>/", views.look, name="look"),

    path("staff/", views.staff_orders, name="staff_orders"),
    path("staff/stats/", views.stats, name="stats"),
    path("staff/api/orders/", views.staff_orders_api, name="staff_orders_api"),
    path("staff/api/orders/<int:pk>/status/", views.staff_order_status, name="staff_order_status"),

    path("api/catalog/", api.catalog, name="api_catalog"),
    path("api/catalog/version/", api.catalog_version, name="api_catalog_version"),
    path("api/sessions/", api.session_start, name="api_session_start"),
    path("api/sessions/<uuid:session_id>/try/", api.session_try, name="api_session_try"),
    path("api/sessions/<uuid:session_id>/end/", api.session_end, name="api_session_end"),
    path("api/looks/", api.look_create, name="api_look_create"),
    path("api/orders/", api.order_create, name="api_order_create"),
    path("api/photoreal/", api.photoreal_create, name="api_photoreal_create"),
    path("api/photoreal/<uuid:job_id>/", api.photoreal_status, name="api_photoreal_status"),
]
