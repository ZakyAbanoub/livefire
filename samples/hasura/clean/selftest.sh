#!/usr/bin/env bash
# Ground-truth check for this sample (see samples/SPEC.md). Run from the app root with the stack up:
#   docker compose -p lf-hasura-$(basename "$PWD") up -d --build && ./selftest.sh
# Each seeded case is exploited over GraphQL as the named wrong actor and confirmed with a direct
# Postgres read (never the HTTP status). Exit 0 iff every case LANDED (vulnerable/) or every case
# was REFUSED (clean/), and the happy path works.
set -uo pipefail
cd "$(dirname "$0")"

VARIANT="$(basename "$PWD")"
case "$VARIANT" in
  vulnerable) EXPECT=LANDED ;;
  clean) EXPECT=REFUSED ;;
  *) echo "run from samples/hasura/{vulnerable,clean}" >&2; exit 2 ;;
esac
PROJECT="${COMPOSE_PROJECT_NAME:-lf-hasura-$VARIANT}"
GQL="${GQL_URL:-http://localhost:18022/v1/graphql}"
SEED=migrations/default/1726000000100_seed_data/up.sql

command -v jq >/dev/null || { echo "jq is required" >&2; exit 2; }

psql_q() { docker compose -p "$PROJECT" exec -T postgres psql -U notes -d notes -tAX -c "$1"; }

reset_db() {
  psql_q "TRUNCATE public.notes, public.memberships, public.users, public.orgs RESTART IDENTITY CASCADE" >/dev/null
  docker compose -p "$PROJECT" exec -T postgres psql -U notes -d notes -q -v ON_ERROR_STOP=1 >/dev/null < "$SEED"
}

# gql <token-or-empty> <query> [variables-json]
gql() {
  local token="$1" query="$2" vars="${3:-}"
  [ -n "$vars" ] || vars='{}'
  local body; body="$(jq -nc --arg q "$query" --argjson v "$vars" '{query:$q, variables:$v}')"
  if [ -n "$token" ]; then
    curl -s -X POST "$GQL" -H 'content-type: application/json' -H "authorization: Bearer $token" -d "$body"
  else
    curl -s -X POST "$GQL" -H 'content-type: application/json' -d "$body"
  fi
}

login() {
  gql "" 'mutation ($e: String!, $p: String!) { login(email: $e, password: $p) { token userId } }' \
    "$(jq -nc --arg e "$1" '{e:$e, p:"password1"}')" | jq -r '.data.login.token // empty'
}

# wait for Hasura (the cli-migrations image only listens after migrations + metadata are applied)
for _ in $(seq 1 90); do
  curl -sf "${GQL%/v1/graphql}/healthz" >/dev/null && break
  sleep 2
done
curl -sf "${GQL%/v1/graphql}/healthz" >/dev/null || { echo "hasura not reachable at $GQL" >&2; exit 2; }

FAIL=0
report() { # report <id> <LANDED|REFUSED> <detail>
  echo "$1 $2  ($3)"
  [ "$2" = "$EXPECT" ] || FAIL=1
}

reset_db
ALICE="$(login alice@acme.test)"; BOB="$(login bob@acme.test)"; CAROL="$(login carol@globex.test)"
if [ -z "$ALICE" ] || [ -z "$BOB" ] || [ -z "$CAROL" ]; then echo "login failed" >&2; exit 2; fi

# ---- happy path: alice creates, reads and updates a note in Acme ---------------------------
HAPPY=OK
NEW_ID="$(gql "$ALICE" 'mutation { insert_notes_one(object: {org_id: 1, title: "Standup", body: "first draft"}) { id } }' | jq -r '.data.insert_notes_one.id // empty')"
if [ -z "$NEW_ID" ] || [ "$(psql_q "SELECT org_id || ':' || author_id FROM notes WHERE id = $NEW_ID")" != "1:1" ]; then HAPPY="FAIL (insert)"; fi
if [ "$HAPPY" = OK ]; then
  READ="$(gql "$ALICE" 'query ($id: Int!) { notes_by_pk(id: $id) { body } }' "{\"id\": $NEW_ID}" | jq -r '.data.notes_by_pk.body // empty')"
  [ "$READ" = "first draft" ] || HAPPY="FAIL (read)"
fi
if [ "$HAPPY" = OK ]; then
  gql "$ALICE" 'mutation ($id: Int!) { update_notes_by_pk(pk_columns: {id: $id}, _set: {body: "second draft"}) { id } }' "{\"id\": $NEW_ID}" >/dev/null
  [ "$(psql_q "SELECT body FROM notes WHERE id = $NEW_ID")" = "second draft" ] || HAPPY="FAIL (update)"
fi
if [ "$HAPPY" = OK ]; then
  LIST="$(gql "$BOB" '{ notes(where: {org_id: {_eq: 1}}) { id } }' | jq -r '[.data.notes[]?.id] | length')"
  [ "$LIST" = "3" ] || HAPPY="FAIL (member list: $LIST)"
fi
echo "HAPPY $HAPPY"
[ "$HAPPY" = OK ] || FAIL=1

# ---- H1 anon purges Acme's notes through the purgeOrgNotes action --------------------------
reset_db
BEFORE="$(psql_q "SELECT count(*) FROM notes WHERE org_id = 1")"
RESP="$(gql "" 'mutation { purgeOrgNotes(orgId: 1) { deleted } }')"
AFTER="$(psql_q "SELECT count(*) FROM notes WHERE org_id = 1")"
if [ "$BEFORE" -gt 0 ] && [ "$AFTER" = 0 ]; then report H1 LANDED "org 1 notes $BEFORE -> $AFTER"
else report H1 REFUSED "org 1 notes $BEFORE -> $AFTER; $(echo "$RESP" | jq -c '.errors[0].message // .data' 2>/dev/null)"; fi

# ---- H2 bob (member) moves an Acme note into Globex ----------------------------------------
reset_db
RESP="$(gql "$BOB" 'mutation { update_notes_by_pk(pk_columns: {id: 1}, _set: {org_id: 2}) { id org_id } }')"
ORG="$(psql_q "SELECT org_id FROM notes WHERE id = 1")"
if [ "$ORG" = 2 ]; then report H2 LANDED "note 1 org_id now $ORG"
else report H2 REFUSED "note 1 org_id still $ORG; $(echo "$RESP" | jq -c '.errors[0].message // .data' 2>/dev/null)"; fi

# ---- H3 anon lists Acme members with their emails ------------------------------------------
reset_db
EMAIL="$(psql_q "SELECT u.email FROM users u JOIN memberships m ON m.user_id = u.id WHERE m.org_id = 1 ORDER BY u.id LIMIT 1")"
RESP="$(gql "" '{ memberships(where: {org_id: {_eq: 1}}) { role user { email } } }')"
if echo "$RESP" | grep -qF "$EMAIL"; then report H3 LANDED "anon response contains $EMAIL"
else report H3 REFUSED "$(echo "$RESP" | jq -c '.errors[0].message // .data' 2>/dev/null)"; fi

# ---- H4 carol (Globex) reads an Acme note by id --------------------------------------------
BODY="$(psql_q "SELECT body FROM notes WHERE id = 2 AND org_id = 1")"
RESP="$(gql "$CAROL" '{ notes_by_pk(id: 2) { title body } }')"
if [ -n "$BODY" ] && echo "$RESP" | grep -qF "$BODY"; then report H4 LANDED "carol received Acme note 2 body"
else report H4 REFUSED "$(echo "$RESP" | jq -c '.errors[0].message // .data' 2>/dev/null)"; fi

# ---- H5 bob (member) reads alice's api_token -----------------------------------------------
TOKEN="$(psql_q "SELECT api_token FROM users WHERE email = 'alice@acme.test'")"
RESP="$(gql "$BOB" '{ users { email api_token } }')"
if [ -n "$TOKEN" ] && echo "$RESP" | grep -qF "$TOKEN"; then report H5 LANDED "bob received alice's api_token"
else report H5 REFUSED "$(echo "$RESP" | jq -c '.errors[0].message // .data' 2>/dev/null)"; fi

reset_db
if [ "$FAIL" = 0 ]; then echo "SELFTEST PASS ($VARIANT: every case $EXPECT, happy path OK)"; exit 0; fi
echo "SELFTEST FAIL ($VARIANT expects every case $EXPECT and a working happy path)"; exit 1
