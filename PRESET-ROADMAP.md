# livefire — preset roadmap

Which stacks livefire should ship presets for, ranked to maximize real-world coverage. A preset
is worth adding when the stack is **widely used** AND its access-control model **maps onto the
method** (endpoints/RPC behind an authz layer + a store you can read directly to confirm a
write). Popularity anchored to 2025–2026 developer surveys (sources at the bottom).

## The key insight: three authz families, not N stacks

Most of the work is shared. Stacks cluster into **three families** by *where* authz lives, and a
preset mostly differs only in how it enumerates the guard:

| Family | Where authz lives | Ground-truth read | Members |
|---|---|---|---|
| **A — in-DB declarative** | row policies / rules in the datastore | service-role / admin client bypassing them | Supabase ✅, raw Postgres+RLS, **Hasura**, **PostGraphile**, **Firebase/Firestore rules** |
| **B — in-code, endpoint→guard** | route guards / policies / middleware in app code | direct DB/SQL read bypassing the ORM | Rails ✅, Laravel ✅, Spring ✅, **Express**, **NestJS**, **Django/DRF**, **FastAPI**, **ASP.NET Core**, **Flask**, **Go**, **Symfony** |
| **C — CMS permission model** | the CMS's own roles/capabilities/grants | direct DB read + admin API | **Strapi**, **WordPress**, **Drupal** |

Family B is the biggest and most uniform — the `authz-in-code` template (rails/spring/laravel)
already fits it; each new B preset is mostly a re-map of "how do I list every route→its guard"
and "how do I mint the 3 actors". Family A reuses most of the Supabase preset (swap the
inventory dump). Family C needs the most stack-specific knowledge (CMS grants are idiosyncratic).

## Shipped (15)

| Preset | Family | authz model |
|---|---|---|
| **supabase** | A | RLS + SECURITY DEFINER grants (worked example) |
| **hasura** | A | declarative per-role/table permissions (± Postgres RLS) |
| **firebase** | A | Firestore/Storage security rules (NoSQL RLS); ground truth via Admin SDK |
| **express** | B | middleware guards + ownership checks (unopinionated) |
| **nestjs** | B | Guards (`@UseGuards`/`CanActivate`) + `@Roles` |
| **django** | B | DRF permission classes + queryset scoping |
| **fastapi** | B | `Depends()` auth + SQLAlchemy ownership checks |
| **flask** | B | decorators / Flask-Login + manual checks |
| **rails** | B | Pundit/CanCanCan + `current_user` scoping |
| **laravel** | B | Gate/Policy + Eloquent scoping |
| **symfony** | B | Voters + `security.yaml` + Doctrine |
| **spring** | B | `@PreAuthorize` + SecurityFilterChain + service checks |
| **aspnet** | B | `[Authorize]` policies + EF Core |
| **go** | B | middleware + hand-written ownership checks (gin/echo/fiber/chi) |
| **strapi** | C | Users-&-Permissions plugin + route `config.policies` |

## Remaining backlog (contributions welcome)

Priority = reach × fit × low effort.

| # | Preset | Family | Reach (2025) | authz model | Notes |
|---|---|---|---|---|---|
| 1 | **postgraphile** | A | medium (GraphQL-on-PG) | Postgres RLS + smart tags | reuses most of the Supabase/Hasura shape |
| 2 | **phoenix (elixir)** | B | niche, loved | plugs + Ecto scoping | small but high-satisfaction audience |
| 3 | **wordpress** | C | **dominant CMS (43% of web)** | capabilities + nonces + hooks | huge audience but idiosyncratic authz — high effort |
| 4 | **drupal** | C | declining but strong in top-10k/enterprise | node access grants + `hook_permission` | complex authz; high-value niche |

## What "done for everyone" looks like — reached

The 16 shipped presets already put livefire within one preset of the vast majority of new
backend projects: all of family A's common declarative stores (Supabase, Hasura, Firebase), and
the whole top of family B across JS (Express, NestJS), Python (Django, FastAPI, Flask), Ruby
(Rails), PHP (Laravel, Symfony), Java (Spring), .NET (ASP.NET), Go, plus the leading headless CMS
(Strapi). Anything unlisted still runs today via the **interview fallback** (Stage 0) and can be
promoted to a preset from a saved `livefire.config.mjs`. The remaining backlog is niche or
high-effort CMS territory.

## Fit caveats (be honest per stack)

- **livefire needs a directly-readable store** for ground truth. All the above qualify (SQL, or
  Firestore/Mongo via an admin client). A stack with no queryable store degrades the empirical
  modality — the report must say so.
- **Unopinionated stacks (Express, Go)** have no single authz convention. Their presets can't
  point at "the" guard mechanism; they must instruct the reviewer to enumerate whatever
  middleware/ownership checks exist and flag routes with none. Lower precision than an opinionated
  stack, still valuable.
- **CMS presets (WordPress, Drupal)** encode the most stack-specific knowledge and should be
  contributed by someone who runs that CMS in anger (see CONTRIBUTING.md — prove it against a
  sample app with a known hole).

## Sources
- [Stack Overflow Developer Survey 2025 — Technology](https://survey.stackoverflow.co/2025/technology)
- [State of the backend framework landscape 2026 (inVerita)](https://inveritasoft.com/article-10-most-popular-backend-frameworks)
- [CMS market share 2025–2026 (Search Engine Journal)](https://www.searchenginejournal.com/cms-market-share/454039/)
- [Strapi 5 / headless CMS landscape](https://strapi.io/blog/best-cms-2025)
