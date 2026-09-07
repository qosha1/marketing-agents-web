import { describe, it, expect } from 'vitest';
import {
  applyTopicGate,
  draftsGateNeedsClient,
  draftsViewFilters,
} from '../drafts-view';
import type { EntityRecord } from '../foundry-api';

/**
 * The Drafts tab opened EMPTY for every user, always (bd startsim-8hgmq.4).
 *
 * `topic_ref` is not a DECLARED attribute on the draft type, and the tenant
 * backend answers `attr.<undeclared>` with `count: 0` while reporting it in
 * `applied_filters` and NOT in `ignored_filters` — indistinguishable from a
 * filter that legitimately matched nothing. So the default view narrowed to
 * zero rows under a chip that said "Topic approved", and the only way to see
 * any draft was to press "Show everything".
 *
 * `foundry-api.ts` already warns about the MIRROR of this — an UNRECOGNISED
 * parameter is silently ignored and returns EVERYTHING. Same silence, opposite
 * direction; only one of the two was defended against.
 *
 * The gate itself is not in doubt, only where it runs. The client-side form
 * already existed for the cap-exceeded case; these tests pin that it is now the
 * ONLY form, so no request can ever again carry a filter the server answers
 * with nothing.
 */
const draft = (id: number, topicRef?: string): EntityRecord =>
  ({ id, name: `d${id}`, data: topicRef ? { topic_ref: topicRef } : {} }) as unknown as EntityRecord;

describe('the drafts topic gate runs on the client, never as a request filter', () => {
  it('sends no topic_ref filter even with approved topics to narrow by', () => {
    expect(draftsViewFilters({}, ['11', '22'])).toEqual({});
  });

  it('sends no sentinel filter when nothing is approved', () => {
    // The old code sent `attr.topic_ref__in=__none__` here. It matched nothing —
    // but so did the real id list, which is the whole defect.
    expect(draftsViewFilters({}, [])).toEqual({});
  });

  it('still sends nothing once the reader clears the gate', () => {
    expect(draftsViewFilters({ topic: 'all' }, ['11'])).toEqual({});
  });

  it('always asks the caller to narrow on the client while the gate is on', () => {
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
