import { describe, expect, it } from 'vitest';

import { agoText, countDraftsByTopic, documentLine, documentSpan, excerptOf, formatDay, formatWeekday, topicRow, topicSourceUrls } from '../topics';
import { record } from './fixtures';

describe('topics list rows', () => {
  const topic = record('t1', 'topic', {
    title: 'New trade route',
    angle: 'Why it matters',
    market: 'UAE',
    status: 'ready',
    source_1: 'https://a.example/1',
    source_2: 'https://b.example/2',
  });

  it('counts the sources a topic cites, under either spelling of the key', () => {
    expect(topicSourceUrls(topic)).toEqual(['https://a.example/1', 'https://b.example/2']);
    const camel = record('t2', 'topic', { source1: 'https://a.example/1', source3: 'https://c.example/3' });
    expect(topicSourceUrls(camel)).toEqual(['https://a.example/1', 'https://c.example/3']);
  });

  it('builds Topic, Sources, Markets, Dates, In Content and nothing else', () => {
    const row = topicRow(topic, 2);
    expect(row).toEqual({
      id: 't1',
      title: 'New trade route',
      angle: 'Why it matters',
      sources: 2,
      markets: 'UAE',
      dates: formatDay('2026-10-20T10:00:00Z'),
      inContent: 2,
    });
  });

  it('tallies drafts per topic from one query, by topic_ref', () => {
    const drafts = [
      record('d1', 'draft', { topic_ref: 't1' }),
      record('d2', 'draft', { topic_ref: 't1' }),
      record('d3', 'draft', { topicRef: 't2' }),
      record('d4', 'draft', {}),
    ];
    expect(countDraftsByTopic(drafts)).toEqual({ t1: 2, t2: 1 });
  });
});

describe('document lines on the topic page', () => {
  const doc = record('n1', 'news_item', {
    title: 'Route opens',
    source_name: 'Example Wire',
    published_at: '2026-10-16',
    snippet: 'The route opened on Monday. A second sentence follows.',
  });

  it('shows outlet and date', () => {
    expect(documentLine(doc)).toBe(`Example Wire · ${formatDay('2026-10-16')}`);
  });

  it('quotes one excerpt, trimmed, preferring the snippet', () => {
    expect(excerptOf(doc)).toBe('The route opened on Monday. A second sentence follows.');
    const long = record('n2', 'news_item', { content: 'x'.repeat(500) });
    expect(excerptOf(long).length).toBeLessThanOrEqual(221);
    expect(excerptOf(record('n3', 'news_item', {}))).toBe('');
  });
});

describe('document dates and ages', () => {
  const doc = (d: string) => record('n', 'news_item', { published_at: d });

  it('spans the topic’s documents, one day shown once', () => {
    expect(documentSpan([doc('2026-10-20'), doc('2026-10-16'), doc('2026-10-18')])).toBe('Oct 16 – Oct 20');
    expect(documentSpan([doc('2026-10-13')])).toBe('Oct 13');
    expect(documentSpan([])).toBe('');
  });

  it('a topic row takes its Dates from its documents, else from when it was made', () => {
    const t = record('t', 'topic', { title: 'T', source_1: 'u1', source_2: 'u2' });
    expect(topicRow(t, 0, { u1: doc('2026-10-14'), u2: doc('2026-10-17') }).dates).toBe('Oct 14 – Oct 17');
    expect(topicRow(t, 0).dates).toBe('Oct 20');
  });

  it('labels weekdays and says how long ago', () => {
    expect(formatWeekday('2026-11-04')).toBe('Wed');
    const now = new Date('2026-11-04T12:00:00Z');
    expect(agoText('2026-11-04T11:48:00Z', now)).toBe('12 minutes ago');
    expect(agoText('2026-11-04T09:00:00Z', now)).toBe('3 hours ago');
    expect(agoText('2026-11-02T12:00:00Z', now)).toBe('2 days ago');
    expect(agoText(undefined, now)).toBe('a while ago');
  });
});
