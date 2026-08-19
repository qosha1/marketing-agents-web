/**
 * Pins the two deployment answers that a green test suite and a green build
 * both miss, because neither runs in a tenant (bd startsim-bxkd).
 */
import { describe, expect, it } from 'vitest';

import { tenantApiBase, translationEnv } from '@/lib/translation-config';

describe('tenantApiBase', () => {
  it('uses the Cloud Map FQDN when deployed, exactly as nginx does', () => {
    // resolver-entrypoint.sh builds django.${TENANT_DNS_NAMESPACE}:5000. If this
    // ever disagrees with that, the frontend talks to a different backend than
    // the proxy in front of it.
    const base = tenantApiBase({
      TENANT_DNS_NAMESPACE: 'foundry-tenant-marketing-agents.local',
    });

    expect(base).toBe('http://django.foundry-tenant-marketing-agents.local:5000');
  });

  it('prefers the namespace over a stale DJANGO_API_URL', () => {
    // A tenant that somehow carries both is deployed; the FQDN wins.
    const base = tenantApiBase({
      TENANT_DNS_NAMESPACE: 'foundry-tenant-x.local',
      DJANGO_API_URL: 'http://localhost:8001',
    });

    expect(base).toBe('http://django.foundry-tenant-x.local:5000');
  });

  it('falls back to DJANGO_API_URL locally, without a trailing slash', () => {
    expect(tenantApiBase({ DJANGO_API_URL: 'http://localhost:8001/' })).toBe(
      'http://localhost:8001',
    );
  });

  it('never silently points at localhost when the namespace is blank', () => {
    // The dangerous case: a deployed tenant with an empty namespace must not
    // quietly resolve to a URL that means "myself".
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
