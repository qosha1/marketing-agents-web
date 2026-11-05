import { describe, expect, it } from 'vitest';

import { documentReview, reviewDocumentData, REVIEW_LABEL } from '../review';
import { NEWS_TYPE, record } from './fixtures';

describe('document review (Good / Not good / Not reviewed)', () => {
  it('reads the stored news status through the shared news vocabulary', () => {
    expect(documentReview(record('1', 'news_item', { status: 'acceptable' }), NEWS_TYPE)).toBe('good');
    expect(documentReview(record('2', 'news_item', { status: 'rejected' }), NEWS_TYPE)).toBe('not_good');
    for (const s of ['new', 'surfaced', 'cited', 'ignored', 'preview_only']) {
      expect(documentReview(record('3', 'news_item', { status: s }), NEWS_TYPE)).toBe('unreviewed');
    }
  });

  it('says Good, Not good, Not reviewed', () => {
    expect(REVIEW_LABEL).toEqual({ good: 'Good', not_good: 'Not good', unreviewed: 'Not reviewed' });
  });

  it('Good writes acceptable and Not good writes rejected, keeping the rest of the blob', () => {
    const doc = record('1', 'news_item', { title: 'T', url: 'u', status: 'new' });
    expect(reviewDocumentData(doc, 'good', NEWS_TYPE)).toMatchObject({ title: 'T', url: 'u', status: 'acceptable' });
    expect(reviewDocumentData(doc, 'not_good', NEWS_TYPE)).toMatchObject({ title: 'T', status: 'rejected' });
  });

  it('does not invent a verdict field on a type that declares none', () => {
    const data = reviewDocumentData(record('1', 'news_item', { status: 'new' }), 'good', NEWS_TYPE)!;
    expect(Object.keys(data).sort()).toEqual(['status']);
  });
});
