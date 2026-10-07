import { describe, it, expect } from 'vitest';

import { readReview, readNotes, revisedFrom, revisionChain } from '../review';
import type { EntityRecord } from '@/lib/foundry-api';

function draft(id: number, data: Record<string, unknown>): EntityRecord {
  return { id, entityType: 'draft', externalId: null, name: `#${id}`, data, createdAt: '' };
}

describe('readReview / readNotes', () => {
  it('reads a stored review object and defaults to empty', () => {
    expect(readReview({ review: { verdict: 'approve' } })).toEqual({ verdict: 'approve' });
    expect(readReview({})).toEqual({});
    expect(readReview(undefined)).toEqual({});
    expect(readReview({ review: 'nope' })).toEqual({});
  });

  // bd startsim-m7fdm.24: "Request changes" is no longer offered, but drafts that
  // carry its stored value are read back exactly as stored, never coerced.
  it('reads a legacy "revise" verdict back unchanged', () => {
    const stored = { verdict: 'revise', overallNote: 'Use a fresher source.' };
    expect(readReview({ review: stored })).toEqual(stored);
  });

  it('reads a stored notes array and defaults to empty', () => {
    const notes = [{ id: '1', body: 'x' }];
    expect(readNotes({ notes })).toEqual(notes);
    expect(readNotes({})).toEqual([]);
    expect(readNotes({ notes: 'nope' })).toEqual([]);
  });
});

describe('revisedFrom + revisionChain', () => {
  it('reads revised_from (snake) and revisedFrom (camel) forms', () => {
    expect(revisedFrom(draft(2, { revised_from: '1' }))).toBe('1');
    expect(revisedFrom(draft(3, { revisedFrom: '2' }))).toBe('2');
    expect(revisedFrom(draft(1, {}))).toBe('');
  });

  it('orders a lineage oldest → newest from any member', () => {
    const v1 = draft(1, {});
    const v2 = draft(2, { revised_from: '1' });
    const v3 = draft(3, { revised_from: '2' });
    const all = [v3, v1, v2]; // unordered input
    for (const focus of [v1, v2, v3]) {
      expect(revisionChain(focus, all).map((d) => d.id)).toEqual([1, 2, 3]);
    }
  });

  it('returns a singleton chain for an original with no revisions', () => {
    const v1 = draft(1, {});
    expect(revisionChain(v1, [v1]).map((d) => d.id)).toEqual([1]);
  });

  it('terminates on a missing parent link rather than looping', () => {
    const orphan = draft(5, { revised_from: '999' }); // parent not present
    expect(revisionChain(orphan, [orphan]).map((d) => d.id)).toEqual([5]);
  });
});
