/**
 * RED for bd startsim-vehzd / startsim-5n9ha / startsim-1pqb9 — the three new
 * reads/writes over the revision trail, as this app sends them.
 *
 * Same rule as the trail reader beside them (revisions.test.ts): RAW fetch, never
 * the camelising client — a restore that names `team_verdict` as `teamVerdict`
 * is a 400 for an undeclared field, and a feed row whose `metadata.changed` keys
 * were renamed prints a field this tenant never declared. And NO trailing slash:
 * next.config.ts's rewrite appends one, and a doubled slash does not route.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/infrastructure/auth', () => ({
  getRegisteredToken: async () => 'test-token',
  registerTokenProvider: () => {},
}));

import { fieldAuthorsClient, revisionClient, revisionFeedClient } from '../revisions';

type Seen = { url: string; method: string; headers: Record<string, string>; body: unknown };
const seen: Seen[] = [];
const realFetch = globalThis.fetch;
let status = 200;
let body: unknown = {};

function answer(s: number, b: unknown): Response {
  return {
    ok: s >= 200 && s < 300,
    status: s,
    headers: new Headers({ 'content-type': 'application/json', etag: '"9"' }),
    json: async () => b,
    text: async () => JSON.stringify(b),
  } as unknown as Response;
}

beforeEach(() => {
  seen.length = 0;
  status = 200;
  body = {};
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    seen.push({
      url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      method: (init?.method ?? 'GET').toUpperCase(),
      headers,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return answer(status, body);
  }) as typeof globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('revisionClient(id).restore', () => {
  it('POSTs to the nested route with NO trailing slash, the bearer, and a JSON body', async () => {
    body = { id: 'e1', version: 9, restore: { restored_from: 2, fields: ['team_verdict'], revision: 9 } };
    const out = await revisionClient('e1').restore!({ version: 2, fields: ['team_verdict'], expectedVersion: 8 });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.method).toBe('POST');
    expect(seen[0]!.url).toBe('/api/v1/entities/e1/revisions/2/restore');
    expect(seen[0]!.headers.authorization).toMatch(/test-token/);
    expect(seen[0]!.headers['content-type']).toMatch(/json/);
    expect(out).toMatchObject({ status: 200, body: { version: 9 } });
  });

  it('sends the declared field name VERBATIM and the version in ONE spelling only', async () => {
    await revisionClient('e1').restore!({ version: 2, fields: ['team_verdict'], expectedVersion: 8 });
    expect(seen[0]!.body).toEqual({ fields: ['team_verdict'], expected_version: 8 });
    // Never both: the server refuses if EITHER of two preconditions disagrees.
    expect(seen[0]!.headers['if-match']).toBeUndefined();
  });

  it('a whole-record restore omits fields', async () => {
    await revisionClient('e1').restore!({ version: 3, expectedVersion: 8 });
    expect(seen[0]!.body).toEqual({ expected_version: 8 });
  });

  it('RESOLVES a refusal with its status and body rather than throwing it away', async () => {
    status = 412;
    body = { detail: 'stale', current_version: 10 };
    const out = await revisionClient('e1').restore!({ version: 2, expectedVersion: 8 });
    expect(out).toMatchObject({ status: 412, body: { current_version: 10 } });
  });
});

describe('revisionClient(id).list — ?field= narrowing', () => {
  it('passes field through, raw', async () => {
    body = { count: 0, next: null, results: [] };
    await revisionClient('e1').list({ page: 1, pageSize: 20, field: 'team_verdict' });
    expect(seen[0]!.url).toBe('/api/v1/entities/e1/revisions?page=1&page_size=20&field=team_verdict');
  });

  it('keeps the envelope history policy for the panel', async () => {
    body = { count: 0, next: null, results: [], history: { enabled: false, declared_by: 'type' } };
    const page = await revisionClient('e1').list({ page: 1 });
    expect(page.history).toEqual({ enabled: false, declared_by: 'type' });
  });
});

describe('fieldAuthorsClient', () => {
  it('GETs the raw field-authors route, keys untouched', async () => {
    body = { recorded: true, fields: { team_verdict: { actor_label: 'a@b.c', actor_kind: 'machine' } } };
    const out = await fieldAuthorsClient('e1').get();
    expect(seen[0]!.url).toBe('/api/v1/entities/e1/field-authors');
    expect(out.fields).toHaveProperty('team_verdict');
  });

  it('throws with the status on failure', async () => {
    status = 404;
    await expect(fieldAuthorsClient('e1').get()).rejects.toMatchObject({ status: 404 });
  });
});

describe('revisionFeedClient', () => {
  it('sends only the non-blank filters, page_size, and the cursor — never page', async () => {
    body = { next: null, next_cursor: null, results: [] };
    await revisionFeedClient().list({
      actor: '',
      actor_kind: 'machine',
      type: 'draft',
      scope: '',
      cursor: 'abc',
      pageSize: 50,
    });
    const url = new URL(seen[0]!.url, 'http://x');
    expect(url.pathname).toBe('/api/v1/revisions');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      actor_kind: 'machine',
      type: 'draft',
      cursor: 'abc',
      page_size: '50',
    });
  });

  it('drops anything the route does not accept (it 400s an unknown param)', async () => {
    body = { next: null, results: [] };
    await revisionFeedClient().list({ q: 'x', page: 2, action: 'y' } as never);
    expect(new URL(seen[0]!.url, 'http://x').search).toBe('');
  });
});
