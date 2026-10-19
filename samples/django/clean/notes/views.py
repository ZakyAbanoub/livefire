from rest_framework import mixins, viewsets
from rest_framework.generics import ListCreateAPIView
from rest_framework.permissions import IsAuthenticated

from orgs.permissions import IsOrgMember

from .models import Note
from .permissions import CanEditNote
from .serializers import NoteSerializer, NoteUpdateSerializer


class OrgNoteListCreateView(ListCreateAPIView):
    serializer_class = NoteSerializer
    permission_classes = [IsAuthenticated, IsOrgMember]

    def get_queryset(self):
        return Note.objects.filter(org_id=self.kwargs["org_id"]).order_by("id")

    def perform_create(self, serializer):
        serializer.save(org=self.membership.org, author=self.request.user)


class NoteViewSet(
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    permission_classes = [IsAuthenticated, CanEditNote]

    def get_queryset(self):
        return Note.objects.filter(org__memberships__user=self.request.user)

    def get_serializer_class(self):
        if self.action in ("update", "partial_update"):
            return NoteUpdateSerializer
        return NoteSerializer
