from rest_framework.generics import ListAPIView
from rest_framework.permissions import AllowAny, IsAuthenticated

from .models import Membership
from .serializers import MemberSerializer, MyOrgSerializer


class MyOrgListView(ListAPIView):
    serializer_class = MyOrgSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return (
            Membership.objects.filter(user=self.request.user)
            .select_related("org")
            .order_by("org_id")
        )


class OrgMemberListView(ListAPIView):
    serializer_class = MemberSerializer
    permission_classes = [AllowAny]

    def get_queryset(self):
        return (
            Membership.objects.filter(org_id=self.kwargs["org_id"])
            .select_related("user")
            .order_by("user_id")
        )
