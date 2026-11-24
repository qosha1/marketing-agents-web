import { beforeEach, describe, expect, it, vi } from 'vitest';

const listEntities = vi.fn();
vi.mock('@/lib/foundry-api', () => ({ listEntities: (...a: unknown[]) => listEntities(...a), listAllEntities: vi.fn() }));

import { fetchTopicMarkets } from '@/lib/content-queries';
import type { EntityRecord } from '@/lib/foundry-api';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const draft = (ref: string) => ({ id: 'd', data: { topic_ref: ref } }) as unknown as EntityRecord;

describe('fetchTopicMarkets (bd startsim-xwtv0.3)', () => {
  beforeEach(() => {
    listEntities.mockReset();
  });

  it('sends only UUID-shaped ids, so one stray ref cannot 400 the whole read', async () => {
    listEntities.mockResolvedValue({ results: [{ id: U1, data: { market: 'GCC' } }] });
    const out = await fetchTopicMarkets([draft(U1), draft('legacy-topic'), draft(U2)]);
    expect(listEntities.mock.calls[0][2].id__in).toBe(`${U1},${U2}`);
    expect(out[U1]).toEqual({ market: 'GCC' });
  });

  it('makes no request when no ref is a UUID', async () => {
    expect(await fetchTopicMarkets([draft('legacy-topic'), draft('')])).toEqual({});
    expect(listEntities).not.toHaveBeenCalled();
  });

  it('returns no markets rather than throwing when the lookup is refused', async () => {
    listEntities.mockImplementation(async () => {
      throw new Error('400');
    });
    expect(await fetchTopicMarkets([draft(U1)])).toEqual({});
  });
});
