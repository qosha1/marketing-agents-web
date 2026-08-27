/**
 * The recency filter has to SURVIVE the request path (bd startsim-wn2p.24).
 *
 * WHY THIS TEST IS NOT PARANOIA. The deployed tenant SILENTLY IGNORES a query
 * parameter it does not recognise — measured: `?bogus_param=1` returns all 4,116
 * news_items rather than a 400. So a filter key mangled anywhere between this
 * module and Django does not fail; it reads as "no filter", the board fetches the
 * whole type, and the only symptom is that it feels slow. That is exactly the
 * defect this issue started from, wearing a fix's clothes.
 *
 * The specific hazard is the shared @startsimpli/api client, which rewrites
 * request keys between camelCase and snake_case. `attr.published_at__gte` is
 * neither, which is why `listEntities` puts filters in the URL and not in
 * `params` — and this test is what stops someone "tidying" them back into
 * `params` later.
 *
 * The OTHER half of the chain — that the tenant honours the parameter once it
 * arrives — was measured live through the app's own Next proxy on 2026-08-24:
 *   GET localhost:4021/api/v1/entities?type=news_item&attr.published_at__gte=2026-08-10
 *   -> {"count": 1135}   (unfiltered: 4116)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { listAllEntities, listEntities } from '../foundry-api';

const seen: string[] = [];
const realFetch = globalThis.fetch;

function page(results: unknown[], next: string | null) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({ count: results.length, next, previous: null, results }),
    text: async () => JSON.stringify({ count: results.length, next, previous: null, results }),
  } as unknown as Response;
}

beforeEach(() => {
  seen.length = 0;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    seen.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    return page([], null);
  }) as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** The whole query string the client actually put on the wire, decoded. */
function lastQuery(): string {
  const url = seen[seen.length - 1] ?? '';
  return decodeURIComponent(url.slice(url.indexOf('?')));
}

describe('listEntities filters reach the wire intact', () => {
  it('sends attr.<name>__gte exactly as the backend spells it', async () => {
    await listEntities('news_item', 1, { 'attr.published_at__gte': '2026-08-10' });
    // Not `attrPublishedAtGte`, not `attr_published_at__gte` — the literal key.
    expect(lastQuery()).toContain('attr.published_at__gte=2026-08-10');
  });

  it('still sends type and page alongside the filter', async () => {
    await listEntities('news_item', 3, { 'attr.published_at__gte': '2026-08-10' });
    const q = lastQuery();
    expect(q).toContain('type=news_item');
    expect(q).toContain('page=3');
  });

  it('adds no query at all when there are no filters', async () => {
    await listEntities('draft', 1);
    expect(lastQuery()).not.toContain('attr.');
  });
});

describe('the findability filters reach the wire intact (bd startsim-f4lac)', () => {
  it('sends attr.<name>__icontains — the title search, not a client-side scan', () => {
    return listEntities('draft', 1, { 'attr.title__icontains': 'qatar' }).then(() => {
      // The dot and the double underscore both survive the shared client's
      // camel/snake rewriting, or the search silently searches nothing.
      expect(lastQuery()).toContain('attr.title__icontains=qatar');
    });
  });

  it('sends attr.<name>__in as a COMMA list — the approved-topic gate', () => {
    return listEntities('draft', 1, { 'attr.topic_ref__in': '10,11,12' }).then(() => {
      // `_coerce` in tenant-starter apps/api/filters.py splits on commas.
      expect(lastQuery()).toContain('attr.topic_ref__in=10,11,12');
    });
  });

  it('sends the match-nothing sentinel rather than dropping an empty gate', async () => {
    // A gate that matches nothing must NARROW to nothing. Dropping the filter
    // would widen to the whole corpus under an active filter chip — the failure
    // that handed a cleanup loop page 1 and cost nine production rows.
    await listEntities('draft', 1, { 'attr.topic_ref__in': '__none__' });
    expect(lastQuery()).toContain('attr.topic_ref__in=__none__');
  });
});

describe('listAllEntities', () => {
  it('carries the filter onto every page request, and asks for 200 at a time', async () => {
    await listAllEntities('news_item', { filters: { 'attr.published_at__gte': '2026-08-10' } });
    expect(seen.length).toBeGreaterThan(0);
    for (const url of seen) {
      const q = decodeURIComponent(url);
      expect(q).toContain('attr.published_at__gte=2026-08-10');
      expect(q).toContain('page_size=200');
    }
  });

  it('accepts the legacy positional maxPages without sprouting a bogus filter', async () => {
    await listAllEntities('draft', 5);
    expect(lastQuery()).not.toContain('attr.');
    expect(lastQuery()).toContain('page_size=200');
  });
});

