/**
 * RED for the Content calendar (bd startsim-fggqp): scheduled items on their
 * day, month navigation, click opens the item, and the set the reminder job
 * picks ("due tomorrow").
 */
import { describe, expect, it } from 'vitest';

import {
  calendarFilters,
  monthGrid,
  monthLabel,
  shiftMonth,
  dueTomorrow,
  placeItems,
} from '@/lib/content-calendar';
import type { EntityRecord } from '@/lib/foundry-api';

const item = (id: number, over: Record<string, unknown>): EntityRecord =>
  ({ id, name: `Item ${id}`, entityType: 'draft', data: { status: 'scheduled', ...over } }) as unknown as EntityRecord;

describe('the month grid', () => {
  it('is Monday-first weeks that cover the whole month', () => {
    const g = monthGrid(2026, 9); // October 2026 starts on a Thursday
    expect(g[0][0]).toMatchObject({ day: 28, inMonth: false });
    expect(g[0][3]).toMatchObject({ day: 1, inMonth: true });
    expect(g.at(-1)!.at(-1)).toMatchObject({ day: 1, inMonth: false });
    expect(g.every((w) => w.length === 7)).toBe(true);
    expect(g.flat().filter((c) => c.inMonth)).toHaveLength(31);
  });

  it('labels the month the way the wireframe does', () => {
    expect(monthLabel(2026, 9)).toBe('October 2026');
  });

  it('steps across a year boundary', () => {
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
  });
});

describe('the server query for a month', () => {
  it('asks for scheduled items in a window a day wider than the month, in UTC', () => {
    const f = calendarFilters(2026, 9, null);
    expect(f['attr.scheduled_for__gte']).toBe('2026-09-30T00:00:00.000Z');
    expect(f['attr.scheduled_for__lt']).toBe('2026-11-02T00:00:00.000Z');
    expect(f['attr.status__in']).toBe('scheduled');
  });

  it('leaves project scoping to listEntities (it never sets scope itself)', () => {
    expect(calendarFilters(2026, 9, null)).not.toHaveProperty('scope');
    expect(calendarFilters(2026, 9, '/ogmc')).not.toHaveProperty('scope');
  });
});

describe('placing items on days', () => {
  it('puts each item on its own day in the viewer time zone', () => {
    const placed = placeItems(
      [item(1, { scheduledFor: '2026-10-23T13:00:00.000Z' }), item(2, { scheduledFor: '2026-10-27T01:00:00.000Z' })],
      'UTC',
    );
    expect(placed.get('2026-10-23')!.map((i) => i.id)).toEqual([1]);
    expect(placed.get('2026-10-27')!.map((i) => i.id)).toEqual([2]);
  });

  it('shifts an evening UTC time onto the next local day', () => {
    const placed = placeItems([item(1, { scheduledFor: '2026-10-23T23:30:00.000Z' })], 'Asia/Dubai');
    expect(placed.get('2026-10-24')!.map((i) => i.id)).toEqual([1]);
  });

  it('skips an item with no usable date', () => {
    expect(placeItems([item(1, {}), item(2, { scheduledFor: 'nope' })], 'UTC').size).toBe(0);
  });
});

describe('the reminder selection', () => {
  const now = new Date('2026-10-22T08:00:00Z');

  it('picks scheduled items that fall tomorrow', () => {
    const due = dueTomorrow(
      [
        item(1, { scheduledFor: '2026-10-23T09:00:00.000Z' }),
        item(2, { scheduledFor: '2026-10-22T09:00:00.000Z' }),
        item(3, { scheduledFor: '2026-10-24T09:00:00.000Z' }),
        item(4, { status: 'published', scheduledFor: '2026-10-23T09:00:00.000Z' }),
      ],
      now,
      'UTC',
    );
    expect(due.map((i) => i.id)).toEqual([1]);
  });
});
