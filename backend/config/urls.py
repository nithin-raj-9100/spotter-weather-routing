from django.urls import path, re_path
from routing import views

urlpatterns = [
    path("api/health", views.health),
    path("api/places", views.places),
    path("api/plan", views.plan),
    re_path(r"^(?!api/).*$", views.frontend),
]
