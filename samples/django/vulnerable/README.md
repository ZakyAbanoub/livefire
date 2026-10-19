# notes-api

A small multi-tenant notes API: organizations, their members, and the notes they share.
Django 5 + Django REST Framework on Postgres 16, token authentication.

## Run

```sh
docker compose up -d --build --wait
```

- API: http://localhost:18012
- Postgres: `localhost:15412`, database `notes`, user `notes` / password `notes`
  (the defaults in `config/settings.py` point there for running `manage.py` from the host)

On every start the app applies migrations (`manage.py migrate`) and re-seeds the database
(`manage.py seed` truncates and re-inserts the data below).

Stop and wipe: `docker compose down -v`.

## Seeded data

| user  | email             | password    | membership              |
|-------|-------------------|-------------|-------------------------|
| alice | alice@acme.test   | `password1` | owner of org 1 (Acme)   |
| bob   | bob@acme.test     | `password1` | member of org 1 (Acme)  |
| carol | carol@globex.test | `password1` | owner of org 2 (Globex) |

Notes: ids 1 and 2 in Acme (written by alice), id 3 in Globex (written by carol).
Every user has a personal API token (`users.api_token`), visible via `GET /me`.

## Layout

| app        | contents                                                        |
|------------|-----------------------------------------------------------------|
| `accounts` | custom user model, login, profile, teammates                    |
| `orgs`     | organizations, memberships, org administration, `seed` command |
| `notes`    | notes                                                           |

## API

Authenticate with `POST /auth/login` `{ "email", "password" }` and send the returned token as
`Authorization: Token <token>`.

| method | path                         | description                           |
|--------|------------------------------|---------------------------------------|
| POST   | `/auth/login`                | exchange credentials for a token      |
| GET    | `/me`                        | your profile, API token, memberships  |
| POST   | `/me/api-token`              | rotate your API token                 |
| GET    | `/orgs`                      | organizations you belong to           |
| GET    | `/orgs/<org_id>/members`     | members of an organization            |
| GET    | `/users`                     | people you share an organization with |
| GET    | `/orgs/<org_id>/notes`       | notes of an organization              |
| POST   | `/orgs/<org_id>/notes`       | create a note `{ title, body }`       |
| GET    | `/notes/<id>`                | read a note                           |
| PATCH  | `/notes/<id>`                | edit a note                           |
| DELETE | `/notes/<id>`                | delete a note                         |
| GET    | `/admin/orgs/<org_id>/stats` | organization statistics               |
| POST   | `/admin/orgs/<org_id>/purge` | delete every note of an organization  |

