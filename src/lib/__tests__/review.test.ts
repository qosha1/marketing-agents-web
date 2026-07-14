import { describe, it, expect } from 'vitest';
import type { ReviewScore, ReviewNote } from '@startsimpli/ui';

import { compileFeedback, readReview, readNotes, revisedFrom, revisionChain } from '../review';
import type { EntityRecord } from '@/lib/foundry-api';

function draft(id: number, data: Record<string, unknown>): EntityRecord {
  return { id, entityType: 'draft', externalId: null, name: `#${id}`, data, createdAt: '' };
}

describe('compileFeedback', () => {
  it('joins overall note, dimension notes, and unresolved section notes', () => {
    const review: ReviewScore = {
      verdict: 'revise',
      overallNote: 'Sharpen the lede.',
      dimensions: {
        recency: { score: 2, note: 'Cite a 2026 figure.' },
        accuracy: { score: 5 }, // no note → skipped
        tone: { score: 3, note: 'Less breathless.' },
      },
    };
    const notes: ReviewNote[] = [
      { id: '1', body: 'Weak transition.', section: 'blog' },
      { id: '2', body: 'Fix the hashtag.', section: 'linkedin' },
    ];
    expect(compileFeedback(review, notes)).toBe(
      [
        'Sharpen the lede.',
        'recency: Cite a 2026 figure.',
        'tone: Less breathless.',
        '[blog] Weak transition.',
        '[linkedin] Fix the hashtag.',
      ].join('\n'),
    );
  });

  it('drops resolved notes and defaults a missing section to "general"', () => {
    const notes: ReviewNote[] = [
      { id: '1', body: 'Addressed.', section: 'blog', resolved: true },
      { id: '2', body: 'Still open.' },
    ];
    expect(compileFeedback({}, notes)).toBe('[general] Still open.');
  });

  it('is empty when there is nothing to say', () => {
    expect(compileFeedback({}, [])).toBe('');
    expect(compileFeedback({ overallNote: '   ' }, [])).toBe('');
  });
});

describe('readReview / readNotes', () => {
  it('reads a stored review object and defaults to empty', () => {
    expect(readReview({ review: { verdict: 'approve' } })).toEqual({ verdict: 'approve' });
    expect(readReview({})).toEqual({});
    expect(readReview(undefined)).toEqual({});
    expect(readReview({ review: 'nope' })).toEqual({});
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
