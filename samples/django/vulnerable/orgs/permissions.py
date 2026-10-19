from rest_framework.permissions import BasePermission

from .models import Membership


class IsOrgMember(BasePermission):
    """The caller belongs to the organization named by the `org_id` URL kwarg."""

    message = "You are not a member of this organization."
    required_role = None

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        membership = (
            Membership.objects.select_related("org")
            .filter(user=user, org_id=view.kwargs.get("org_id"))
            .first()
        )
        if membership is None:
            return False
        if self.required_role and membership.role != self.required_role:
            return False
        view.membership = membership
        return True


class IsOrgOwner(IsOrgMember):
    message = "Only an owner of this organization can do this."
    required_role = Membership.OWNER
