/**
 * THE TRAIL IS READ WITHOUT THE CASE TRANSFORM (bd startsim-j19hf).
 *
 * `metadata.changed` is keyed by the TENANT'S OWN DECLARED ATTRIBUTE NAMES, and
 * the shared API client camelCases every response key recursively with no
 * preserve list. So reading this route through `@/lib/api` renames
 * `judge_verdict` to `judgeVerdict` on the way to a panel that renders field
 * names verbatim and deliberately never re-cases them — and there is no safe
 * inverse, because `snake_to_camel` is not injective (lib/foundry-api.ts
 * measures it: `source_1` becomes `source1` and cannot be turned back).
 *
 * This repo has already had one camelisation corruption incident over that exact
 * transform, so what is pinned here is the SHAPE OF THE REQUEST and the fact that
 * the response reaches the caller untouched. A test that only checked the panel
 * rendered something would pass with every field name silently renamed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/infrastructure/auth', () => ({
  getRegisteredToken: async () => 'test-token',
  registerTokenProvider: () => {},
}));

import { revisionClient } from '../revisions';

const seen: Array<{ url: string; headers: Record<string, string> }> = [];
const realFetch = globalThis.fetch;

/** One row of the trail, spelled the way the tenant actually serves it. */
const ROW = {
  id: 'r1',
  version: 4,
  action: 'updated',
  source: 'patch',
  precondition: 'matched',
  created_at: '2026-10-06T08:00:00Z',
  actor_label: 'jurga@ogmc.example',
  actor_kind: 'person',
  actor_kind_source: 'claim',
  metadata: {
    changed: {
      judge_verdict: { before: 'revise', after: 'approve' },
      candidate_index: { after: 2 },
    },
  },
};

function answer(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

let status = 200;
let body: unknown = { count: 1, next: null, previous: null, results: [ROW] };

beforeEach(() => {
  seen.length = 0;
  status = 200;
  body = { count: 1, next: null, previous: null, results: [ROW] };
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    seen.push({
      url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      headers,
    });
    return answer(status, body);
  }) as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('revisionClient', () => {
  it('hands back the DECLARED attribute spellings, not camelised ones', async () => {
    const page = await revisionClient('d1').list({ page: 1, pageSize: 50 });

    const changed = page.results?.[0]?.metadata?.changed ?? {};
    expect(Object.keys(changed).sort()).toEqual(['candidate_index', 'judge_verdict']);
    // And the row's own keys stay snake too — which is fine, because the shared
    // panel reads either spelling for ITS keys and only the field names matter.
    expect(page.results?.[0]?.actor_kind).toBe('person');
  });

  it('asks the nested route with a page and a page_size, and no trailing slash', async () => {
    await revisionClient('d1').list({ page: 2, pageSize: 25 });

    // Server-side pagination (repo rule 8). The slash is the Next rewrite's to
    // add — writing one here arrives at Django doubled and DRF will not route it.
    expect(seen[0]!.url).toBe('/api/v1/entities/d1/revisions?page=2&page_size=25');
  });

  it('carries the caller’s own bearer', async () => {
    await revisionClient('d1').list({});

    expect(seen[0]!.headers.authorization).toBe('Bearer test-token');
  });

  it('throws a 404 WITH its status, so the panel can say "not available to you"', async () => {
    // The route is nested and resolves its parent through the gated queryset, so
    // a 404 means the PARENT record is unreadable. The panel branches on the
    // status to render that rather than an empty trail — two different facts, and
    // the wrong one tells a reviewer nobody has ever edited the record.
    status = 404;
    body = { detail: 'Not found.' };

    await expect(revisionClient('d1').list({})).rejects.toMatchObject({ status: 404 });
  });
});
