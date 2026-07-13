import { describe, it, expect } from 'vitest';

import {
  attentionFromTopics,
  deliveryFromTopics,
  sourceFreshnessFromNews,
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

describe('sourceFreshnessFromNews', () => {
  it('groups by source_name and takes the max last_seen, stalest first', () => {
    const items = [
      news(1, { source_name: 'AGBI', last_seen: '2026-07-10' }),
      news(2, { source_name: 'AGBI', last_seen: '2026-07-12' }),
      news(3, { source_name: 'Saudi Gazette', last_seen: '2026-07-01' }),
    ];
    const sources = sourceFreshnessFromNews(items);
    expect(sources).toEqual([
      { name: 'Saudi Gazette', lastUpdated: '2026-07-01' },
      { name: 'AGBI', lastUpdated: '2026-07-12' },
    ]);
  });

  it('reads the camelCased blob (client camelCases source_name/last_seen)', () => {
    const sources = sourceFreshnessFromNews([news(1, { sourceName: 'Zawya', lastSeen: '2026-07-11' })]);
    expect(sources).toEqual([{ name: 'Zawya', lastUpdated: '2026-07-11' }]);
  });

  it('skips items with no source or no timestamp', () => {
    const items = [
      news(1, { source_name: '', last_seen: '2026-07-10' }),
      news(2, { source_name: 'AGBI' }),
    ];
    expect(sourceFreshnessFromNews(items)).toEqual([]);
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
