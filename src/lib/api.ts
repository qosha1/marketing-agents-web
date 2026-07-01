import { createStartSimpliApi } from '@startsimpli/api';
import { buildCentralAuthUrl, resolveCentralAuthHost, isRelativeHost } from '@startsimpli/auth';
import { getRegisteredToken } from '@/infrastructure/auth';

/**
 * The fork's app slug, passed to central-auth as ?app=<slug>.
 *
 * NEXT_PUBLIC_* is inlined at BUILD time, but foundry-tenant-base:frontend is ONE
 * shared image reused by every tenant — so a baked slug (e.g. mcr) makes EVERY
 * tenant bounce to central auth as ?app=mcr (wrong token audience + wrong brand).
 * So derive the slug from the tenant hostname (<slug>.ai.startsimpli.com) at
 * RUNTIME; a build-time NEXT_PUBLIC_APP_SLUG still wins for local/standalone
 * builds, and we fall back to 'foundry' off-browser / on an unrecognized host.
 */
export function resolveAppSlug(): string {
  const baked = process.env.NEXT_PUBLIC_APP_SLUG;
  if (baked) return baked;
  if (typeof window !== 'undefined') {
    const m = window.location.hostname.match(/^([a-z0-9-]+)\.ai\.startsimpli\.com$/i);
    if (m?.[1]) return m[1];
  }
  return 'foundry';
}

/** Eager value for branding; auth flows re-resolve at call time (client). */
export const APP_SLUG = resolveAppSlug();

/** Optional override of the central auth host (else auth.startsimpli.com). */
const AUTH_HOST = process.env.NEXT_PUBLIC_AUTH_HOST || undefined;

/**
 * Build the central-auth signin URL for this fork, preserving the current page
 * as return_to. Branding is aspirational — today ?app= only tags the flow;
 * per-tenant white-label branding lands with the white-label work.
 *
 * When the auth host is RELATIVE (e.g. /auth behind a single-origin gateway or
 * DebuggAI tunnel), keep the return_to relative too (path + search of whatever
 * absolute href the caller passed) so the whole round-trip stays same-origin and
 * never leaks the tunnel hostname. On an absolute host (prod) the behavior is
 * unchanged. startsim-jmuw.2.8 (lr8).
 */
export function signinUrl(returnTo?: string): string {
  const host = AUTH_HOST ?? resolveCentralAuthHost();
  let resolvedReturnTo = returnTo;
  if (returnTo && isRelativeHost(host)) {
    try {
      const u = new URL(returnTo, typeof window !== 'undefined' ? window.location.origin : undefined);
      resolvedReturnTo = `${u.pathname}${u.search}`;
    } catch {
      // already relative (or unparseable) — pass through as-is
    }
  }
  return buildCentralAuthUrl('signin', {
    app: resolveAppSlug(), // re-resolve client-side (window host) — onUnauthorized is browser-only
    returnTo: resolvedReturnTo,
    ...(AUTH_HOST ? { host: AUTH_HOST } : {}),
  });
}

/**
 * Shared API client. baseUrl='' so requests go to the same-origin /api/* proxy
 * (see next.config.ts rewrites -> the tenant Django backend). On a 401 we bounce
 * to the central auth host instead of any per-app /login page.
 */
export const api = createStartSimpliApi({
  baseUrl: process.env.NEXT_PUBLIC_API_URL || '',
  getToken: () => getRegisteredToken(),
  onUnauthorized: () => {
    if (typeof window === 'undefined') return;
    const target = signinUrl(window.location.href);
    if (window.location.href === target) return;
    window.location.href = target;
  },
});

export type Api = typeof api;
