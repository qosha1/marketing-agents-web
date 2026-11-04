import { describe, expect, it } from 'vitest';

import { countDraftsByTopic, documentLine, excerptOf, formatDay, topicRow, topicSourceUrls } from '../topics';
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
