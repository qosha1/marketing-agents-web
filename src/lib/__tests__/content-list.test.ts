/**
 * RED for the v2 Content list (bd startsim-3zfd7): Title, Market, Assigned,
 * Status, Scheduled. Rejected never shown. No Updated column, no sub-labels.
 */
import { describe, expect, it } from 'vitest';

import {
  CONTENT_COLUMNS,
  contentListFilters,
  contentRow,
  formatWhen,
  serverOrder,
  sortRowsLocally,
  isLocalSort,
  type ContentRow,
} from '@/lib/content-list';
import type { EntityRecord } from '@/lib/foundry-api';

const DECLARED = ['ready_for_review', 'approved', 'rejected', 'published', 'scheduled', 'for_repurpose'];

function draft(over: Partial<EntityRecord> & { data?: Record<string, unknown> } = {}): EntityRecord {
  return {
    id: 7, entityType: 'draft', externalId: null, name: 'Gulf FDI weekly', createdAt: '2026-10-01T00:00:00Z',
    ...over,
    data: { status: 'ready_for_review', topicRef: 't1', assigneeName: 'Malin', ...(over.data ?? {}) },
  } as EntityRecord;
}

describe('columns', () => {
  it('are Title, Market, Assigned, Status, Scheduled, in that order', () => {
    expect(CONTENT_COLUMNS.map((c) => c.label)).toEqual(['Title', 'Market', 'Assigned', 'Status', 'Scheduled']);
  });

  it('has no Updated column', () => {
    expect(CONTENT_COLUMNS.map((c) => c.label.toLowerCase())).not.toContain('updated');
  });
});

describe('the server query', () => {
  const base = { search: '', status: null, sortBy: null, sortDirection: 'asc' as const, page: 1, declaredStatuses: DECLARED };

  it('lists only visible statuses, so rejected and shelved rows never come back', () => {
    const f = contentListFilters(base);
    const values = f['attr.status__in'].split(',');
    expect(values).toContain('approved');
    expect(values).not.toContain('rejected');
    expect(values).not.toContain('for_repurpose');
  });

  it('is paginated by the server', () => {
    expect(contentListFilters({ ...base, page: 3 })).toMatchObject({ page_size: '25' });
  });

  it('searches with the backend full-text search, and sends nothing for a blank box', () => {
    expect(contentListFilters({ ...base, search: ' qatar ' }).search).toBe('qatar');
    expect(contentListFilters(base)).not.toHaveProperty('search');
  });

  it('narrows to one status by its stored values', () => {
    expect(contentListFilters({ ...base, status: 'posted' })['attr.status__in']).toBe('published');
  });

  it('sorts on the server for Status, Assigned and Scheduled', () => {
    expect(serverOrder('status', 'asc')).toBe('attr.status');
    expect(serverOrder('assigned', 'desc')).toBe('-attr.assignee_name');
    expect(serverOrder('scheduled', 'asc')).toBe('attr.scheduled_for');
  });

  it('does not pretend to sort Title or Market on the server', () => {
    expect(serverOrder('title', 'asc')).toBeNull();
    expect(serverOrder('market', 'asc')).toBeNull();
  });

  it('adds no project parameter when no project is active', () => {
    expect(contentListFilters({ ...base, projectId: null })).not.toHaveProperty('scope');
  });

  it('leaves project scoping to listEntities even when a project is active', () => {
    expect(contentListFilters({ ...base, projectId: '/ogmc/gulf' })).not.toHaveProperty('scope');
  });
});

describe('a row', () => {
  it('carries the five cells and nothing else under the title', () => {
    const row = contentRow(draft(), { t1: { market: 'GCC' } }, 'UTC');
    expect(Object.keys(row).sort()).toEqual(['assigned', 'id', 'market', 'scheduled', 'status', 'statusLabel', 'title']);
    expect(row).toMatchObject({ title: 'Gulf FDI weekly', market: 'GCC', assigned: 'Malin', status: 'draft', statusLabel: 'Draft', scheduled: '' });
  });

  it('shows a dash for a draft with no topic, market or assignee', () => {
    const row = contentRow(draft({ data: { topicRef: '', assigneeName: '' } }), {}, 'UTC');
    expect(row.market).toBe('—');
    expect(row.assigned).toBe('—');
  });

  it('shows the scheduled day for a Scheduled item', () => {
    const row = contentRow(draft({ data: { status: 'scheduled', scheduledFor: '2026-10-23T13:00:00.000Z' } }), {}, 'UTC');
    expect(row.statusLabel).toBe('Scheduled');
    expect(row.scheduled).toBe('Fri 10/23');
  });

  it('shows the day it went out for a Posted item', () => {
    const row = contentRow(draft({ data: { status: 'published', sentAt: '2026-10-20' } }), {}, 'UTC');
    expect(row.statusLabel).toBe('Posted');
    expect(row.scheduled).toBe('Tue 10/20');
  });

  it('formats a day the way the wireframe does', () => {
    expect(formatWhen('2026-10-27T09:00:00Z', 'UTC')).toBe('Tue 10/27');
    expect(formatWhen('', 'UTC')).toBe('');
    expect(formatWhen('not a date', 'UTC')).toBe('');
  });
});

describe('Title and Market sorting (bd startsim-bj3zz.13)', () => {
  const row = (title: string, market: string): ContentRow =>
    ({ id: title, title, market, assigned: '', status: 'draft', statusLabel: 'Draft', scheduled: '' });
  const rows = [row('beta', 'GCC'), row('Alpha', '—'), row('gamma', 'EU')];

  it('has no server order for Title or Market (nothing declared to order by), so they sort whole-result', () => {
    expect(serverOrder('title', 'asc')).toBeNull();
    expect(serverOrder('market', 'asc')).toBeNull();
    expect(isLocalSort('title')).toBe(true);
    expect(isLocalSort('market')).toBe(true);
    expect(isLocalSort('status')).toBe(false);
  });

  it('sorts titles case-insensitively in both directions', () => {
    expect(sortRowsLocally(rows, 'title', 'asc').map((r) => r.title)).toEqual(['Alpha', 'beta', 'gamma']);
    expect(sortRowsLocally(rows, 'title', 'desc').map((r) => r.title)).toEqual(['gamma', 'beta', 'Alpha']);
  });

  it('keeps blank markets last in both directions', () => {
    expect(sortRowsLocally(rows, 'market', 'asc').map((r) => r.market)).toEqual(['EU', 'GCC', '—']);
    expect(sortRowsLocally(rows, 'market', 'desc').map((r) => r.market)).toEqual(['GCC', 'EU', '—']);
  });
});
