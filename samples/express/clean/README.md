# notes-api

A small multi-tenant notes API: organizations, their members, and the notes they share.
Express 5 + Prisma 6 on Postgres 16, JWT bearer authentication.

## Run

```sh
docker compose up -d --build --wait
```

- API: http://localhost:18010
- Postgres: `localhost:15410`, database `notes`, user `notes` / password `notes`
  (`DATABASE_URL` in `.env` points there for running Prisma from the host)

On every start the app syncs the schema (`prisma db push`) and re-seeds the database
(`prisma/seed.js` truncates and re-inserts the data below).

Stop and wipe: `docker compose down -v`.

## Seeded data

| user  | email             | password    | membership              |
|-------|-------------------|-------------|-------------------------|
| alice | alice@acme.test   | `password1` | owner of org 1 (Acme)   |
| bob   | bob@acme.test     | `password1` | member of org 1 (Acme)  |
| carol | carol@globex.test | `password1` | owner of org 2 (Globex) |

Notes: ids 1 and 2 in Acme (written by alice), id 3 in Globex (written by carol).
Every user has a personal API token (`users.api_token`), visible via `GET /me`.

## API

Authenticate with `POST /auth/login` `{ "email", "password" }` and send the returned token as
`Authorization: Bearer <token>`.

| method | path                        | description                          |
|--------|-----------------------------|--------------------------------------|
| POST   | `/auth/login`               | exchange credentials for a JWT       |
| GET    | `/me`                       | your profile, API token, memberships |
| POST   | `/me/api-token`             | rotate your API token                |
| GET    | `/orgs`                     | organizations you belong to          |
| GET    | `/orgs/:orgId/members`      | members of an organization           |
| GET    | `/users`                    | people you share an organization with |
| GET    | `/orgs/:orgId/notes`        | notes of an organization             |
| POST   | `/orgs/:orgId/notes`        | create a note `{ title, body }`      |
| GET    | `/notes/:id`                | read a note                          |
| PATCH  | `/notes/:id`                | edit a note                          |
| DELETE | `/notes/:id`                | delete a note                        |
| GET    | `/admin/orgs/:orgId/stats`  | organization statistics              |
| POST   | `/admin/orgs/:orgId/purge`  | delete every note of an organization |
