import { describe, it, expect } from 'vitest';
import {
  pickStatusAttr,
  choicesOf,
  boardColumns,
  groupByStatus,
  readData,
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
