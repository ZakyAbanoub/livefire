from django.shortcuts import get_object_or_404
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from notes.models import Note

from .models import Membership, Org
from .permissions import IsOrgOwner


class OrgStatsView(APIView):
    permission_classes = [IsAuthenticated, IsOrgOwner]

    def get(self, request, org_id):
        return Response(
            {
                "org": org_id,
                "members": Membership.objects.filter(org_id=org_id).count(),
                "notes": Note.objects.filter(org_id=org_id).count(),
            }
        )


class OrgPurgeView(APIView):
    """Delete every note of an organization."""

    permission_classes = [AllowAny]

    def post(self, request, org_id):
        org = get_object_or_404(Org, pk=org_id)
        deleted, _ = Note.objects.filter(org=org).delete()
        return Response({"org": org.id, "deleted": deleted})
