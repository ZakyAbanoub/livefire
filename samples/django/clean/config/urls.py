from django.http import JsonResponse
from django.urls import include, path


def health(request):
    return JsonResponse({"status": "ok"})


urlpatterns = [
    path("health", health),
    path("", include("accounts.urls")),
    path("", include("orgs.urls")),
    path("", include("notes.urls")),
]
