from django.core.management.base import BaseCommand
from django.db import connection, transaction

from accounts.models import User
from notes.models import Note
from orgs.models import Membership, Org


class Command(BaseCommand):
    help = "Reset the database to the demo data set (truncates every table first)."

    @transaction.atomic
    def handle(self, *args, **options):
        with connection.cursor() as cursor:
            cursor.execute(
                "TRUNCATE notes, memberships, authtoken_token, users, orgs RESTART IDENTITY CASCADE"
            )

        acme = Org.objects.create(name="Acme")
        globex = Org.objects.create(name="Globex")

        alice = User.objects.create_user("alice@acme.test", "password1")
        bob = User.objects.create_user("bob@acme.test", "password1")
        carol = User.objects.create_user("carol@globex.test", "password1")

        Membership.objects.bulk_create(
            [
                Membership(user=alice, org=acme, role=Membership.OWNER),
                Membership(user=bob, org=acme, role=Membership.MEMBER),
                Membership(user=carol, org=globex, role=Membership.OWNER),
            ]
        )

        Note.objects.create(
            org=acme,
            author=alice,
            title="Q3 roadmap",
            body="Acme roadmap: ship the billing revamp before October.",
        )
        Note.objects.create(
            org=acme,
            author=alice,
            title="Vendor contacts",
            body="Acme vendor list: Initech (hardware), Hooli (cloud).",
        )
        Note.objects.create(
            org=globex,
            author=carol,
            title="Globex kickoff",
            body="Globex kickoff agenda: hiring plan and budget.",
        )

        self.stdout.write("seeded: orgs=2 users=3 memberships=3 notes=3")
