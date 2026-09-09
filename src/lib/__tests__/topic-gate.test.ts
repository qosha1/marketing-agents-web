/**
 * The wire normalization the server-side gate stands on (bd startsim-ozpjw.2).
 *
 * These are not shape-mapping busywork. `tenantFetch` returns Django's raw JSON,
 * and `resolveReviewConfig`'s `pickStatusAttr` filters on `a.dataType === 'enum'`
 * — so handing it the wire's `data_type` finds zero enum attributes, resolves
 * `transitions.approve: null`, and makes `canGenerateDrafts` refuse every topic
 * including approved ones. The gate would then read as "working" in a camelCase
 * test while the button was dead in production for everyone.
 *
 * So the first test below asserts the normalizer is LOAD-BEARING: the same
 * fixture resolves `approve: 'ready'` through it and `approve: null` without it.
 * If someone ever "simplifies" the mapping away, that is the test that fires.
 */
import { describe, expect, it, vi } from 'vitest';

import { resolveReviewConfig } from '@startsimpli/ui/collection';

import { DRAFT_SCAN } from '@/lib/topic-drafts';
import { entityFromWire, entityTypeFromWire, resolveTopicGate } from '@/lib/topic-gate';

/** The topic type exactly as the tenant backend serializes it. */
const TOPIC_TYPE_WIRE = {
  id: 'type-1',
  key: 'topic',
  label: 'Topic',
  attributes: [
    { id: 'a1', name: 'title', data_type: 'text', required: false, config: {} },
    {
      id: 'a2',
      name: 'status',
      data_type: 'enum',
      required: false,
      config: { choices: ['suggested', 'ready', 'written', 'rejected'] },
    },
  ],
};

describe('entityTypeFromWire', () => {
  it('is load-bearing: the raw wire shape resolves NO approve status', () => {
    // Without the mapping, pickStatusAttr sees no `dataType: 'enum'` attribute.
    const unmapped = resolveReviewConfig(TOPIC_TYPE_WIRE as never);
    expect(unmapped.transitions.approve).toBeNull();

    // With it, the review map is the one the drawer's Approve button uses.
    const mapped = resolveReviewConfig(entityTypeFromWire(TOPIC_TYPE_WIRE));
    expect(mapped.statusName).toBe('status');
    expect(mapped.transitions.approve).toBe('ready');
    expect(mapped.transitions.reject).toBe('rejected');
  });

  it('carries the enum choices across, since the transitions are derived from them', () => {
    const t = entityTypeFromWire(TOPIC_TYPE_WIRE);
    expect(t.attributes.map((a) => a.dataType)).toEqual(['text', 'enum']);
    expect(t.attributes[1].config).toEqual({
      choices: ['suggested', 'ready', 'written', 'rejected'],
    });
  });

  it('survives a type with no attributes rather than throwing', () => {
    expect(entityTypeFromWire({ id: 1, key: 'x', label: 'X' }).attributes).toEqual([]);
    expect(entityTypeFromWire(null).key).toBe('');
  });
});

describe('entityFromWire', () => {
  it('maps the snake_case record keys the browser client would have camelised', () => {
    const rec = entityFromWire({
      id: 7,
      entity_type: 'topic',
      external_id: 'topic-7',
      name: 'A Topic',
      data: { status: 'ready' },
      created_at: '2026-08-01T00:00:00Z',
    });
    expect(rec.entityType).toBe('topic');
    expect(rec.externalId).toBe('topic-7');
    expect(rec.createdAt).toBe('2026-08-01T00:00:00Z');
    // The data blob is passed through untouched — `readData` is casing-aware and
    // already handles the snake key the wire actually sends.
    expect(rec.data).toEqual({ status: 'ready' });
  });
});

/** The draft type as the live tenant declares it SINCE 2026-09-07 — with
 *  `topic_ref` (bd startsim-8hgmq.11). */
const DRAFT_TYPE_WIRE = {
  id: 'type-2',
  key: 'draft',
  label: 'Draft',
  attributes: [
    { id: 'b1', name: 'status', data_type: 'enum', required: false, config: { choices: ['ready_for_review'] } },
    { id: 'b2', name: 'topic_ref', data_type: 'text', required: false, config: {} },
  ],
};

/** The same type as it stood for the two weeks it was firing the writer twice. */
const DRAFT_TYPE_WIRE_UNDECLARED = {
  ...DRAFT_TYPE_WIRE,
  attributes: DRAFT_TYPE_WIRE.attributes.filter((a) => a.name !== 'topic_ref'),
};

/**
 * A reader that answers from fixed pages, and records what it was asked for.
 *
 * IT MODELS THE TENANT'S THIRD ANSWER FROM THE SCHEMA IT WAS GIVEN, which is
 * the only way this fixture can be trusted. A filter on `attr.<name>` is:
 *
 *  - HONOURED, and the rows really are narrowed, when `<name>` is DECLARED on
 *    the type named by `?type=` in `pages.types`;
 *  - ACCEPTED AND MATCHED NOTHING when it is not — `count: 0`, the parameter
 *    listed in `applied_filters` and NOT in `ignored_filters`, indistinguishable
 *    from a filter that legitimately found nothing. That is what `topic_ref` did
 *    on the live tenant until it was declared (bd startsim-8hgmq.4), and it cost
 *    the Drafts tab its entire contents and the drafts-exist gate its whole
 *    purpose.
 *
 * `attrFilter: 'ignored'` overrides both to model the MIRROR silence already
 * warned about in `foundry-api.ts`: an UNRECOGNISED parameter is dropped and
 * every row comes back.
 *
 * A reader that answered every `entities?` path with the fixture rows would
 * model NEITHER — it quietly assumes the filter worked. That is the fixture this
 * file used to ship, and it is why the gate read as covered while the writer was
 * being fired twice over the same topic on the live tenant.
 */
function reader(
  pages: {
    topic: unknown;
    types?: unknown[];
    drafts?: unknown[];
  },
  attrFilter: 'schema' | 'ignored' = 'schema',
): { read: <T>(p: string) => Promise<T>; paths: string[] } {
  const paths: string[] = [];
  const types = pages.types ?? [TOPIC_TYPE_WIRE, DRAFT_TYPE_WIRE];
  const declaredOn = (typeKey: string, attr: string) =>
    (types as { key?: string; attributes?: { name: string }[] }[])
      .find((t) => t.key === typeKey)
      ?.attributes?.some((a) => a.name === attr) ?? false;

  const read = async <T,>(path: string): Promise<T> => {
    paths.push(path);
    if (path.startsWith('schema/types')) {
      return { count: types.length, next: null, previous: null, results: types } as T;
    }
    if (path.startsWith('entities?')) {
      const query = new URLSearchParams(path.slice(path.indexOf('?') + 1));
      const typeKey = query.get('type') ?? '';
      let rows = pages.drafts ?? [];
      for (const [key, value] of query.entries()) {
        if (!key.startsWith('attr.')) continue;
        if (attrFilter === 'ignored') continue; // dropped; the whole list comes back
        const name = key.slice('attr.'.length).split('__')[0];
        rows = declaredOn(typeKey, name)
          ? rows.filter((d) => String((d as { data?: Record<string, unknown> }).data?.[name] ?? '') === value)
          : [];
      }
      return { count: rows.length, next: null, previous: null, results: rows } as T;
    }
    return pages.topic as T;
  };
  return { read, paths };
}

const topicWire = (status: string) => ({
  id: 55,
  entity_type: 'topic',
  external_id: 'topic-55',
  name: 'T',
  data: { status },
});

describe('resolveTopicGate', () => {
  it('refuses an unapproved topic and allows an approved one with no drafts', async () => {
    const no = reader({ topic: topicWire('suggested') });
    expect(await resolveTopicGate(no.read, '55')).toMatchObject({
      allowed: false,
      reason: 'not_approved',
    });

    const yes = reader({ topic: topicWire('ready') });
    expect(await resolveTopicGate(yes.read, '55')).toEqual({ allowed: true });
  });

  // This assertion has now been written three ways, and the history is the
  // point. It first pinned `attr.topic_ref=55` on the request — and that filter
  // WAS the defect (bd startsim-8hgmq.3): `topic_ref` was not a declared
  // attribute on the draft type, so the tenant accepted it, matched nothing, and
  // the count this gate stands on was 0 for every topic in the tenant, always.
  // It was then rewritten to pin the OPPOSITE, that no `attr.` filter is sent at
  // all. `topic_ref` is declared now (bd startsim-8hgmq.11), so the narrowing is
  // back — behind a check of the schema this function already fetches, never
  // behind an assumption about it.
  it('narrows by attr.topic_ref once the draft type declares it', async () => {
    const r = reader({ topic: topicWire('ready') });
    await resolveTopicGate(r.read, '55');
    const listings = r.paths.filter((p) => p.startsWith('entities?'));
    expect(listings.length).toBeGreaterThan(0);
    expect(listings.every((p) => p.includes('type=draft'))).toBe(true);
    expect(listings.every((p) => p.includes('attr.topic_ref=55'))).toBe(true);
  });

  it('asks for NO attr filter when the draft type does not declare topic_ref', async () => {
    // THE GUARANTEE THIS BEAD BUYS. Undeclare the attribute — by hand, by a
    // rebuilt tenant, by a foundry that never had it — and the request stops
    // carrying a filter the backend would answer with `count: 0`. The gate falls
    // back to listing by `type` and matching in JS: slower, and correct. The
    // failure mode is a page of extra rows, never a silent zero.
    const r = reader({
      topic: topicWire('ready'),
      types: [TOPIC_TYPE_WIRE, DRAFT_TYPE_WIRE_UNDECLARED],
      drafts: [
        { id: 1, data: { topic_ref: '55' } },
        { id: 2, data: { topic_ref: '55' } },
        { id: 3, data: { topic_ref: '55' } },
      ],
    });
    const gate = await resolveTopicGate(r.read, '55');
    const listings = r.paths.filter((p) => p.startsWith('entities?'));
    expect(listings.some((p) => p.includes('attr.'))).toBe(false);
    // …and it still refuses, which is the whole reason the fallback exists.
    expect(gate).toMatchObject({ allowed: false, reason: 'drafts_exist' });
  });

  it('refuses a written topic — the 2026-09-07 double-relay, both ways round', async () => {
    // THE DEFECT, at the seam that was supposed to stop it (bd startsim-8hgmq.3).
    // Three drafts for topic 55 are sitting in the tenant. The gate asked for
    // them behind `attr.topic_ref=55`; the backend accepted that filter, matched
    // nothing because `topic_ref` was undeclared, and returned `count: 0`. The JS
    // re-count then ran over an EMPTY array, `draftCount` came out 0, and the
    // writer was relayed a second time — six near-duplicate Saudi WHT drafts in
    // the review queue, n8n executions 12848 and 12853, the second fired 79
    // seconds AFTER the first three had landed.
    //
    // The reader models the tenant from its own schema, so this is now asserted
    // under BOTH postures: with topic_ref declared (the filter narrows for real)
    // and with it undeclared (the request must not carry it at all). The test
    // above pins the undeclared half; this pins the declared one.
    const r = reader({
      topic: topicWire('ready'),
      drafts: [
        { id: 1, data: { topic_ref: '55' } },
        { id: 2, data: { topic_ref: '55' } },
        { id: 3, data: { topic_ref: '55' } },
      ],
    });
    expect(await resolveTopicGate(r.read, '55')).toMatchObject({
      allowed: false,
      reason: 'drafts_exist',
    });
  });

  it('counts rows itself, so an IGNORED filter cannot refuse an eligible topic', async () => {
    // The deployed tenant silently ignores an unrecognised parameter, so the
    // envelope can come back holding every draft. Trusting `count` here would
    // report drafts_exist for a topic that has none.
    const r = reader(
      {
        topic: topicWire('ready'),
        drafts: [
          { id: 1, data: { topic_ref: '999' } },
          { id: 2, data: { topic_ref: '1000' } },
        ],
      },
      'ignored',
    );
    expect(await resolveTopicGate(r.read, '55')).toEqual({ allowed: true });
  });

  it('refuses when this topic’s drafts are among the returned rows', async () => {
    const r = reader({
      topic: topicWire('ready'),
      drafts: [
        { id: 1, data: { topic_ref: '999' } },
        { id: 2, data: { topic_ref: '55' } },
      ],
    });
    expect(await resolveTopicGate(r.read, '55')).toMatchObject({
      allowed: false,
      reason: 'drafts_exist',
    });
  });

  it('fails closed when the topic’s type is not in the schema at all', async () => {
    // resolveReviewConfig(null) derives approve: null. A coerced comparison
    // would read that as approved and hand back the ungated relay.
    const r = reader({ topic: topicWire('ready'), types: [{ id: 9, key: 'other', label: 'Other' }] });
    expect(await resolveTopicGate(r.read, '55')).toMatchObject({
      allowed: false,
      reason: 'not_approved',
    });
  });
});

/**
 * ONE BOUND FOR BOTH HALVES OF THE GATE (bd startsim-8hgmq.13).
 *
 * The gate is asked twice about the same question — "does this topic already
 * have drafts?" — once by the drawer and once by the route it guards. Both
 * answer it by paging the draft corpus, and until this suite they paged to
 * DIFFERENT depths: the client to `listAllEntities`'s 50 x 200, the server to a
 * private MAX_PAGES 5 x 200. Ten times apart, over the same list, for the same
 * decision.
 *
 * WHAT THE DISAGREEMENT COSTS is not a wrong count — the server half throws
 * rather than under-count, deliberately (a count that could not be established
 * is not a count of zero; that is the hole bd startsim-8hgmq.3 came from). It
 * costs the reviewer a 502 "Could not verify the topic" on a topic the drawer
 * itself was perfectly able to resolve. The button refuses, the drawer beside
 * it shows the drafts it counted, and nothing on screen explains the gap.
 *
 * THE HONEST SCOPE, said out loud so the next reader does not overestimate this
 * fix: `topic_ref` is DECLARED now (bd startsim-8hgmq.11), so the server half
 * narrows and a truncated NARROWED read would mean one topic owns more than the
 * whole ceiling — at which point the count is not zero and the throw does not
 * fire. The reachable path is the UNNARROWED fallback, the one taken when the
 * draft type stops declaring the attribute. That fallback is real, it is the
 * path that was live for two weeks, and its ceiling should not be a different
 * number from the one the drawer uses. It is not "the intermittent failure the
 * bead was filed for" — that symptom needs 1,000 drafts and the tenant holds
 * 156.
 */
describe('the two halves of the drafts gate read to the same depth', () => {
  /**
   * A reader whose draft listing actually PAGES.
   *
   * The `reader` above answers every listing with `next: null`, which is right
   * for what it pins and useless here: nothing truncates, so both bounds look
   * identical. This one honours `page`, reports `next` until the last page, and
   * records every listing it was asked for — so a test can assert WHERE it
   * stopped, not merely what it concluded.
   */
  function pagingReader({
    pages,
    matchOnPage,
    types,
  }: {
    pages: number;
    /** 1-based page carrying a draft for topic 55; 0 for a corpus with none. */
    matchOnPage: number;
    types?: unknown[];
  }) {
    const listings: string[] = [];
    const schema = types ?? [TOPIC_TYPE_WIRE, DRAFT_TYPE_WIRE_UNDECLARED];
    const read = async <T,>(path: string): Promise<T> => {
      if (path.startsWith('schema/types')) {
        return { count: schema.length, next: null, previous: null, results: schema } as T;
      }
      if (path.startsWith('entities?')) {
        listings.push(path);
        const page = Number(new URLSearchParams(path.slice(path.indexOf('?') + 1)).get('page'));
        const rows =
          page === matchOnPage
            ? [{ id: page * 1000, data: { topic_ref: '55' } }]
            : [{ id: page * 1000, data: { topic_ref: '999' } }];
        return {
          count: rows.length,
          next: page < pages ? `?page=${page + 1}` : null,
          previous: null,
          results: rows,
        } as T;
      }
      return topicWire('ready') as T;
    };
    return { read, listings };
  }

  it('counts a draft that sits past the OLD five-page bound instead of throwing over it', async () => {
    // Six pages of an UNNARROWED listing — the fallback the gate takes when the
    // draft type does not declare `topic_ref` — with this topic's only draft on
    // the last one. The drawer, reading to 50 pages, has always seen it.
    const r = pagingReader({ pages: 6, matchOnPage: 6 });
    expect(await resolveTopicGate(r.read, '55')).toMatchObject({
      allowed: false,
      reason: 'drafts_exist',
    });
  });

  it('stops at the SAME ceiling the drawer stops at, and still refuses to guess', async () => {
    // A corpus with no end and no match. The throw is the point and must stay:
    // waving the topic through here would re-open bd startsim-8hgmq.3.
    const r = pagingReader({ pages: Number.MAX_SAFE_INTEGER, matchOnPage: 0 });
    await expect(resolveTopicGate(r.read, '55')).rejects.toThrow(/truncated/);
    // WHERE it stopped, not just that it did: this is the assertion that fails
    // if either half's bound moves without the other's.
    expect(r.listings.length).toBe(DRAFT_SCAN.maxPages);
    expect(r.listings.every((p) => p.includes(`page_size=${DRAFT_SCAN.pageSize}`))).toBe(true);
  });

  it('names the bound the client half reads, so the two cannot drift apart again', async () => {
    // `fetchTopicDrafts` used to lean on `listAllEntities`'s DEFAULT maxPages.
    // A default is not a shared bound: it can be retuned for the news_item board
    // and silently move the gate's client half out from under its server half.
    // So the client half names DRAFT_SCAN too, and this pins that it does.
    const listAllEntities = vi.fn().mockResolvedValue([]);
    vi.doMock('@/lib/foundry-api', () => ({
      listAllEntities,
      listRelationships: vi.fn().mockResolvedValue({ results: [], next: null }),
    }));
    const { fetchTopicDrafts } = await import('@/lib/topic-drafts');
    await fetchTopicDrafts({ id: 55, externalId: null });
    expect(listAllEntities).toHaveBeenCalledWith('draft', DRAFT_SCAN);
    vi.doUnmock('@/lib/foundry-api');
  });
});
