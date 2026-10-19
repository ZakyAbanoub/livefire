#!/usr/bin/env bash
# Ground-truth check against the running stack (docker compose up -d --build --wait).
# Every access-control case is driven over HTTP as a specific actor and confirmed with a
# direct Postgres read, never by the HTTP status alone.
set -uo pipefail
cd "$(dirname "$0")"

case "$(basename "$(pwd)")" in
  vulnerable) EXPECT=LANDED ;;
  clean) EXPECT=REFUSED ;;
  *) echo "run from samples/express/vulnerable or samples/express/clean" >&2; exit 2 ;;
esac

BASE="${BASE_URL:-http://localhost:18010}"
JSON='content-type: application/json'

sql() { docker compose exec -T db psql -U notes -d notes -tAc "$1"; }
login() {
  curl -s -X POST "$BASE/auth/login" -H "$JSON" -d "{\"email\":\"$1\",\"password\":\"password1\"}" \
    | sed -n 's/.*"token":"\([^"]*\)".*/\1/p'
}
has() { [ -n "$2" ] && printf '%s' "$1" | grep -qF -- "$2"; }

# Fresh seed so the run is repeatable.
docker compose exec -T app node prisma/seed.js >/dev/null || { echo "reseed failed" >&2; exit 2; }

ALICE=$(login alice@acme.test); BOB=$(login bob@acme.test); CAROL=$(login carol@globex.test)
if [ -z "$ALICE" ] || [ -z "$BOB" ] || [ -z "$CAROL" ]; then echo "login failed" >&2; exit 2; fi

# ---- happy path: alice creates, reads and updates a note in Acme; normal listings work ----
HAPPY=OK; WHY=""
CREATED=$(curl -s -X POST "$BASE/orgs/1/notes" -H "Authorization: Bearer $ALICE" -H "$JSON" \
  -d '{"title":"Standup","body":"Standup notes for Monday."}')
NID=$(printf '%s' "$CREATED" | sed -n 's/^{"id":\([0-9]*\).*/\1/p')
if [ -z "$NID" ] || [ "$(sql "select org_id from notes where id=$NID")" != "1" ]; then HAPPY=FAIL; WHY="$WHY create;"; fi
if [ -n "$NID" ]; then
  READ=$(curl -s "$BASE/notes/$NID" -H "Authorization: Bearer $ALICE")
  has "$READ" "Standup notes for Monday." || { HAPPY=FAIL; WHY="$WHY read;"; }
  curl -s -o /dev/null -X PATCH "$BASE/notes/$NID" -H "Authorization: Bearer $ALICE" -H "$JSON" \
    -d '{"title":"Standup (edited)"}'
  [ "$(sql "select title || '|' || org_id from notes where id=$NID")" = "Standup (edited)|1" ] || { HAPPY=FAIL; WHY="$WHY update;"; }
fi
LIST=$(curl -s "$BASE/orgs/1/notes" -H "Authorization: Bearer $BOB")
has "$LIST" "$(sql "select title from notes where id=1")" || { HAPPY=FAIL; WHY="$WHY list-notes;"; }
MEMBERS=$(curl -s "$BASE/orgs/1/members" -H "Authorization: Bearer $ALICE")
has "$MEMBERS" "bob@acme.test" || { HAPPY=FAIL; WHY="$WHY members;"; }
MATES=$(curl -s "$BASE/users" -H "Authorization: Bearer $BOB")
has "$MATES" "alice@acme.test" || { HAPPY=FAIL; WHY="$WHY teammates;"; }
ME=$(curl -s "$BASE/me" -H "Authorization: Bearer $BOB")
has "$ME" "$(sql "select api_token from users where email='bob@acme.test'")" || { HAPPY=FAIL; WHY="$WHY own-token;"; }

# ---- H3: anon (and outsider carol) list Acme's members ----
ALICE_EMAIL=$(sql "select u.email from users u join memberships m on m.user_id=u.id where m.org_id=1 and m.role='owner'")
H3=REFUSED
has "$(curl -s "$BASE/orgs/1/members")" "$ALICE_EMAIL" && H3=LANDED
has "$(curl -s "$BASE/orgs/1/members" -H "Authorization: Bearer $CAROL")" "$ALICE_EMAIL" && H3=LANDED

# ---- H5: bob (member) reads alice's api_token ----
ALICE_TOKEN=$(sql "select api_token from users where email='alice@acme.test'")
H5=REFUSED
has "$(curl -s "$BASE/users" -H "Authorization: Bearer $BOB")" "$ALICE_TOKEN" && H5=LANDED
has "$(curl -s "$BASE/orgs/1/members" -H "Authorization: Bearer $BOB")" "$ALICE_TOKEN" && H5=LANDED

# ---- H4: outsider carol reads Acme note 1 ----
NOTE1_BODY=$(sql "select body from notes where id=1")
H4=REFUSED
has "$(curl -s "$BASE/notes/1" -H "Authorization: Bearer $CAROL")" "$NOTE1_BODY" && H4=LANDED

# ---- H2: bob (member) moves Acme note 2 into Globex ----
H2=REFUSED
if [ "$(sql "select org_id from notes where id=2")" = "1" ]; then
  curl -s -o /dev/null -X PATCH "$BASE/notes/2" -H "Authorization: Bearer $BOB" -H "$JSON" \
    -d '{"title":"Vendor contacts","orgId":2}'
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
  curl -s -o /dev/null -X POST "$BASE/admin/orgs/1/purge" -H "Authorization: Bearer $BOB"
  [ "$(sql "select count(*) from notes where org_id=1")" = "0" ] && H1=LANDED
fi

# ---- happy path (owner-only op): carol, owner of Globex, purges Globex ----
curl -s -o /dev/null -X POST "$BASE/admin/orgs/2/purge" -H "Authorization: Bearer $CAROL"
[ "$(sql "select count(*) from notes where org_id=2")" = "0" ] || { HAPPY=FAIL; WHY="$WHY owner-purge;"; }

# Leave the database as seeded.
docker compose exec -T app node prisma/seed.js >/dev/null

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
