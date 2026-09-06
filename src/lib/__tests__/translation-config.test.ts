/**
 * Pins the two deployment answers that a green test suite and a green build
 * both miss, because neither runs in a tenant (bd startsim-bxkd).
 *
 * The `tenantApiBase` block below was REWRITTEN after startsim-mpijc: it used to
 * pin `django.<namespace>:5000`, which is exactly the wrong answer that shipped
 * and stayed green for two weeks while the feature was dead in production. A
 * test can pin a bug as confidently as it pins a fix; what it could not see was
 * that the name had stopped resolving.
 */
import { describe, expect, it } from 'vitest';

import { tenantApiBase, tenantHost, translationEnv } from '@/lib/translation-config';

describe('tenantApiBase', () => {
  it('goes through the nginx in its own task, not the retired django Cloud Map name', () => {
    // The grouping migration (startsim-wyn2, 2026-08-20) collapsed django into
    // the `<slug>-nginx` TASK as a container. Cloud Map registers SERVICES, so
    // `django.<namespace>` stopped resolving that day and every server-side
    // tenant call has been unreachable since (startsim-mpijc). Verified live:
    // foundry-tenant-marketing-agents.local registers only [postgres, nginx].
    //
    // The five containers share ONE awsvpc network namespace, so nginx — which
    // already proxies /api/ to django and is still the group's registered name —
    // is on loopback. The IPv4 literal rather than `localhost`: the live
    // container's /etc/hosts carries `::1 localhost` too and nginx declares only
    // `listen 80`, so the name would depend on Node's resolution order holding.
    const base = tenantApiBase({
      TENANT_DNS_NAMESPACE: 'foundry-tenant-marketing-agents.local',
    });

    expect(base).toBe('http://127.0.0.1');
    expect(base).not.toContain('django.');
  });

  it('lands on nginx port 80 once tenant-fetch composes the request URL', () => {
    // The bare string is not the whole answer. `tenant-fetch` builds
    // `new URL(base + '/api/v1/' + path + '/')` and hands `url.port` to
    // node:http, which defaults an EMPTY port to 80 for http:. That default is
    // the entire reachability claim, so assert it rather than assume it — and
    // 80 is nginx, not 3000 (this Next server, i.e. itself) and not 5000
    // (django, reachable but a second copy of nginx's routing table).
    const url = new URL(
      `${tenantApiBase({ TENANT_DNS_NAMESPACE: 'foundry-tenant-marketing-agents.local' })}/api/v1/entities/abc/`,
    );

    expect(url.protocol).toBe('http:');
    expect(url.hostname).toBe('127.0.0.1');
    expect(url.port || (url.protocol === 'http:' ? '80' : '')).toBe('80');
    expect(url.href).toBe('http://127.0.0.1/api/v1/entities/abc/');
  });

  it('prefers the deployed route over a stale DJANGO_API_URL', () => {
    // A tenant that somehow carries both is deployed; the in-task route wins.
    const base = tenantApiBase({
      TENANT_DNS_NAMESPACE: 'foundry-tenant-x.local',
      DJANGO_API_URL: 'http://localhost:8001',
    });

    expect(base).toBe('http://127.0.0.1');
  });

  it('falls back to DJANGO_API_URL locally, without a trailing slash', () => {
    expect(tenantApiBase({ DJANGO_API_URL: 'http://localhost:8001/' })).toBe(
      'http://localhost:8001',
    );
  });

  it('never resolves to the frontend port, which would mean "myself"', () => {
    // The deployed answer is loopback now, so "any localhost is wrong" is no
    // longer the guard — the PORT is. 3000 is this Next server (NGINX_FRONTEND
    // is literally `127.0.0.1:3000` in the runtime bundle), and a handler
    // calling it would hairpin into itself.
    const base = tenantApiBase({ TENANT_DNS_NAMESPACE: 'foundry-tenant-x.local' });

    expect(new URL(base).port).not.toBe('3000');
  });

  it('uses the local gateway when the namespace is blank', () => {
    // A blank namespace means "not deployed", so DJANGO_API_URL still answers.
    expect(tenantApiBase({ TENANT_DNS_NAMESPACE: '   ', DJANGO_API_URL: 'http://gw:8001' })).toBe(
      'http://gw:8001',
    );
  });
});

describe('translationEnv', () => {
  it('defaults this tenant to the open posture', () => {
    // startsim-yfot classifies OGMC's news-derived marketing content as `open`
    // by name. Written down rather than assumed.
    expect(translationEnv({}).TRANSLATION_POSTURE).toBe('open');
  });

  it('defaults to the provider the deployment actually holds a key for', () => {
    const env = translationEnv({});

    expect(env.TRANSLATION_PROVIDER).toBe('openai');
    expect(env.TRANSLATION_MODEL).toBeTruthy();
    expect(env.TRANSLATION_ALLOWED_MODELS).toContain(env.TRANSLATION_MODEL as string);
  });

  it('lets the environment override every default', () => {
    // Moving this tenant to another provider or model must be config, not a
    // deploy of new code.
    const env = translationEnv({
      TRANSLATION_POSTURE: 'walled',
      TRANSLATION_PROVIDER: 'anthropic',
      TRANSLATION_MODEL: 'claude-sonnet-5',
      TRANSLATION_ALLOWED_MODELS: 'claude-sonnet-5',
    });

    expect(env.TRANSLATION_POSTURE).toBe('walled');
    expect(env.TRANSLATION_PROVIDER).toBe('anthropic');
    expect(env.TRANSLATION_MODEL).toBe('claude-sonnet-5');
  });

  it('passes the rest of the environment through untouched', () => {
    // resolveTranslationRoute also reads TRANSLATION_COVERED_MODELS and
    // TRANSLATION_FALLBACK; this must not become a filter.
    const env = translationEnv({ TRANSLATION_FALLBACK: 'true', OPENAI_API_KEY: 'k' });

    expect(env.TRANSLATION_FALLBACK).toBe('true');
    expect(env.OPENAI_API_KEY).toBe('k');
  });
});

describe('tenantHost', () => {
  it('is the tenant domain, because that is what ALLOWED_HOSTS holds', () => {
    // Without it a direct-to-Django call gets 400 "Invalid HTTP_HOST header"
    // before any view runs — which is exactly how the first live translation
    // failed, silently, after the engine had done all its work. Still
    // load-bearing through nginx: it forwards `$http_host` straight to Django,
    // so a missing Host is the same 400, one hop later.
    expect(tenantHost({ DJANGO_ALLOWED_HOSTS: 'marketing-agents.ai.startsimpli.com' })).toBe(
      'marketing-agents.ai.startsimpli.com',
    );
  });

  it('takes the first entry when several are allowed', () => {
    expect(tenantHost({ DJANGO_ALLOWED_HOSTS: ' a.example.com , b.example.com ' })).toBe(
      'a.example.com',
    );
  });

  it('is undefined when unset, so the caller can fall back rather than send junk', () => {
    expect(tenantHost({})).toBeUndefined();
    expect(tenantHost({ DJANGO_ALLOWED_HOSTS: '  ' })).toBeUndefined();
  });
});
