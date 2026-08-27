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
import { describe, expect, it } from 'vitest';

import { resolveReviewConfig } from '@startsimpli/ui/collection';

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

/** A reader that answers from fixed pages, and records what it was asked for. */
function reader(pages: {
  topic: unknown;
  types?: unknown[];
  drafts?: unknown[];
}): { read: <T>(p: string) => Promise<T>; paths: string[] } {
  const paths: string[] = [];
  const read = async <T,>(path: string): Promise<T> => {
    paths.push(path);
    if (path.startsWith('schema/types')) {
      return { count: 1, next: null, previous: null, results: pages.types ?? [TOPIC_TYPE_WIRE] } as T;
    }
    if (path.startsWith('entities?')) {
      const rows = pages.drafts ?? [];
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

  it('asks the tenant with the verified attr.<name> filter shape', async () => {
    const r = reader({ topic: topicWire('ready') });
    await resolveTopicGate(r.read, '55');
    expect(r.paths.some((p) => p.includes('type=draft') && p.includes('attr.topic_ref=55'))).toBe(
      true,
    );
  });

  it('counts rows itself, so an IGNORED filter cannot refuse an eligible topic', async () => {
    // The deployed tenant silently ignores an unrecognised parameter, so the
    // envelope can come back holding every draft. Trusting `count` here would
    // report drafts_exist for a topic that has none.
    const r = reader({
      topic: topicWire('ready'),
      drafts: [
        { id: 1, data: { topic_ref: '999' } },
        { id: 2, data: { topic_ref: '1000' } },
      ],
    });
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
