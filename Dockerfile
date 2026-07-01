# =============================================================================
# Foundry tenant FRONTEND image — pushed to ECR as foundry-tenant-base:frontend
# =============================================================================
# A Next.js (node) service that serves the tenant SPA. It sits behind the tenant
# nginx (which routes / -> this service, /api -> django), so it needs NO
# DJANGO_API_URL (nginx proxies /api). NEXT_PUBLIC_* are inlined at build:
#   NEXT_PUBLIC_APP_SLUG  -> central-auth ?app=<slug>. LEFT EMPTY by default so
#                            this ONE shared image derives the slug from the
#                            tenant hostname (<slug>.ai.startsimpli.com) at
#                            RUNTIME (src/lib/api.resolveAppSlug). Baking a value
#                            here makes every tenant bounce as that slug (the
#                            app=mcr bug). Pass --build-arg only for a standalone
#                            single-tenant build. NEXT_PUBLIC_API_URL unset
#                            (same-origin /api) ; NEXT_PUBLIC_AUTH_HOST unset
#                            (-> auth.startsimpli.com).
# Built for linux/amd64 (Fargate). Same ECR repo as the base image (different
# tag) so the tenant execution role's existing ECR pull grant covers it.
# -----------------------------------------------------------------------------
FROM node:20-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.1 --activate
COPY package.json ./
# --no-frozen-lockfile so a fresh fork (no committed pnpm-lock.yaml) still builds;
# a lockfile, when present, is honored + updated in place.
RUN pnpm install --no-frozen-lockfile
COPY . .
# Empty default => runtime hostname derivation (resolveAppSlug). Override only
# for a standalone single-tenant build (--build-arg NEXT_PUBLIC_APP_SLUG=<slug>).
ARG NEXT_PUBLIC_APP_SLUG=
ENV NEXT_PUBLIC_APP_SLUG=$NEXT_PUBLIC_APP_SLUG
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM node:20-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.33.1 --activate
COPY --from=build /app/.next ./.next
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.ts ./next.config.ts
EXPOSE 3000
CMD ["pnpm", "start", "-p", "3000"]
