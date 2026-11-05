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
  it('has seven day buckets ending today, oldest first', () => {
    expect(lastSevenDays(NOW)).toEqual([
      '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04',
    ]);
  });

  it('fills every bucket, zero where nothing came in, from server counts only', async () => {
    api.countEntities.mockImplementation(async (type: string, f: Record<string, string> = {}) => {
      if (type === 'source') return f['attr.active'] ? 4 : 5;
      if (type === 'news_item') return f['attr.published_at__gte'] === '2026-11-02' ? 3 : 0;
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
    expect(o.stages).toEqual({ collecting: 2, ready: 2, made: 9 });
    expect(o.topicsInProgress).toBe(4);
    expect(o.madeIntoContent).toBe(9);
    // Counting never lists rows.
    expect(api.listEntities).not.toHaveBeenCalled();
  });
});
