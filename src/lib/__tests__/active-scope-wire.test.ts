/**
 * The active project reaches the wire (bd startsim-c65fd / startsim-4ma5a):
 * lists and counts of a scoped type carry ?scope=, creates are stamped, and the
 * `scope` type itself and unscoped types are left alone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The real client refuses an unsafe method with no bearer, so the token is stubbed.
vi.mock('@/infrastructure/auth', () => ({
  getRegisteredToken: async () => 'test-token',
  registerTokenProvider: () => {},
}));

import { createEntity, listEntities } from '../foundry-api';
import { setActiveProjectId } from '../project-scope';

const seen: { url: string; body?: string }[] = [];
const realFetch = globalThis.fetch;
const TYPES = [
  { id: 't', key: 'topic', label: 'Topic', config: { scope: { path_attribute: 'scope_path' } }, attributes: [] },
  { id: 'n', key: 'news_item', label: 'News', config: { scope: { path_attribute: null } }, attributes: [] },
];

function json(body: unknown) {
  return {
    ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body, text: async () => JSON.stringify(body),
  } as unknown as Response;
}

beforeEach(() => {
  seen.length = 0;
  vi.stubGlobal('window', {
    localStorage: (() => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; })(),
    dispatchEvent: () => true,
  });
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    seen.push({ url: decodeURIComponent(url), body: typeof init?.body === 'string' ? init.body : undefined });
    if (url.includes('schema/types')) return json({ count: 2, next: null, previous: null, results: TYPES });
    return json({ count: 0, next: null, previous: null, results: [], id: 1 });
  }) as typeof globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.unstubAllGlobals();
});

const entityCalls = () => seen.filter((s) => s.url.includes('entities'));

describe('active project on the wire', () => {
  it('adds scope= to a scoped type', async () => {
    setActiveProjectId('/ogmc');
    await listEntities('topic', 1);
    expect(entityCalls()[0].url).toContain('scope=/ogmc');
  });
  it('leaves All, the scope type, unscoped types and explicit scopes alone', async () => {
    await listEntities('topic', 1);
    setActiveProjectId('/ogmc');
    await listEntities('scope', 1);
    await listEntities('news_item', 1);
    await listEntities('topic', 1, { scope: '/sandbox' });
    const urls = entityCalls().map((c) => c.url);
    expect(urls[0]).not.toContain('scope=');
    expect(urls[1]).not.toContain('scope=');
    expect(urls[2]).not.toContain('scope=');
    expect(urls[3]).toContain('scope=/sandbox');
  });
  it('stamps scope_path on create', async () => {
    setActiveProjectId('/ogmc');
    await createEntity({ entityType: 'topic', name: 'x', data: { title: 'x' } });
    const post = entityCalls().find((c) => c.body);
    expect(post?.body).toContain('"scope_path":"/ogmc"');
  });
});
