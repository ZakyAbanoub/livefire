from django.conf import settings
from django.db import models


class Org(models.Model):
    name = models.CharField(max_length=200)

    class Meta:
        db_table = "orgs"
        ordering = ["id"]

    def __str__(self):
        return self.name


class Membership(models.Model):
    OWNER = "owner"
    MEMBER = "member"
    ROLE_CHOICES = [(OWNER, "Owner"), (MEMBER, "Member")]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="memberships"
    )
    org = models.ForeignKey(Org, on_delete=models.CASCADE, related_name="memberships")
    role = models.CharField(max_length=16, choices=ROLE_CHOICES, default=MEMBER)

    class Meta:
        db_table = "memberships"
        constraints = [
            models.UniqueConstraint(fields=["user", "org"], name="memberships_user_org_unique"),
        ]

    def __str__(self):
        return f"{self.user} in {self.org} ({self.role})"
