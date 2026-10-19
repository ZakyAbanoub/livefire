from django.urls import path

from . import views

urlpatterns = [
    path("auth/login", views.LoginView.as_view()),
    path("me", views.MeView.as_view()),
    path("me/api-token", views.RotateApiTokenView.as_view()),
    path("users", views.TeammateListView.as_view()),
]
