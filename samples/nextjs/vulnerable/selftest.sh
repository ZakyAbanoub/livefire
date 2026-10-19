#!/usr/bin/env bash
# Ground-truth check against the running stack (Postgres via docker compose, the Next app via
# `npm start` on the host). Every access-control case is driven over HTTP as a specific actor
# and confirmed with a direct Postgres read (or the rendered HTML for reads), never by the
# HTTP status alone.
#
# H2 (mass-assignment through the updateNote Server Action) is NOT driven here: reaching it
# needs the per-build action id. It is listed as SKIPPED and does not affect the exit code.
set -uo pipefail
cd "$(dirname "$0")"

case "$(basename "$(pwd)")" in
  vulnerable) EXPECT=LANDED ;;
  clean) EXPECT=REFUSED ;;
  *) echo "run from samples/nextjs/vulnerable or samples/nextjs/clean" >&2; exit 2 ;;
esac

BASE="${BASE_URL:-http://127.0.0.1:18024}"
JSON='content-type: application/json'
JAR="$(mktemp -d)"
trap 'rm -rf "$JAR"' EXIT

sql() { docker compose exec -T db psql -U notes -d notes -tAc "$1"; }
reseed() { node prisma/seed.mjs >/dev/null; }
# login <actor> <email>: stores the session cookie in $JAR/<actor>
login() {
  curl -s -o /dev/null -c "$JAR/$1" -X POST "$BASE/api/auth/login" -H "$JSON" \
    -d "{\"email\":\"$2\",\"password\":\"password1\"}"
  grep -q 'session' "$JAR/$1" 2>/dev/null
}
as() { local who="$1"; shift; curl -s -b "$JAR/$who" "$@"; }
has() { [ -n "$2" ] && printf '%s' "$1" | grep -qF -- "$2"; }

curl -s -o /dev/null "$BASE/login" || { echo "app not reachable at $BASE" >&2; exit 2; }

# Fresh seed so the run is repeatable.
reseed || { echo "reseed failed" >&2; exit 2; }

login alice alice@acme.test && login bob bob@acme.test && login carol carol@globex.test \
  || { echo "login failed" >&2; exit 2; }

# ---- happy path + guarded surfaces ----
HAPPY=OK; WHY=""
NOTE1_TITLE=$(sql "select title from notes where id=1")
NOTE1_BODY=$(sql "select body from notes where id=1")
has "$(as alice "$BASE/notes/1")" "$NOTE1_BODY" || { HAPPY=FAIL; WHY="$WHY read-note;"; }
has "$(as bob "$BASE/orgs/1")" "$NOTE1_TITLE" || { HAPPY=FAIL; WHY="$WHY list-notes;"; }
has "$(as alice "$BASE/api/orgs/1/members")" "bob@acme.test" || { HAPPY=FAIL; WHY="$WHY members;"; }
has "$(as bob "$BASE/api/users")" "alice@acme.test" || { HAPPY=FAIL; WHY="$WHY teammates;"; }
has "$(as bob "$BASE/api/me")" "$(sql "select api_token from users where email='bob@acme.test'")" || { HAPPY=FAIL; WHY="$WHY own-token;"; }
has "$(as alice "$BASE/api/admin/orgs/1/stats")" '"notes":2' || { HAPPY=FAIL; WHY="$WHY owner-stats;"; }
# guarded surfaces refuse the wrong actor
[ "$(as bob -o /dev/null -w '%{http_code}' "$BASE/api/admin/orgs/1/stats")" = "403" ] || { HAPPY=FAIL; WHY="$WHY member-stats-not-refused;"; }
[ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/me")" = "401" ] || { HAPPY=FAIL; WHY="$WHY anon-me-not-refused;"; }
[ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/orgs/1")" = "307" ] || { HAPPY=FAIL; WHY="$WHY anon-page-not-redirected;"; }
has "$(as carol "$BASE/orgs/1")" "$NOTE1_TITLE" && { HAPPY=FAIL; WHY="$WHY outsider-sees-org-page;"; }

# ---- H3: anon (and outsider carol) list Acme's members ----
ALICE_EMAIL=$(sql "select u.email from users u join memberships m on m.user_id=u.id where m.org_id=1 and m.role='owner'")
H3=REFUSED
has "$(curl -s "$BASE/api/orgs/1/members")" "$ALICE_EMAIL" && H3=LANDED
has "$(as carol "$BASE/api/orgs/1/members")" "$ALICE_EMAIL" && H3=LANDED

# ---- H5: bob (member) reads alice's api_token ----
ALICE_TOKEN=$(sql "select api_token from users where email='alice@acme.test'")
H5=REFUSED
has "$(as bob "$BASE/api/users")" "$ALICE_TOKEN" && H5=LANDED
has "$(as bob "$BASE/api/orgs/1/members")" "$ALICE_TOKEN" && H5=LANDED

# ---- H4: outsider carol renders Acme note 1 (Server Component page) ----
H4=REFUSED
has "$(as carol "$BASE/notes/1")" "$NOTE1_BODY" && H4=LANDED

# ---- H1: anon (then member bob) purges Acme's notes ----
H1=REFUSED
[ "$(sql "select count(*) from notes where org_id=1")" -gt 0 ] || { echo "precondition failed: org 1 has no notes" >&2; exit 2; }
curl -s -o /dev/null -X POST "$BASE/api/admin/orgs/1/purge"
[ "$(sql "select count(*) from notes where org_id=1")" = "0" ] && H1=LANDED
if [ "$H1" = REFUSED ]; then
  as bob -o /dev/null -X POST "$BASE/api/admin/orgs/1/purge"
  [ "$(sql "select count(*) from notes where org_id=1")" = "0" ] && H1=LANDED
fi

# ---- happy path (owner-only op): carol, owner of Globex, purges Globex ----
as carol -o /dev/null -X POST "$BASE/api/admin/orgs/2/purge"
[ "$(sql "select count(*) from notes where org_id=2")" = "0" ] || { HAPPY=FAIL; WHY="$WHY owner-purge;"; }

# ---- happy path: logout deletes the session row and the cookie stops working ----
SESSIONS_BEFORE=$(sql "select count(*) from sessions s join users u on u.id=s.user_id where u.email='alice@acme.test'")
as alice -o /dev/null -X POST "$BASE/api/auth/logout"
SESSIONS_AFTER=$(sql "select count(*) from sessions s join users u on u.id=s.user_id where u.email='alice@acme.test'")
[ "$SESSIONS_AFTER" -lt "$SESSIONS_BEFORE" ] || { HAPPY=FAIL; WHY="$WHY logout-row;"; }
[ "$(as alice -o /dev/null -w '%{http_code}' "$BASE/api/me")" = "401" ] || { HAPPY=FAIL; WHY="$WHY logout-cookie;"; }

# Leave the database as seeded.
reseed

echo "H1 $H1"
echo "H2 SKIPPED (Server Action; not driven by this script)"
echo "H3 $H3"
echo "H4 $H4"
echo "H5 $H5"
echo "HAPPY $HAPPY${WHY:+ ($WHY )}"

STATUS=0
for r in "$H1" "$H3" "$H4" "$H5"; do [ "$r" = "$EXPECT" ] || STATUS=1; done
[ "$HAPPY" = OK ] || STATUS=1
echo "expected: H1 H3 H4 H5 all $EXPECT + HAPPY OK -> $([ $STATUS -eq 0 ] && echo PASS || echo FAIL)"
exit $STATUS
