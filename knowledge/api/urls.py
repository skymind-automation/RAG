from django.urls import path

from knowledge.api import views

app_name = "knowledge"

urlpatterns = [
    path("retrieve", views.retrieve, name="retrieve"),
    path("dtc/search", views.dtc_search, name="dtc-search"),
    path("dtc/<str:code>", views.dtc_detail, name="dtc-detail"),
    path("healthz", views.healthz, name="healthz"),
]
