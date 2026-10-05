# Foundry Tenant App-UI Template

The canonical starter for a **Foundry app's user-facing UI**. When someone creates a
foundry, the Foundry orchestrator forks this template into **their** git repo,
substitutes a few markers, and hands it over. From then on it's their codebase —
edit it in any editor, push, redeploy.

It's thin on purpose: all the heavy lifting comes from the shared `@startsimpli/*`
packages, so the app works the moment it's forked:

- **`@startsimpli/auth`** — the central-auth sign-in wall (401 → signin bounce, `useAuth`).
- **`@startsimpli/ui`** — the component kit (board, table, drawer, cards, forms, toasts).
- **`@startsimpli/api`** — the tenant API client (bearer attached, camelCase↔snake_case).

## What's in the box

A data-driven app that reads the tenant's declared schema at runtime:

- **Auth-walled shell** — sign in via central auth, sidebar with one **section per
  entity type** (status types open as a **kanban board**, others as a **table**).
- **Home** — a product overview: per-type live status breakdowns ("2 ready") + counts.
- **Board / table / detail-drawer** — review + edit records; no schema/admin tools
  (those live in the Foundry console, not the customer app).

## Substitution (Foundry does this at fork time)

See `foundry.template.json`. Markers `__FOUNDRY_SLUG__` / `__FOUNDRY_NAME__` /
`__FOUNDRY_TAGLINE__` are replaced in `src/foundry.config.ts` + `package.json`.

## Run it locally — FULLY OFFLINE

```bash
pnpm install
./local-stack/up.sh
```

That brings up a **real tenant backend on this laptop** (sqlite), an offline
stand-in for central auth, this app, and a Caddy gateway that collapses them onto
one origin. It declares the tenant's schema, seeds ~56 records across all six
types, and prints a URL and a password. Delete, reject, regenerate and translate
are all safe there, because none of it touches production.

```bash
./local-stack/up.sh --reset   # clean database, seed again
./local-stack/up.sh status    # what's running, and the whoami the tenant answers
./local-stack/up.sh token     # a bearer token, for curl
./local-stack/up.sh down
```

Full docs, including what to do when it does not come up:
`start-simpli-api/tenant-starter/local-stack/README.md`. It needs that repo
checked out — the tenant backend lives there — and `up.sh` tells you where to put
it if it cannot find it.

### Running against the LIVE tenant

`.env.variantA.PRODUCTION-TENANT` exists for the narrow, read-only errand of
reproducing something that depends on the real corpus. **Every write through it
is a production write on a paying customer's data.** Read its header before you
copy it anywhere. The local stack above is the default.

The app calls `/api/*` same-origin; `next.config.ts` proxies that to whichever
Django API `DJANGO_API_URL` names. Sign-in bounces to the host in
`NEXT_PUBLIC_AUTH_HOST` (`auth.startsimpli.com?app=<slug>` in production, the
local `/auth` page on the offline stack).

## Deploy

Vercel (recommended) or the included `Dockerfile`. Set:
- `NEXT_PUBLIC_APP_SLUG=<slug>` (central-auth `?app=` + branding)
- `DJANGO_API_URL=https://<slug>.ai.startsimpli.com` (your tenant API)

It's your repo now — make it yours.
