# django sample — livefire answer key

A small multi-tenant notes API (Django 5.1 + Django REST Framework 3.15 + Postgres 16, DRF
`TokenAuthentication`) built to the domain in [`../SPEC.md`](../SPEC.md). `vulnerable/` carries
the five seeded holes; `clean/` is the same app with only those five spots fixed
(`diff -ru vulnerable clean` shows nothing else — five files, one hunk per hole plus the
matching import lines).

This file and `ANSWERS.json` are the ONLY places the holes are named — never copy them into an
app root.

## Ports and seed

| service  | host port | notes |
|----------|-----------|-------|
| app      | 18012     | `GET /health` (gunicorn, 2 workers) |
| Postgres | 15412     | db `notes`, user `notes` / `notes` |

Seed (re-applied on every app start by `python manage.py seed` —
`orgs/management/commands/seed.py` — which truncates and re-inserts): alice@acme.test (owner,
Acme = org 1), bob@acme.test (member, Acme), carol@globex.test (owner, Globex = org 2), all with
password `password1`; notes 1–2 in Acme by alice, note 3 in Globex by carol; each user has a
random `api_token` (`nt_` + 48 hex). Tables are `orgs`, `users` (the custom user model; the
password column is `password_hash`), `memberships`, `notes`, plus DRF's `authtoken_token`.

## Run

Use a per-variant compose project name (`-p` or `COMPOSE_PROJECT_NAME`; `selftest.sh` calls
plain `docker compose`, so export the variable rather than passing `-p` only to `up`):

```sh
cd vulnerable                                   # or clean — never both at once (same ports)
export COMPOSE_PROJECT_NAME=lf-django-vulnerable # lf-django-clean for clean/
docker compose up -d --build --wait
./selftest.sh            # vulnerable: H1..H5 LANDED + HAPPY OK;  clean: H1..H5 REFUSED + HAPPY OK
docker compose down -v
```

`selftest.sh` re-seeds before and after, drives every case over HTTP as the named actor and
confirms it with a direct `psql` read (`docker compose exec -T db psql …`), not the status code.
It picks the expected outcome from the directory name and exits 0 only on a full match. The
happy path covers: alice creates / reads / updates a note in Acme, bob lists Acme notes and
reads note 1, alice lists Acme members, bob lists teammates, bob reads his own token via `/me`,
alice reads Acme stats, and carol (owner of Globex) purges Globex.

## Hole → location → fix

Line numbers are in `vulnerable/`.

| id | family | location | the bug | wrong actor | fix in `clean/` |
|----|--------|----------|---------|-------------|-----------------|
| H1 | anon-privileged-op | `orgs/admin_views.py:28` (`OrgPurgeView`, `POST /admin/orgs/<org_id>/purge`) | `permission_classes = [AllowAny]` overrides the project-wide `IsAuthenticated` default — no authentication and no owner check before `Note.objects.filter(org=org).delete()` | anon | `permission_classes = [IsAuthenticated, IsOrgOwner]` |
| H2 | write-guard-gap | `notes/serializers.py:16` (`NoteUpdateSerializer`, used by `NoteViewSet` for `PATCH`/`PUT /notes/<id>`) | `org` is a writable field; `CanEditNote.has_object_permission` only checks membership in the note's CURRENT org, never the destination → mass-assignment moves the note to another tenant | bob (member) → note 2 `org_id` 1→2 | field allowlist: `fields = ["id", "title", "body", "updated_at"]` |
| H3 | missing-guard | `orgs/views.py:22` (`OrgMemberListView`, `GET /orgs/<org_id>/members`) | `permission_classes = [AllowAny]` — returns member ids, emails and roles to anyone | anon (also carol) | `permission_classes = [IsAuthenticated, IsOrgMember]` |
| H4 | idor-unscoped-query | `notes/views.py:32` (`NoteViewSet.get_queryset`, `GET /notes/<id>`) | `get_queryset` returns `Note.objects.all()`; `CanEditNote` lets `SAFE_METHODS` through (reads are meant to be scoped by the queryset), so `retrieve` serves any note to any authenticated user. The list endpoint (`OrgNoteListCreateView`) is correctly scoped | carol (outsider) reads note 1 | `Note.objects.filter(org__memberships__user=self.request.user)` → 404 |
| H5 | secret-over-share | `accounts/serializers.py:35` (`TeammateSerializer`, `GET /users`) | `fields = "__all__"` on the user model serializes every column (`api_token`, and also `password` = the PBKDF2 hash, `last_login`) of every org-mate | bob reads alice's `api_token` | `fields = ["id", "email", "memberships"]` |

Correctly guarded endpoints that must NOT be reported on either twin: `POST /auth/login`
(`AllowAny` by design — it is the login), `GET /health` (plain Django view, no data),
`GET /me` and `POST /me/api-token` (own row only), `GET /orgs` (own memberships),
`GET|POST /orgs/<org_id>/notes` (`IsAuthenticated` + `IsOrgMember`; create forces
`org`/`author` server-side), `DELETE /notes/<id>` (`CanEditNote`: membership + author-or-owner),
`GET /admin/orgs/<org_id>/stats` (`IsOrgOwner`).

Notes on the fixes:

- H2 and H4 are independent. With H4 fixed (`clean/`), bob can still reach note 2 (he is an Acme
  member), so the H2 test still exercises the serializer; with H2 fixed, `org` in the PATCH body
  is silently ignored (DRF drops unknown fields) and the row keeps `org_id = 1` — `selftest.sh`
  checks the row, not the status.
- In `clean/`, H4's scoped queryset also applies to `PATCH`/`DELETE`, so an outsider gets 404
  instead of 403 there; that is a side effect of the same one-line fix.
- H5's root cause also over-shares the password hash; it is the same bug and the same fix, so it
  counts as H5, not as an extra finding. `DJANGO_SECRET_KEY` (`dev-secret-key-change-me`, also
  the `settings.py` default) is a local-dev value shipped identically in both twins.

## Score a livefire run

```sh
samples/prepare-run.sh django vulnerable   # blind copy + Workflow args (clean likewise)
node samples/score.mjs <result.json> samples/django/ANSWERS.json          # vulnerable
node samples/score.mjs <result.json> samples/django/ANSWERS.json --clean  # clean
```
