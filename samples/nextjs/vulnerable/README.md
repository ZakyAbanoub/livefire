# notes-app

A small multi-tenant notes app: organizations, their members, and the notes they share.
Next.js 16 (App Router, TypeScript) + Prisma 6 on Postgres 16, with cookie sessions stored in
the database (`sessions` table, bcrypt passwords, no auth library).

## Run

Postgres runs in Docker; the Next app runs on the host.

```sh
npm ci --ignore-scripts
npm run db:up        # docker compose: Postgres on localhost:15424
npm run setup        # prisma generate + migrate deploy + seed + next build
npm start            # http://localhost:18024
```

- App: http://localhost:18024 (sign in at `/login`)
- Postgres: `localhost:15424`, database `notes`, user `notes` / password `notes`
  (`DATABASE_URL` in `.env`)
- Re-seed at any time: `npm run seed` (truncates every table, sessions included, and re-inserts
  the data below)
- Development server instead of the build: `npm run dev`

Stop: stop `npm start` (Ctrl-C), then `npm run db:down` (removes the database volume).

## Seeded data

| user  | email             | password    | membership              |
|-------|-------------------|-------------|-------------------------|
| alice | alice@acme.test   | `password1` | owner of org 1 (Acme)   |
| bob   | bob@acme.test     | `password1` | member of org 1 (Acme)  |
| carol | carol@globex.test | `password1` | owner of org 2 (Globex) |

Notes: ids 1 and 2 in Acme (written by alice), id 3 in Globex (written by carol).
Every user has a personal API token (`users.api_token`), visible via `GET /api/me`.

## Authentication

`POST /api/auth/login` `{ "email", "password" }` creates a session row and sets the httpOnly
`session` cookie (7 days); `POST /api/auth/logout` deletes it. `lib/auth.ts` resolves the
cookie to a user (`getSession`, `getCurrentUser`, `requireUser`). `middleware.ts` sends
signed-out visitors of the pages to `/login`.

## Pages

| path              | description                                   |
|-------------------|-----------------------------------------------|
| `/login`          | sign in                                       |
| `/orgs`           | organizations you belong to                   |
| `/orgs/[orgId]`   | an organization's notes, a new-note form, its members |
| `/notes/[id]`     | read a note, edit or delete it                |

Note writes go through Server Actions in `app/actions/notes.ts`: `createNote(orgId, { title, body })`,
`updateNote(id, { title, body })`, `deleteNote(id)`.

## API (Route Handlers)

| method | path                             | description                          |
|--------|----------------------------------|--------------------------------------|
| POST   | `/api/auth/login`                | sign in, sets the session cookie     |
| POST   | `/api/auth/logout`               | sign out                             |
| GET    | `/api/me`                        | your profile, API token, memberships |
| GET    | `/api/users`                     | people you share an organization with |
| GET    | `/api/orgs/[orgId]/members`      | members of an organization           |
| GET    | `/api/admin/orgs/[orgId]/stats`  | organization statistics              |
| POST   | `/api/admin/orgs/[orgId]/purge`  | delete every note of an organization |
