from django.urls import path

from . import panel

app_name = "panel"

urlpatterns = [
    path("", panel.dashboard, name="dashboard"),
    path("login/", panel.PanelLoginView.as_view(), name="login"),
    path("logout/", panel.PanelLogoutView.as_view(), name="logout"),

    path("products/", panel.products, name="products"),
    path("products/new/", panel.product_add, name="product_add"),
    path("products/<int:pk>/", panel.product_edit, name="product_edit"),
    path("products/<int:pk>/toggle/", panel.product_toggle, name="product_toggle"),
    path("products/<int:pk>/reprocess/", panel.product_reprocess, name="product_reprocess"),
    path("products/<int:pk>/delete/", panel.product_delete, name="product_delete"),
    path("stock/", panel.stock, name="stock"),

    path("orders/", panel.orders, name="orders"),
    path("orders/<int:pk>/", panel.order_detail, name="order_detail"),
    path("stats/", panel.stats, name="stats"),

    path("colors/", panel.colors, name="colors"),
    path("devices/", panel.devices, name="devices"),
    path("devices/new/", panel.device_form, name="device_add"),
    path("devices/<int:pk>/", panel.device_form, name="device_edit"),
    path("ai/", panel.ai, name="ai"),
    path("looks/", panel.looks, name="looks"),
    path("sessions/", panel.sessions, name="sessions"),
    path("users/", panel.users, name="users"),
    path("users/new/", panel.user_form, name="user_add"),
    path("users/<int:pk>/", panel.user_form, name="user_edit"),
]
