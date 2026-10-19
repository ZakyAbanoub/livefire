from rest_framework.permissions import SAFE_METHODS, BasePermission

from orgs.models import Membership


class CanEditNote(BasePermission):
    """Members of the note's organization may edit it; the author or an owner may delete it."""

    message = "You cannot change this note."

    def has_object_permission(self, request, view, obj):
        if request.method in SAFE_METHODS:
            return True
        membership = Membership.objects.filter(user=request.user, org_id=obj.org_id).first()
        if membership is None:
            return False
        if request.method == "DELETE":
            return obj.author_id == request.user.id or membership.role == Membership.OWNER
        return True
