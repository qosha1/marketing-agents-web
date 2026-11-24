import { describe, expect, it } from 'vitest';

import { readComments } from '@/lib/content-comments';

describe('reading comment threads', () => {
  it('flattens threads, oldest first, and drops deleted bodies', () => {
    const page = {
      results: [
        { id: 'b', comments: [{ id: 'b', body: 'Second', created_at: '2026-11-04T10:05:00Z', author: { label: 'Rev' } }] },
        { id: 'a', comments: [
          { id: 'a', body: 'First', createdAt: '2026-11-04T10:00:00Z', author: { sub: 's1' } },
          { id: 'c', body: null, created_at: '2026-11-04T10:01:00Z' },
        ] },
      ],
    };
    expect(readComments(page).map((c) => [c.who, c.text])).toEqual([['s1', 'First'], ['Rev', 'Second']]);
  });

  it('is empty for nothing', () => {
    expect(readComments(null)).toEqual([]);
    expect(readComments({ results: [] })).toEqual([]);
  });
});
