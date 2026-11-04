import { beforeEach, describe, expect, it, vi } from 'vitest';

const scope = vi.hoisted(() => ({ id: null as string | null }));
vi.mock('@/lib/project-scope', () => ({ getActiveProjectId: () => scope.id }));

import { documentFilters, projectFilters, sourceFilters, topicFilters, UNREVIEWED_STATUSES } from '../filters';

const NOW = new Date('2026-11-04T12:00:00');

beforeEach(() => {
  scope.id = null;
});

describe('research list filters (all server-side)', () => {
  it('adds no project filter until a project is active, then scopes every list', () => {
    expect(projectFilters()).toEqual({});
    scope.id = 'p-1';
    const f = projectFilters();
    expect(Object.values(f)).toEqual(['p-1']);
    expect(documentFilters({}, NOW)).toMatchObject(f);
    expect(topicFilters({})).toMatchObject(f);
    expect(sourceFilters({})).toMatchObject(f);
  });

  it('documents: search, source, review and date range become tenant filters', () => {
    const f = documentFilters(
      { search: ' customs ', source: 'Example Wire', review: 'good', range: '7' },
      NOW,
    );
    expect(f['attr.title__icontains']).toBe('customs');
    expect(f['attr.source_name']).toBe('Example Wire');
    expect(f['attr.status']).toBe('acceptable');
    expect(f['attr.published_at__gte']).toBe('2026-10-28');
  });

  it('documents: Not good is rejected, Not reviewed is every other status', () => {
    expect(documentFilters({ review: 'not_good' }, NOW)['attr.status']).toBe('rejected');
    const f = documentFilters({ review: 'unreviewed' }, NOW);
    expect(f['attr.status__in']).toBe(UNREVIEWED_STATUSES.join(','));
    expect(UNREVIEWED_STATUSES).not.toContain('acceptable');
    expect(UNREVIEWED_STATUSES).not.toContain('rejected');
  });

  it('documents: blank controls send nothing; sort becomes an order param, newest first by default', () => {
    const f = documentFilters({ search: '  ', source: '', review: 'all', range: 'all' }, NOW);
    expect(Object.keys(f)).toEqual(['order']);
    expect(f.order).toBe('-attr.published_at');
    expect(documentFilters({ sort: { by: 'title', dir: 'asc' } }, NOW).order).toBe('attr.title');
    expect(documentFilters({ sort: { by: 'review', dir: 'desc' } }, NOW).order).toBe('-attr.status');
  });

  it('topics: rejected topics are left out, search is on the title', () => {
    const f = topicFilters({ search: 'visa' });
    expect(f['attr.status__in']).toBe('suggested,ready,written');
    expect(f['attr.title__icontains']).toBe('visa');
  });

  it('sources: search by name', () => {
    expect(sourceFilters({ search: 'wire' })['search']).toBe('wire');
  });
});
