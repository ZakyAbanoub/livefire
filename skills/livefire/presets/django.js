// livefire preset — Django (+ Django REST Framework).
//
// Python's #1 for data apps. Authz: DRF permission classes (IsAuthenticated, object-level
// has_object_permission), Django's auth/permissions, and queryset scoping in views
// (get_queryset filtering by request.user). Family B (authz in code); ground truth via a direct
// DB read (raw SQL / a second connection bypassing the ORM manager).

import { APP_TIER_INVENTORY_SCHEMA, APP_TIER_UNITS_INSTRUCTION } from '../src/inventory.js'

export const djangoAdapter = {
  id: 'django',

  detect(repo) {
    const files = (repo && repo.files) || []
    const txt = ((repo && repo.manifestText) || {})
    const inReqs = /(^|\n)\s*django\b/i.test(txt['requirements.txt'] || '') || /django/i.test(txt['pyproject.toml'] || '')
    return files.includes('manage.py') || inReqs
  },

  repoContext: 'A Django app (often with Django REST Framework). Authorization lives in CODE: DRF permission_classes (IsAuthenticated, custom has_object_permission), Django auth/permissions, and queryset scoping in views (`get_queryset` filtering by `request.user`). Wrong actors: an unauthenticated request, an authenticated user with zero membership in the target tenant, and an authenticated user with the wrong role/group.',

  db: 'Reach the LOCAL dev DB from settings.py/`.env` (Postgres/MySQL/sqlite) — disposable only. Use a direct DB connection (raw SQL via `django.db.connection`, or a second client) to plant fixtures and run the confirming read, BYPASSING model managers/default querysets — that raw read is the ground truth.',

  actors: 'Build three actor sessions: (1) ANONYMOUS — no session/token; (2) OUTSIDER — an authenticated user (`force_authenticate`/login) with zero membership in the target tenant; (3) INSIDER-WRONG-ROLE — an authenticated user in the wrong group/role. Drive via the DRF APIClient or real HTTP. Plus a direct DB connection for planting + confirming.',

  inventorySql: 'Authorization is in code (DB-grant enumeration is n/a — say so). Enumerate: (a) every view/ViewSet → its permission_classes + object-level has_object_permission AND its get_queryset scoping — FLAG views with AllowAny or no object check that touch tenant data; (b) every ORM query loading by a request-supplied id WITHOUT a user/tenant filter (`Model.objects.get(pk=...)` instead of `request.user.models.get(...)`); (c) ModelForms/serializers whose fields include ownership/tenant columns (mass-assignment). Return each as a unit with its guard + whether a wrong actor reaches it.' + ' ' + APP_TIER_UNITS_INSTRUCTION,

  inventorySchema: APP_TIER_INVENTORY_SCHEMA,

  testCmd: 'python manage.py test',

  emitTestHint: 'Write a DRF APITestCase hitting the endpoint as each wrong actor and asserting refused, PAIRED with a direct DB read (raw SQL via connection.cursor()) confirming the row is unchanged — bypassing managers so the read is ground truth. RED-first.',
}
