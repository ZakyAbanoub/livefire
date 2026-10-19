from django.urls import path
from rest_framework.routers import SimpleRouter

from . import views

router = SimpleRouter(trailing_slash=False)
router.register("notes", views.NoteViewSet, basename="note")

urlpatterns = [
    path("orgs/<int:org_id>/notes", views.OrgNoteListCreateView.as_view()),
    *router.urls,
]
