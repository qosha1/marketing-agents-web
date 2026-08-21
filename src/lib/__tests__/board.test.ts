import { describe, it, expect } from 'vitest';
import {
  pickStatusAttr,
  choicesOf,
  boardColumns,
  groupByStatus,
  readData,
  pickAttrFilter,
  applyAttrFilter,
  pickAttrFilters,
  applyAttrFilters,
  pickTextAttrFilter,
  applyTextAttrFilter,
  BLANK,
  relatedByEdge,
  rollupByParent,
  UNSET_COLUMN,
} from '../board';
import type { AttributeDef, EntityRecord, EntityTypeDef } from '@/lib/foundry-api';

const statusAttr: AttributeDef = {
  id: '1', name: 'status', dataType: 'enum', required: false,
  config: { choices: ['suggested', 'ready', 'rejected', 'written'] },
};
const marketAttr: AttributeDef = {
  id: '2', name: 'market', dataType: 'text', required: false, config: {},
};
const priorityAttr: AttributeDef = {
  id: '3', name: 'priority', dataType: 'enum', required: false,
  config: { choices: ['low', 'high'] },
};
const type: EntityTypeDef = {
  id: 't', key: 'topic', label: 'Topic', attributes: [marketAttr, statusAttr],
};

function rec(id: number, status?: string): EntityRecord {
  return {
    id, entityType: 'topic', externalId: null, name: 'r' + id,
    data: status === undefined ? {} : { status }, createdAt: '2026-07-01',
  };
}

describe('pickStatusAttr', () => {
  it('prefers an enum attribute named "status"', () => {
    expect(pickStatusAttr(type)?.name).toBe('status');
  });
  it('falls back to the first enum when there is no "status"', () => {
    const t = { ...type, attributes: [{ ...statusAttr, name: 'stage' }] };
    expect(pickStatusAttr(t)?.name).toBe('stage');
  });
  it('returns null when the type has no enum attribute', () => {
    expect(pickStatusAttr({ ...type, attributes: [marketAttr] })).toBeNull();
    expect(pickStatusAttr(undefined)).toBeNull();
  });
});

describe('choicesOf', () => {
  it('reads config.choices, coercing to strings', () => {
    expect(choicesOf(statusAttr)).toEqual(['suggested', 'ready', 'rejected', 'written']);
  });
  it('returns [] when no choices', () => {
    expect(choicesOf(marketAttr)).toEqual([]);
    expect(choicesOf(null)).toEqual([]);
  });
});

describe('boardColumns', () => {
  it('builds one column per choice plus a trailing Unset lane', () => {
    expect(boardColumns(statusAttr).map((c) => c.id)).toEqual([
      'suggested', 'ready', 'rejected', 'written', UNSET_COLUMN.id,
    ]);
  });
  it('is just the Unset lane when there is no status attr', () => {
    expect(boardColumns(null).map((c) => c.id)).toEqual([UNSET_COLUMN.id]);
  });
});

describe('groupByStatus', () => {
  const cols = boardColumns(statusAttr);
  it('groups records into their status lane and keeps empty lanes present', () => {
    const g = groupByStatus([rec(1, 'ready'), rec(2, 'ready'), rec(3, 'suggested')], 'status', cols);
    expect(g['ready'].map((r) => r.id)).toEqual([1, 2]);
    expect(g['suggested'].map((r) => r.id)).toEqual([3]);
    expect(g['rejected']).toEqual([]); // empty lane still rendered
  });
  it('routes unknown or empty status into the Unset lane', () => {
    const g = groupByStatus([rec(1), rec(2, 'bogus'), rec(3, '')], 'status', cols);
    expect(g[UNSET_COLUMN.id].map((r) => r.id)).toEqual([1, 2, 3]);
  });
});

describe('readData', () => {
  it('reads a camelCased multi-word key from the data blob', () => {
    expect(readData({ teamVerdict: 'good' }, 'team_verdict')).toBe('good');
  });
  it('falls back to the raw snake_case key', () => {
    expect(readData({ team_verdict: 'bad' }, 'team_verdict')).toBe('bad');
  });
  it('is undefined for missing keys / missing data', () => {
    expect(readData({}, 'status')).toBeUndefined();
    expect(readData(undefined, 'status')).toBeUndefined();
  });
});

describe('pickAttrFilter / applyAttrFilter', () => {
  const filterable: EntityTypeDef = {
    id: 'f', key: 'topic', label: 'Topic', attributes: [statusAttr, priorityAttr, marketAttr],
  };
  it('matches the first declared enum attr present with a valid choice value', () => {
    expect(pickAttrFilter(filterable, { priority: 'high' })).toEqual({ name: 'priority', value: 'high' });
    expect(pickAttrFilter(filterable, { status: 'ready' })).toEqual({ name: 'status', value: 'ready' });
  });
  it('ignores params that are not declared enum attrs or not valid choices', () => {
    expect(pickAttrFilter(filterable, { market: 'US' })).toBeNull();
    expect(pickAttrFilter(filterable, { status: 'bogus' })).toBeNull();
    expect(pickAttrFilter(filterable, {})).toBeNull();
    expect(pickAttrFilter(undefined, { status: 'ready' })).toBeNull();
  });
  it('applyAttrFilter keeps only matching records; null filter is the identity', () => {
    const recs = [rec(1, 'ready'), rec(2, 'suggested'), rec(3, 'ready')];
    const kept = applyAttrFilter(recs, { name: 'status', value: 'ready' });
    expect(kept.map((r) => r.id)).toEqual([1, 3]);
    expect(applyAttrFilter(recs, null)).toBe(recs);
  });
});

describe('pickAttrFilters / applyAttrFilters (multi-facet, startsim-uhmk)', () => {
  const filterable: EntityTypeDef = {
    id: 'f', key: 'topic', label: 'Topic', attributes: [statusAttr, priorityAttr, marketAttr],
  };
  it('collects every declared enum attr present with a valid choice value', () => {
    expect(pickAttrFilters(filterable, { status: 'ready', priority: 'high' })).toEqual([
      { name: 'status', value: 'ready' },
      { name: 'priority', value: 'high' },
    ]);
  });
  it('skips params that are not declared enum attrs or not valid choices', () => {
    expect(pickAttrFilters(filterable, { market: 'US', status: 'bogus' })).toEqual([]);
    expect(pickAttrFilters(filterable, {})).toEqual([]);
    expect(pickAttrFilters(undefined, { status: 'ready' })).toEqual([]);
  });
  it('applyAttrFilters ANDs every filter together; [] is the identity', () => {
    function recWith(id: number, status?: string, priority?: string): EntityRecord {
      return {
        id, entityType: 'topic', externalId: null, name: 'r' + id,
        data: { ...(status ? { status } : {}), ...(priority ? { priority } : {}) },
        createdAt: '2026-07-01',
      };
    }
    const recs = [recWith(1, 'ready', 'high'), recWith(2, 'ready', 'low'), recWith(3, 'suggested', 'high')];
    const kept = applyAttrFilters(recs, [
      { name: 'status', value: 'ready' },
      { name: 'priority', value: 'high' },
    ]);
    expect(kept.map((r) => r.id)).toEqual([1]);
    expect(applyAttrFilters(recs, [])).toBe(recs);
  });
});

describe('pickTextAttrFilter / applyTextAttrFilter (free-text, startsim-a2oq)', () => {
  const assigneeAttr: AttributeDef = {
    id: '5', name: 'assignee_sub', dataType: 'text', required: false, config: {},
  };
  const withAssignee: EntityTypeDef = {
    id: 'g', key: 'topic', label: 'Topic', attributes: [statusAttr, assigneeAttr],
  };

  function recAssigned(id: number, sub?: string): EntityRecord {
    return {
      id, entityType: 'topic', externalId: null, name: 'r' + id,
      data: sub === undefined ? {} : { assigneeSub: sub }, createdAt: '2026-07-01',
    };
  }

  it('matches a declared non-enum text attribute by name', () => {
    expect(pickTextAttrFilter(withAssignee, 'assignee_sub', { assignee_sub: 'user-1' }))
      .toEqual({ name: 'assignee_sub', value: 'user-1' });
  });
  it('is null when the attr is not declared, is an enum, or the param is absent', () => {
    expect(pickTextAttrFilter(withAssignee, 'assignee_sub', {})).toBeNull();
    expect(pickTextAttrFilter(withAssignee, 'status', { status: 'ready' })).toBeNull();
    expect(pickTextAttrFilter(withAssignee, 'missing_attr', { missing_attr: 'x' })).toBeNull();
    expect(pickTextAttrFilter(undefined, 'assignee_sub', { assignee_sub: 'x' })).toBeNull();
  });
  it('applyTextAttrFilter keeps only exact matches (camelCase-aware); null is the identity', () => {
    const recs = [recAssigned(1, 'user-1'), recAssigned(2, 'user-2'), recAssigned(3, 'user-1')];
    const kept = applyTextAttrFilter(recs, { name: 'assignee_sub', value: 'user-1' });
    expect(kept.map((r) => r.id)).toEqual([1, 3]);
    expect(applyTextAttrFilter(recs, null)).toBe(recs);
  });
  it('the BLANK sentinel matches missing or empty values — the "unassigned" quick filter', () => {
    const recs = [recAssigned(1, 'user-1'), recAssigned(2), recAssigned(3, '')];
    const kept = applyTextAttrFilter(recs, { name: 'assignee_sub', value: BLANK });
    expect(kept.map((r) => r.id)).toEqual([2, 3]);
  });
});

describe('relatedByEdge (startsim-ka3j)', () => {
  function draft(id: number): EntityRecord {
    return { id, entityType: 'draft', externalId: null, name: 'd' + id, data: {}, createdAt: '2026-07-01' };
  }
  const edges = [
    { id: 1, relType: 'written_for', source: 10, target: 100 },
    { id: 2, relType: 'written_for', source: 11, target: 100 },
    { id: 3, relType: 'written_for', source: 12, target: 200 },
    { id: 4, relType: 'translation_of', source: 21, target: 20 },
  ];
  const records = [draft(10), draft(11), draft(12), draft(20), draft(21)];

  it('incoming (default): records whose edge TARGETS `id` — via their SOURCE', () => {
    expect(relatedByEdge(100, 'written_for', edges, records).map((r) => r.id)).toEqual([10, 11]);
  });
  it('outgoing: records whose edge SOURCES from `id` — via their TARGET', () => {
    expect(relatedByEdge(21, 'translation_of', edges, records, 'outgoing').map((r) => r.id)).toEqual([20]);
  });
  it('ignores a different relType and returns [] when nothing matches', () => {
    expect(relatedByEdge(100, 'translation_of', edges, records)).toEqual([]);
    expect(relatedByEdge(999, 'written_for', edges, records)).toEqual([]);
  });
});

describe('rollupByParent (startsim-4w76 / startsim-n7s8)', () => {
  function child(id: number, status?: string): EntityRecord {
    return {
      id, entityType: 'draft', externalId: null, name: 'c' + id,
      data: status === undefined ? {} : { status }, createdAt: '2026-07-01',
    };
  }
  it('buckets children by their parent id and status value', () => {
    // Draft statuses are the team's own (bd startsim-wn2p.2) so the fixture reads
    // like the live board; the rollup itself is generic and never names them.
    const children = [
      child(1, 'approved'),
      child(2, 'ready_for_review'),
      child(3, 'approved'),
      child(4, 'approved'),
    ];
    const parentOf = (c: EntityRecord): EntityRecord['id'] | null =>
      c.id === 4 ? null : c.id <= 2 ? 100 : 200;
    const rollup = rollupByParent(children, parentOf, 'status');
    expect(rollup.get(100)).toEqual({ total: 2, byStatus: { approved: 1, ready_for_review: 1 } });
    expect(rollup.get(200)).toEqual({ total: 1, byStatus: { approved: 1 } });
    expect(rollup.has(4)).toBe(false);
  });
  it('is an empty map for an empty child list', () => {
    expect(rollupByParent([], () => 1, 'status')).toEqual(new Map());
  });
  it('groups an unset/blank status value under an empty-string bucket', () => {
    const children = [child(1), child(2, '')];
    const rollup = rollupByParent(children, () => 100, 'status');
    expect(rollup.get(100)).toEqual({ total: 2, byStatus: { '': 2 } });
  });
});
