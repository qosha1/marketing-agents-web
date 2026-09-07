import { describe, it, expect } from 'vitest';
import {
  applyTopicGate,
  draftsGateNeedsClient,
  draftsViewFilters,
} from '../drafts-view';
import { MAX_IN_VALUES } from '../board';
import type { AttributeDef, EntityRecord } from '../foundry-api';

/**
 * The Drafts tab opened EMPTY for every user, always (bd startsim-8hgmq.4), and
 * this file is what it left behind.
 *
 * `topic_ref` was not a DECLARED attribute on the draft type, and the tenant
 * backend answers `attr.<undeclared>` with `count: 0` while reporting it in
 * `applied_filters` and NOT in `ignored_filters` — indistinguishable from a
 * filter that legitimately matched nothing. So the default view narrowed to zero
 * rows under a chip that said "Topic approved", and the only way to see any
 * draft was to press "Show everything".
 *
 * `topic_ref` IS DECLARED NOW (bd startsim-8hgmq.11, verified live: 147 drafts
 * carry it and `?attr.topic_ref__in=<26 approved ids>` answers 81, having
 * answered 0 the hour before). So the server-side narrowing rule 8 asks for is
 * back — but it is back BEHIND A RUNTIME CHECK, not behind a comment saying the
 * attribute is declared.
 *
 * THAT CHECK IS THE POINT OF THIS FILE. The page already holds the draft type's
 * attributes; the filter is built only when `topic_ref` is among them. Undeclare
 * it — by hand, by a rebuilt tenant, by a type that never had it — and the
 * request silently stops carrying the filter and the client narrows instead:
 * correct-but-slower, which is the failure mode this bead exists to guarantee.
 * It also fail-safes while the type is still loading, when `attributes` is [].
 */
const draft = (id: number, topicRef?: string): EntityRecord =>
  ({ id, name: `d${id}`, data: topicRef ? { topic_ref: topicRef } : {} }) as unknown as EntityRecord;

const attr = (name: string): AttributeDef =>
  ({ id: name, name, dataType: 'text', required: false, config: {} }) as AttributeDef;

/** The draft type as the live tenant declares it since 2026-09-07. */
const DECLARED = [attr('status'), attr('content_type'), attr('topic_ref')];
/** The same type as it stood while it was emptying the tab for everyone. */
const UNDECLARED = [attr('status'), attr('content_type')];

describe('the drafts topic gate narrows server-side, but only where the schema says it can', () => {
  it('sends attr.topic_ref__in once the attribute is declared', () => {
    expect(draftsViewFilters({}, ['11', '22'], DECLARED)).toEqual({
      'attr.topic_ref__in': '11,22',
    });
  });

  it('sends NOTHING when topic_ref is undeclared, whatever ids it was handed', () => {
    // The 8hgmq.4 tenant. A request carrying this filter comes back `count: 0`
    // with the parameter in `applied_filters`, and the table renders
    // "0 total / No results found" under a chip claiming to have filtered.
    expect(draftsViewFilters({}, ['11', '22'], UNDECLARED)).toEqual({});
  });

  it('sends nothing while the type is still loading', () => {
    // `type?.attributes ?? []` is what the page passes before the schema query
    // resolves. An empty list must read as "cannot narrow", never as "narrow by
    // nothing" — the second is a request that comes back empty.
    expect(draftsViewFilters({}, ['11', '22'], [])).toEqual({});
  });

  it('sends no sentinel filter when nothing is approved', () => {
    // The original code sent `attr.topic_ref__in=__none__` here. It matched
    // nothing — but so did the real id list, which is what hid the defect.
    // An empty list is not narrowable server-side; applyTopicGate over an empty
    // id set returns the same empty answer without a request that lies.
    expect(draftsViewFilters({}, [], DECLARED)).toEqual({});
  });

  it('sends nothing past the backend comma-list cap', () => {
    const tooMany = Array.from({ length: MAX_IN_VALUES + 1 }, (_, i) => String(i));
    expect(draftsViewFilters({}, tooMany, DECLARED)).toEqual({});
    // …and exactly at the cap it still narrows.
    const atCap = Array.from({ length: MAX_IN_VALUES }, (_, i) => String(i));
    expect(Object.keys(draftsViewFilters({}, atCap, DECLARED))).toEqual(['attr.topic_ref__in']);
  });

  it('sends nothing once the reader clears the gate', () => {
    expect(draftsViewFilters({ topic: 'all' }, ['11'], DECLARED)).toEqual({});
  });

  it('STILL narrows on the client while the gate is on, declared or not', () => {
    // The server filter is an optimisation, never the only gate. It costs one
    // Set lookup over rows already in memory, and it is the standing defence
    // against the MIRROR silence `foundry-api.ts` warns about: an unrecognised
    // parameter that is dropped, returning EVERYTHING under an active chip.
    expect(draftsGateNeedsClient({}, ['11', '22'])).toBe(true);
    expect(draftsGateNeedsClient({}, [])).toBe(true);
  });

  it('asks for no client narrowing once the gate is cleared', () => {
    expect(draftsGateNeedsClient({ topic: 'all' }, ['11'])).toBe(false);
  });

  it('keeps only the drafts written for an approved topic', () => {
    const rows = [draft(1, '11'), draft(2, '99'), draft(3), draft(4, '22')];
    expect(applyTopicGate(rows, ['11', '22']).map((r) => r.id)).toEqual([1, 4]);
    expect(applyTopicGate(rows, [])).toEqual([]);
  });
});
