import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ countEntities: vi.fn(), listEntities: vi.fn() }));
vi.mock('@/lib/foundry-api', () => api);
vi.mock('@/lib/project-scope', () => ({ getActiveProjectId: () => null }));

import { lastSevenDays, loadOverview } from '../overview';

const NOW = new Date('2026-11-04T09:00:00');

beforeEach(() => {
  api.countEntities.mockReset();
  api.listEntities.mockReset();
});

describe('overview', () => {
  it('buckets a day as [day, next day): the tenant reads a bare-date __lte as the START of that day', async () => {
    api.countEntities.mockResolvedValue(0);
    await loadOverview(NOW);
    const calls = api.countEntities.mock.calls.filter((c) => c[0] === 'news_item').map((c) => c[1]);
    expect(calls.some((f) => Object.keys(f).some((k) => k.endsWith('__lte')))).toBe(false);
    expect(calls).toContainEqual({ 'attr.published_at__gte': '2026-11-04', 'attr.published_at__lt': '2026-11-05' });
    expect(calls).toContainEqual({ 'attr.published_at__gte': '2026-10-29', 'attr.published_at__lt': '2026-10-30' });
    // The week before: Oct 22 through Oct 28 inclusive.
    expect(calls).toContainEqual({ 'attr.published_at__gte': '2026-10-22', 'attr.published_at__lt': '2026-10-29' });
  });

  it('has seven day buckets ending today, oldest first', () => {
    expect(lastSevenDays(NOW)).toEqual([
      '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04',
    ]);
  });

  it('fills every bucket, zero where nothing came in, from server counts only', async () => {
    api.countEntities.mockImplementation(async (type: string, f: Record<string, string> = {}) => {
      if (type === 'source') return f['attr.active'] ? 4 : 5;
      if (type === 'news_item') {
        if (f['attr.published_at__gte'] === '2026-10-22') return 5; // the week before
        return f['attr.published_at__gte'] === '2026-11-02' ? 3 : 0;
      }
      if (type === 'topic') {
        const s = f['attr.status'];
        return s === 'suggested' ? 2 : s === 'ready' ? 2 : s === 'written' ? 9 : 0;
      }
      return 0;
    });
    const o = await loadOverview(NOW);
    expect(o.bars).toHaveLength(7);
    expect(o.bars.map((b) => b.count)).toEqual([0, 0, 0, 0, 3, 0, 0]);
    expect(o.sourcesConfigured).toBe(5);
    expect(o.sourcesOn).toBe(4);
    expect(o.documentsThisWeek).toBe(3);
    expect(o.documentsLastWeek).toBe(5);
    expect(o.stages).toEqual({ collecting: 2, ready: 2, made: 9 });
    expect(o.topicsInProgress).toBe(4);
    expect(o.madeIntoContent).toBe(9);
    // Counting never lists rows.
    expect(api.listEntities).not.toHaveBeenCalled();
  });
});
