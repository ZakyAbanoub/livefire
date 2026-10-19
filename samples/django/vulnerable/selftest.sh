#!/usr/bin/env bash
# Ground-truth check against the running stack (docker compose up -d --build --wait).
# Every access-control case is driven over HTTP as a specific actor and confirmed with a
# direct Postgres read, never by the HTTP status alone.
# Honours COMPOSE_PROJECT_NAME (e.g. lf-django-vulnerable) like every other `docker compose` call.
set -uo pipefail
cd "$(dirname "$0")"

case "$(basename "$(pwd)")" in
  vulnerable) EXPECT=LANDED ;;
  clean) EXPECT=REFUSED ;;
  *) echo "run from samples/django/vulnerable or samples/django/clean" >&2; exit 2 ;;
esac

BASE="${BASE_URL:-http://localhost:18012}"
JSON='content-type: application/json'

sql() { docker compose exec -T db psql -U notes -d notes -tAc "$1"; }
reseed() { docker compose exec -T app python manage.py seed >/dev/null; }
login() {
  curl -s -X POST "$BASE/auth/login" -H "$JSON" -d "{\"email\":\"$1\",\"password\":\"password1\"}" \
    | sed -n 's/.*"token":"\([^"]*\)".*/\1/p'
}
has() { [ -n "$2" ] && printf '%s' "$1" | grep -qF -- "$2"; }

# Fresh seed so the run is repeatable.
reseed || { echo "reseed failed" >&2; exit 2; }

ALICE=$(login alice@acme.test); BOB=$(login bob@acme.test); CAROL=$(login carol@globex.test)
if [ -z "$ALICE" ] || [ -z "$BOB" ] || [ -z "$CAROL" ]; then echo "login failed" >&2; exit 2; fi
AUTH_A="Authorization: Token $ALICE"; AUTH_B="Authorization: Token $BOB"; AUTH_C="Authorization: Token $CAROL"

# ---- happy path: alice creates, reads and updates a note in Acme; normal listings work ----
HAPPY=OK; WHY=""
CREATED=$(curl -s -X POST "$BASE/orgs/1/notes" -H "$AUTH_A" -H "$JSON" \
  -d '{"title":"Standup","body":"Standup notes for Monday."}')
NID=$(printf '%s' "$CREATED" | sed -n 's/^{"id":\([0-9]*\).*/\1/p')
if [ -z "$NID" ] || [ "$(sql "select org_id || '|' || author_id from notes where id=$NID")" != "1|1" ]; then HAPPY=FAIL; WHY="$WHY create;"; fi
if [ -n "$NID" ]; then
  READ=$(curl -s "$BASE/notes/$NID" -H "$AUTH_A")
  has "$READ" "Standup notes for Monday." || { HAPPY=FAIL; WHY="$WHY read;"; }
  curl -s -o /dev/null -X PATCH "$BASE/notes/$NID" -H "$AUTH_A" -H "$JSON" \
    -d '{"title":"Standup (edited)"}'
  [ "$(sql "select title || '|' || org_id from notes where id=$NID")" = "Standup (edited)|1" ] || { HAPPY=FAIL; WHY="$WHY update;"; }
fi
LIST=$(curl -s "$BASE/orgs/1/notes" -H "$AUTH_B")
has "$LIST" "$(sql "select title from notes where id=1")" || { HAPPY=FAIL; WHY="$WHY list-notes;"; }
has "$(curl -s "$BASE/notes/1" -H "$AUTH_B")" "$(sql "select body from notes where id=1")" || { HAPPY=FAIL; WHY="$WHY member-read;"; }
MEMBERS=$(curl -s "$BASE/orgs/1/members" -H "$AUTH_A")
has "$MEMBERS" "bob@acme.test" || { HAPPY=FAIL; WHY="$WHY members;"; }
MATES=$(curl -s "$BASE/users" -H "$AUTH_B")
has "$MATES" "alice@acme.test" || { HAPPY=FAIL; WHY="$WHY teammates;"; }
ME=$(curl -s "$BASE/me" -H "$AUTH_B")
has "$ME" "$(sql "select api_token from users where email='bob@acme.test'")" || { HAPPY=FAIL; WHY="$WHY own-token;"; }
STATS=$(curl -s "$BASE/admin/orgs/1/stats" -H "$AUTH_A")
has "$STATS" '"members":2' || { HAPPY=FAIL; WHY="$WHY owner-stats;"; }

# ---- H3: anon (and outsider carol) list Acme's members ----
ALICE_EMAIL=$(sql "select u.email from users u join memberships m on m.user_id=u.id where m.org_id=1 and m.role='owner'")
H3=REFUSED
has "$(curl -s "$BASE/orgs/1/members")" "$ALICE_EMAIL" && H3=LANDED
has "$(curl -s "$BASE/orgs/1/members" -H "$AUTH_C")" "$ALICE_EMAIL" && H3=LANDED

# ---- H5: bob (member) reads alice's api_token ----
ALICE_TOKEN=$(sql "select api_token from users where email='alice@acme.test'")
H5=REFUSED
has "$(curl -s "$BASE/users" -H "$AUTH_B")" "$ALICE_TOKEN" && H5=LANDED
has "$(curl -s "$BASE/orgs/1/members" -H "$AUTH_B")" "$ALICE_TOKEN" && H5=LANDED

# ---- H4: outsider carol reads Acme note 1 ----
NOTE1_BODY=$(sql "select body from notes where id=1")
H4=REFUSED
has "$(curl -s "$BASE/notes/1" -H "$AUTH_C")" "$NOTE1_BODY" && H4=LANDED

# ---- H2: bob (member) moves Acme note 2 into Globex ----
H2=REFUSED
if [ "$(sql "select org_id from notes where id=2")" = "1" ]; then
  curl -s -o /dev/null -X PATCH "$BASE/notes/2" -H "$AUTH_B" -H "$JSON" \
    -d '{"title":"Vendor contacts","org":2}'
  [ "$(sql "select org_id from notes where id=2")" = "2" ] && H2=LANDED
else
  echo "precondition failed: note 2 not in org 1" >&2; exit 2
fi

# ---- H1: anon (then member bob) purges Acme's notes ----
H1=REFUSED
[ "$(sql "select count(*) from notes where org_id=1")" -gt 0 ] || { echo "precondition failed: org 1 has no notes" >&2; exit 2; }
curl -s -o /dev/null -X POST "$BASE/admin/orgs/1/purge"
[ "$(sql "select count(*) from notes where org_id=1")" = "0" ] && H1=LANDED
if [ "$H1" = REFUSED ]; then
  curl -s -o /dev/null -X POST "$BASE/admin/orgs/1/purge" -H "$AUTH_B"
  [ "$(sql "select count(*) from notes where org_id=1")" = "0" ] && H1=LANDED
fi

# ---- happy path (owner-only op): carol, owner of Globex, purges Globex ----
reseed
CAROL=$(login carol@globex.test)
curl -s -o /dev/null -X POST "$BASE/admin/orgs/2/purge" -H "Authorization: Token $CAROL"
[ "$(sql "select count(*) from notes where org_id=2")" = "0" ] || { HAPPY=FAIL; WHY="$WHY owner-purge;"; }

# Leave the database as seeded.
reseed

echo "H1 $H1"
echo "H2 $H2"
echo "H3 $H3"
echo "H4 $H4"
echo "H5 $H5"
echo "HAPPY $HAPPY${WHY:+ ($WHY )}"

STATUS=0
for r in "$H1" "$H2" "$H3" "$H4" "$H5"; do [ "$r" = "$EXPECT" ] || STATUS=1; done
[ "$HAPPY" = OK ] || STATUS=1
echo "expected: all $EXPECT + HAPPY OK -> $([ $STATUS -eq 0 ] && echo PASS || echo FAIL)"
exit $STATUS
