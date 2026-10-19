# Notes (Hasura)

A small multi-tenant notes app: organisations, their members, and the notes they share.
The API is Hasura GraphQL Engine v2 over Postgres 16; login is a Hasura Action served by a
tiny Node handler (`actions/`) that verifies the password and issues an HS256 JWT.

## Layout

| path | what |
|---|---|
| `docker-compose.yml` | Postgres, Hasura (cli-migrations image: applies `migrations/` + `metadata/` on boot), the Action handler |
| `config.yaml` | Hasura CLI v3 project config |
| `migrations/default/` | schema (`orgs`, `users`, `memberships`, `notes`) and seed data |
| `metadata/` | tracked tables, relationships, per-role permissions, Actions |
| `actions/server.js` | Action handlers: `login`, `purgeOrgNotes` |

## Run

```sh
docker compose -p lf-hasura-$(basename "$PWD") up -d --build
curl -s localhost:18022/healthz   # OK once migrations + metadata are applied
```

- GraphQL: `http://localhost:18022/v1/graphql`
- Postgres: `postgres://notes:notes@localhost:15422/notes`
- Admin secret: `notesadminsecret`

## Auth

`mutation { login(email: "alice@acme.test", password: "password1") { token userId apiToken } }`
returns a JWT (and the caller's own `api_token`); send it as `Authorization: Bearer <token>`. Claims live under
`https://hasura.io/jwt/claims` (`x-hasura-user-id`, `x-hasura-default-role: user`,
`x-hasura-allowed-roles: [user]`). Requests without a token run as the `anonymous` role.

## Seeded users (password `password1` for all)

| user | email | membership |
|---|---|---|
| alice (id 1) | alice@acme.test | owner of org 1 (Acme) |
| bob (id 2) | bob@acme.test | member of org 1 (Acme) |
| carol (id 3) | carol@globex.test | owner of org 2 (Globex) |

Notes 1 and 2 belong to Acme (written by alice); note 3 belongs to Globex (written by carol).
Every user has an `api_token`.

## Stop

```sh
docker compose -p lf-hasura-$(basename "$PWD") down -v
```
