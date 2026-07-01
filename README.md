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

## Run it locally

```bash
pnpm install
NEXT_PUBLIC_APP_SLUG=<your-slug> DJANGO_API_URL=https://<your-slug>.ai.startsimpli.com pnpm dev
```

The app calls `/api/*` same-origin; `next.config.ts` proxies that to your tenant's
Django API (`DJANGO_API_URL`). Sign-in bounces to `auth.startsimpli.com?app=<slug>`.

## Deploy

Vercel (recommended) or the included `Dockerfile`. Set:
- `NEXT_PUBLIC_APP_SLUG=<slug>` (central-auth `?app=` + branding)
- `DJANGO_API_URL=https://<slug>.ai.startsimpli.com` (your tenant API)

It's your repo now — make it yours.
