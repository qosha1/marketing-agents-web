import { describe, it, expect } from 'vitest';

import {
  ingestionOverdue,
  ingestionSummary,
  intakeStage,
  isJudgedNotFiled,
  isUnjudged,
  queueTotal,
  topicPipeline,
  topicQueue,
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
function news(id: number, createdAt: string, data: Record<string, unknown> = {}): EntityRecord {
  return { id, entityType: 'news_item', externalId: null, name: `News ${id}`, data, createdAt };
}
function source(id: number, name: string, domain?: string): EntityRecord {
  return {
    id, entityType: 'source', externalId: null, name,
    data: domain ? { domain } : {}, createdAt: '2026-07-01',
  };
}

describe('topicPipeline', () => {
  it('counts records per status stage', () => {
    const records = [
      topic(1, { status: 'suggested' }),
      topic(2, { status: 'suggested' }),
      topic(3, { status: 'ready' }),
      topic(4, { status: 'written' }),
    ];
    expect(topicPipeline(topicType, records).stages).toEqual([
      { label: 'suggested', count: 2 },
      { label: 'ready', count: 1 },
      { label: 'rejected', count: 0 },
      { label: 'written', count: 1 },
    ]);
  });

  it('drops the Unset lane unless something lands there, and keeps it when it does', () => {
    const clean = topicPipeline(topicType, [topic(1, { status: 'ready' })]);
    expect(clean.stages.map((s) => s.label)).not.toContain('Unset');

    const dirty = topicPipeline(topicType, [topic(1, { status: 'bogus' }), topic(2, {})]);
    expect(dirty.stages.find((s) => s.label === 'Unset')?.count).toBe(2);
  });

  it('returns empty when the type has no status enum', () => {
    expect(topicPipeline(null, [topic(1, { status: 'ready' })])).toEqual({ stages: [] });
  });

  it('does not expose an "attention" count — the queue owns that claim', () => {
    const result = topicPipeline(topicType, [topic(1, { status: 'suggested' })]) as Record<string, unknown>;
    expect(result.attention).toBeUndefined();
  });
});

describe('intakeStage', () => {
  it('is the FIRST declared choice of the status enum, not a hardcoded value', () => {
    expect(intakeStage(topicType)).toBe('suggested');
  });

  it('follows a fork that renamed or reordered its intake stage', () => {
    const renamed: EntityTypeDef = {
      ...topicType,
      attributes: [{ ...statusAttr, config: { choices: ['inbox', 'triaged', 'done'] } }],
    };
    expect(intakeStage(renamed)).toBe('inbox');
  });

  it('is null (not a guess) when the type declares no status enum', () => {
    expect(intakeStage(null)).toBeNull();
    expect(intakeStage({ id: 'x', key: 'topic', label: 'Topic', attributes: [] })).toBeNull();
  });
});

describe('queue predicates', () => {
  it('isJudgedNotFiled: a verdict was recorded but the status never left intake', () => {
    expect(isJudgedNotFiled(topic(1, { status: 'suggested', team_verdict: 'good' }), 'suggested')).toBe(true);
    // judged AND filed -> done, not queue work
    expect(isJudgedNotFiled(topic(2, { status: 'ready', team_verdict: 'good' }), 'suggested')).toBe(false);
    // in intake but nobody judged it -> a different predicate
    expect(isJudgedNotFiled(topic(3, { status: 'suggested' }), 'suggested')).toBe(false);
    // a blank verdict string is not a verdict
    expect(isJudgedNotFiled(topic(4, { status: 'suggested', team_verdict: '  ' }), 'suggested')).toBe(false);
  });

  it('isJudgedNotFiled reads the camelCased blob (the client camelCases team_verdict)', () => {
    expect(isJudgedNotFiled(topic(1, { status: 'suggested', teamVerdict: 'bad' }), 'suggested')).toBe(true);
  });

  it('isUnjudged: neither a verdict nor a teaching note', () => {
    expect(isUnjudged(topic(1, { status: 'suggested' }))).toBe(true);
    expect(isUnjudged(topic(2, { status: 'suggested', team_verdict: 'good' }))).toBe(false);
    expect(isUnjudged(topic(3, { status: 'suggested', team_notes: 'looks thin' }))).toBe(false);
  });
});

describe('topicQueue', () => {
  const live = [
    ...Array.from({ length: 11 }, (_, i) => topic(i, { status: 'suggested', team_verdict: 'good' })),
    ...Array.from({ length: 8 }, (_, i) => topic(100 + i, { status: 'suggested', team_verdict: 'bad' })),
    ...Array.from({ length: 4 }, (_, i) => topic(200 + i, { status: 'ready', team_verdict: 'good' })),
  ];

  it('states the judged-not-filed predicate with a true count and a filtered link', () => {
    const [row, ...rest] = topicQueue(topicType, live);
    expect(rest).toEqual([]);
    expect(row.id).toBe('judged-not-filed');
    expect(row.count).toBe(19);
    expect(row.label).toBe('Judged, not filed — 19 topics');
    expect(row.href).toBe('/t/topic?status=suggested');
    // the fact the old widget got wrong: these already carry a verdict
    expect(row.meta).toContain('good 11');
    expect(row.meta).toContain('bad 8');
    expect(row.meta).toContain('suggested');
  });

  it('never claims topics are "awaiting a verdict" when every one of them has one', () => {
    for (const row of topicQueue(topicType, live)) {
      expect(row.label.toLowerCase()).not.toContain('awaiting verdict');
    }
  });

  it('groups the verdict breakdown by OBSERVED value — team_verdict is text, not an enum', () => {
    const [row] = topicQueue(topicType, [
      topic(1, { status: 'suggested', team_verdict: 'needs-angle' }),
      topic(2, { status: 'suggested', team_verdict: 'needs-angle' }),
      topic(3, { status: 'suggested', team_verdict: 'ship-it' }),
    ]);
    expect(row.meta).toContain('needs-angle 2');
    expect(row.meta).toContain('ship-it 1');
  });

  it('surfaces genuinely unjudged topics as their own predicate', () => {
    const rows = topicQueue(topicType, [
      topic(1, { status: 'suggested' }),
      topic(2, { status: 'suggested', team_verdict: 'good' }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(['judged-not-filed', 'unjudged']);
    expect(rows[1].label).toBe('Not yet judged — 1 topic');
    expect(rows.map((r) => r.count)).toEqual([1, 1]);
  });

  it('carries the RECORD count per row, so a card badge never reports the row count', () => {
    // The feed block's default badge is `${items.length} to review` — with one
    // aggregate row that reads "1 to review" beside a row saying "19 topics".
    // queueTotal is the number a badge may actually stand behind.
    expect(queueTotal(topicQueue(topicType, live))).toBe(19);
    expect(queueTotal([])).toBe(0);
  });

  it('drops zero rows entirely — a queue never lists "0 topics awaiting X"', () => {
    expect(topicQueue(topicType, [topic(1, { status: 'ready', team_verdict: 'good' })])).toEqual([]);
  });

  it('follows a renamed intake stage with no code change', () => {
    const renamed: EntityTypeDef = {
      ...topicType,
      attributes: [{ ...statusAttr, config: { choices: ['inbox', 'done'] } }],
    };
    const [row] = topicQueue(renamed, [topic(1, { status: 'inbox', team_verdict: 'good' })]);
    expect(row.label).toBe('Judged, not filed — 1 topic');
    expect(row.href).toBe('/t/topic?status=inbox');
  });

  it('omits the stranded row (rather than reporting 0) when no status enum is declared', () => {
    const rows = topicQueue(null, [topic(1, { status: 'suggested', team_verdict: 'good' })]);
    expect(rows.map((r) => r.id)).toEqual([]);
  });
});

describe('ingestionSummary', () => {
  // Two deliveries 12h apart, ~3 records each — the real shape: bursts, not a trickle.
  const burst = (headIso: string, n: number, id0: number) =>
    Array.from({ length: n }, (_, i) =>
      news(id0 + i, new Date(new Date(headIso).getTime() - i * 1000).toISOString(), { domain: 'zawya.com' }),
    );
  const threeDeliveries = [
    ...burst('2026-08-20T00:15:00.000Z', 3, 0),
    ...burst('2026-08-19T12:15:00.000Z', 3, 10),
    ...burst('2026-08-19T00:15:00.000Z', 3, 20),
  ];

  it('reports the all-time total from the API envelope, never the sample length', () => {
    const s = ingestionSummary([], threeDeliveries, 3648);
    expect(s.totalArticles).toBe(3648);
    expect(s.sampleSize).toBe(9);
  });

  it('leaves the total unknown (null) rather than substituting the sample length', () => {
    expect(ingestionSummary([], threeDeliveries, null).totalArticles).toBeNull();
  });

  it('takes last delivery from the newest article in the sample', () => {
    expect(ingestionSummary([], threeDeliveries, 3648).lastDeliveryAt).toBe('2026-08-20T00:15:00.000Z');
  });

  it('observes cadence from the gaps BETWEEN delivery bursts, not between articles', () => {
    const s = ingestionSummary([], threeDeliveries, 3648);
    expect(s.deliveriesObserved).toBe(3);
    expect(s.cadenceHours).toBe(12);
  });

  it('refuses to state a cadence from a single observed gap', () => {
    const s = ingestionSummary([], threeDeliveries.slice(0, 6), 3648);
    expect(s.deliveriesObserved).toBe(2);
    expect(s.cadenceHours).toBeNull();
  });

  it('refuses to state a cadence when the observed gaps are irregular', () => {
    const irregular = [
      ...burst('2026-08-20T00:00:00.000Z', 2, 0),
      ...burst('2026-08-19T12:00:00.000Z', 2, 10), // 12h
      ...burst('2026-08-19T11:00:00.000Z', 2, 20), // 1h
      ...burst('2026-08-18T00:00:00.000Z', 2, 30), // 35h
    ];
    expect(ingestionSummary([], irregular, 3648).cadenceHours).toBeNull();
  });

  it('reports source coverage as a SAMPLE fact — the window, never an all-time claim', () => {
    const sources = [
      source(1, 'Zawya', 'zawya.com'),
      source(2, 'Gulf News', 'gulfnews.com'),
      source(3, 'ADGM', 'adgm.com'),
    ];
    const s = ingestionSummary(sources, threeDeliveries, 3648);
    expect(s.sourcesDeclared).toBe(3);
    expect(s.sourcesInSample).toBe(1);
    expect(s.sampleSize).toBe(9);
  });

  it('counts a declared source once per domain and ignores domainless records', () => {
    const sources = [
      source(1, 'Zawya', 'zawya.com'),
      source(2, 'Zawya dup', 'ZAWYA.com'),
      source(3, 'No domain'),
    ];
    const s = ingestionSummary(sources, threeDeliveries, 3648);
    expect(s.sourcesDeclared).toBe(1);
    expect(s.sourcesInSample).toBe(1);
  });

  it('never invents a source row for a domain the tenant has not declared', () => {
    const s = ingestionSummary([source(1, 'ADGM', 'adgm.com')], threeDeliveries, 3648);
    expect(s.sourcesDeclared).toBe(1);
    expect(s.sourcesInSample).toBe(0);
  });

  it('reads the camelCased news blob for the domain join', () => {
    const items = [news(1, '2026-08-20T00:15:00.000Z', { domain: 'zawya.com' })];
    expect(ingestionSummary([source(1, 'Zawya', 'zawya.com')], items, 1).sourcesInSample).toBe(1);
  });

  it('is honestly empty when no articles have arrived', () => {
    const s = ingestionSummary([source(1, 'Zawya', 'zawya.com')], [], 0);
    expect(s.lastDeliveryAt).toBeNull();
    expect(s.cadenceHours).toBeNull();
    expect(s.deliveriesObserved).toBe(0);
    expect(s.sampleSize).toBe(0);
    expect(s.sourcesInSample).toBe(0);
  });

  it('ignores articles with an unparseable created_at instead of dating them to the epoch', () => {
    const s = ingestionSummary([], [news(1, 'not-a-date'), ...threeDeliveries], 3648);
    expect(s.lastDeliveryAt).toBe('2026-08-20T00:15:00.000Z');
    expect(s.deliveriesObserved).toBe(3);
  });
});

describe('ingestionOverdue', () => {
  const at = (iso: string) => new Date(iso).getTime();
  const base = {
    totalArticles: 3648, lastDeliveryAt: '2026-08-20T00:15:00.000Z',
    deliveriesObserved: 5, sampleSize: 200, sourcesDeclared: 55, sourcesInSample: 10,
  };

  it('is false while the wait is inside twice the observed cadence', () => {
    expect(ingestionOverdue({ ...base, cadenceHours: 12 }, at('2026-08-20T20:00:00.000Z'))).toBe(false);
  });

  it('is true once the wait passes twice the observed cadence', () => {
    expect(ingestionOverdue({ ...base, cadenceHours: 12 }, at('2026-08-21T02:00:00.000Z'))).toBe(true);
  });

  it('is false when no cadence was observed — there is no schedule to be late against', () => {
    expect(ingestionOverdue({ ...base, cadenceHours: null }, at('2026-09-01T00:00:00.000Z'))).toBe(false);
  });

  it('is false when nothing has ever been delivered', () => {
    expect(
      ingestionOverdue({ ...base, lastDeliveryAt: null, cadenceHours: 12 }, at('2026-09-01T00:00:00.000Z')),
    ).toBe(false);
  });
});

describe('removed widgets stay removed', () => {
  it('no longer exports a hardcoded needs-verdict status', async () => {
    const mod = await import('../health-data');
    expect('NEEDS_VERDICT_STATUS' in mod).toBe(false);
  });

  it('no longer exports the delivery or per-source freshness mappers', async () => {
    const mod = await import('../health-data');
    expect('deliveryFromTopics' in mod).toBe(false);
    expect('sourceFreshness' in mod).toBe(false);
    expect('attentionFromTopics' in mod).toBe(false);
  });
});
