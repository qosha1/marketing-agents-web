import { describe, it, expect } from 'vitest';

import {
  attentionFromTopics,
  deliveryFromTopics,
  sourceFreshness,
  topicPipeline,
} from '../health-data';
import type { AttributeDef, EntityRecord, EntityTypeDef } from '@/lib/foundry-api';

const statusAttr: AttributeDef = {
  id: '1', name: 'status', dataType: 'enum', required: false,
  config: { choices: ['suggested', 'ready', 'rejected', 'written'] },
};
const topicType: EntityTypeDef = {
  id: 't', key: 'topic', label: 'Topic', attributes: [statusAttr],
};

function topic(id: number, data: Record<string, unknown>, createdAt = '2026-07-01'): EntityRecord {
  return { id, entityType: 'topic', externalId: null, name: `Topic ${id}`, data, createdAt };
}
function news(id: number, data: Record<string, unknown>): EntityRecord {
  return { id, entityType: 'news_item', externalId: null, name: `News ${id}`, data, createdAt: '2026-07-01' };
}
function source(id: number, name: string, domain?: string): EntityRecord {
  return {
    id, entityType: 'source', externalId: null, name,
    data: domain ? { domain } : {}, createdAt: '2026-07-01',
  };
}

describe('topicPipeline', () => {
  it('counts records per status stage and flags suggested as attention', () => {
    const records = [
      topic(1, { status: 'suggested' }),
      topic(2, { status: 'suggested' }),
      topic(3, { status: 'ready' }),
      topic(4, { status: 'written' }),
    ];
    const { stages, attention } = topicPipeline(topicType, records);
    expect(stages).toEqual([
      { label: 'suggested', count: 2 },
      { label: 'ready', count: 1 },
      { label: 'rejected', count: 0 },
      { label: 'written', count: 1 },
    ]);
    expect(attention).toBe(2);
  });

  it('drops the Unset lane unless something lands there, and keeps it when it does', () => {
    const clean = topicPipeline(topicType, [topic(1, { status: 'ready' })]);
    expect(clean.stages.map((s) => s.label)).not.toContain('Unset');

    const dirty = topicPipeline(topicType, [topic(1, { status: 'bogus' }), topic(2, {})]);
    const unset = dirty.stages.find((s) => s.label === 'Unset');
    expect(unset?.count).toBe(2);
  });

  it('returns empty when the type has no status enum', () => {
    expect(topicPipeline(null, [topic(1, { status: 'ready' })])).toEqual({ stages: [], attention: 0 });
  });
});

describe('sourceFreshness', () => {
  it('joins on DOMAIN (not name), fresh sources first, never-produced marked idle/neutral last', () => {
    const sources = [
      source(1, 'Zawya', 'zawya.com'),
      source(2, 'Gulf News', 'gulfnews.com'),
      source(3, 'ADGM', 'adgm.com'), // active but produces no news → idle
    ];
    const items = [
      news(1, { domain: 'zawya.com', last_seen: '2026-07-10' }),
      news(2, { domain: 'zawya.com', last_seen: '2026-07-12' }),
      news(3, { domain: 'gulfnews.com', last_seen: '2026-07-13' }),
    ];
    expect(sourceFreshness(sources, items)).toEqual([
      { name: 'Gulf News', lastUpdated: '2026-07-13' },
      { name: 'Zawya', lastUpdated: '2026-07-12' },
      { name: 'ADGM', lastUpdated: null, status: 'neutral' },
    ]);
  });

  it('reads the camelCased news blob (client camelCases last_seen)', () => {
    const rows = sourceFreshness(
      [source(1, 'Zawya', 'zawya.com')],
      [news(1, { domain: 'zawya.com', lastSeen: '2026-07-11' })],
    );
    expect(rows).toEqual([{ name: 'Zawya', lastUpdated: '2026-07-11' }]);
  });

  it('falls back to source_name when a news item stored a human name, not a domain', () => {
    const rows = sourceFreshness(
      [source(1, 'The National', 'thenationalnews.com')],
      [news(1, { source_name: 'The National', last_seen: '2026-07-13' })],
    );
    expect(rows).toEqual([{ name: 'The National', lastUpdated: '2026-07-13' }]);
  });

  it('marks a source that has never produced as idle (neutral), not stale', () => {
    const rows = sourceFreshness(
      [source(1, 'ADGM', 'adgm.com')],
      [news(1, { domain: 'reuters.com', last_seen: '2026-07-10' })],
    );
    expect(rows).toEqual([{ name: 'ADGM', lastUpdated: null, status: 'neutral' }]);
  });

  it('is driven by the source list — undeclared news domains are not invented as rows', () => {
    const rows = sourceFreshness(
      [source(1, 'ADGM', 'adgm.com')],
      [news(1, { domain: 'undeclared.com', last_seen: '2026-07-10' })],
    );
    expect(rows).toEqual([{ name: 'ADGM', lastUpdated: null, status: 'neutral' }]);
  });

  it('dedupes sources by domain and skips keyless source records', () => {
    const rows = sourceFreshness(
      [source(1, 'ADGM', 'adgm.com'), source(2, 'ADGM dup', 'adgm.com'), source(3, '  ')],
      [news(1, { domain: 'adgm.com', last_seen: '2026-07-10' })],
    );
    expect(rows).toEqual([{ name: 'ADGM', lastUpdated: '2026-07-10' }]);
  });
});

describe('deliveryFromTopics', () => {
  it('includes only topics with a scheduled_for, mapping due/delivered', () => {
    const items = deliveryFromTopics([
      topic(1, { scheduled_for: '2026-07-20', delivered_at: '2026-07-19' }),
      topic(2, { scheduled_for: '2026-07-21' }),
      topic(3, {}),
    ]);
    expect(items).toEqual([
      { label: 'Topic 1', dueAt: '2026-07-20', deliveredAt: '2026-07-19' },
      { label: 'Topic 2', dueAt: '2026-07-21', deliveredAt: null },
    ]);
  });

  it('is empty when nothing is scheduled (honest neutral state)', () => {
    expect(deliveryFromTopics([topic(1, { status: 'ready' })])).toEqual([]);
  });
});

describe('attentionFromTopics', () => {
  it('surfaces suggested topics newest-first with a content-tab link', () => {
    const items = attentionFromTopics([
      topic(1, { status: 'suggested', content_type: 'weekly_brief' }, '2026-07-01'),
      topic(2, { status: 'ready' }, '2026-07-05'),
      topic(3, { status: 'suggested', content_type: 'lead_magnet' }, '2026-07-10'),
    ]);
    expect(items.map((i) => i.id)).toEqual(['3', '1']);
    expect(items[0]).toMatchObject({
      id: '3', label: 'Topic 3', meta: 'Topic · suggested', at: '2026-07-10',
    });
    expect(items[0].href).toContain('content_type=lead_magnet');
  });

  it('omits the href for an unknown content_type', () => {
    const [item] = attentionFromTopics([topic(1, { status: 'suggested', content_type: 'mystery' })]);
    expect(item.href).toBeUndefined();
  });

  it('caps the queue', () => {
    const many = Array.from({ length: 12 }, (_, i) => topic(i, { status: 'suggested' }));
    expect(attentionFromTopics(many, 8)).toHaveLength(8);
  });
});
