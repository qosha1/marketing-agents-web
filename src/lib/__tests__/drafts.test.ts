import { describe, expect, it } from 'vitest';

import {
  parseSources,
  normUrl,
  groupKeyOf,
  groupDrafts,
  candidateTitle,
  gradeWords,
  wordTargets,
} from '../drafts';
import type { EntityRecord } from '@/lib/foundry-api';

/** Minimal record factory (data is already camelCased by the api client). */
function rec(id: string, name: string, data: Record<string, unknown>): EntityRecord {
  return { id: id as unknown as number, entityType: 'draft', externalId: null, name, data, createdAt: '' };
}

describe('parseSources', () => {
  it('parses the pipe-delimited string shape (weekly writer)', () => {
    const raw =
      'Arab News (2024-08-04) https://www.arabnews.com/node/misa-q2-fdi-licences | Any regional comparison would need a second approved source.';
    const out = parseSources(raw);
    expect(out).toHaveLength(1); // the note segment (no url) is dropped
    expect(out[0].url).toBe('https://www.arabnews.com/node/misa-q2-fdi-licences');
    expect(out[0].outlet).toBe('Arab News');
    expect(out[0].date).toBe('2024-08-04');
  });

  it('parses the JSON array shape', () => {
    const raw = [
      { url: 'https://www.thenationalnews.com/business/economy/uae-china-trade-framework', date: '2026-06-27', outlet: 'The National' },
      { url: 'https://www.fdiintelligence.com/gcc-fdi-2026', date: '2026-06-23', outlet: 'fDi Intelligence' },
    ];
    const out = parseSources(raw);
    expect(out).toHaveLength(2);
    expect(out[0].outlet).toBe('The National');
  });

  it('returns [] for null/garbage', () => {
    expect(parseSources(null)).toEqual([]);
    expect(parseSources(42)).toEqual([]);
  });
});

describe('normUrl', () => {
  it('strips scheme/www/trailing slash and lowercases', () => {
    expect(normUrl('https://www.Invest.qa/')).toBe('invest.qa');
    expect(normUrl('https://www.arabnews.com/node/misa-q2-fdi-licences')).toBe('arabnews.com/node/misa-q2-fdi-licences');
  });
});

describe('groupDrafts', () => {
  // Two candidate sets that share a primary source (the real clustering signal).
  const saudi = [1, 2, 3].map((i) =>
    rec(`s${i}`, `Saudi candidate ${i}`, {
      candidate_index: i,
      content_type: 'weekly_brief',
      chosen: false,
      sources: 'Arab News (2024-08-04) https://www.arabnews.com/node/misa-q2-fdi-licences | note',
    }),
  );
  const qatar = [3, 1, 2].map((i) =>
    rec(`q${i}`, `Qatar candidate ${i}`, {
      candidate_index: i,
      content_type: 'weekly_brief',
      chosen: i === 1,
      status: i === 1 ? 'selected' : '',
      sources: [{ url: 'https://www.invest.qa/', outlet: 'Invest Qatar' }],
    }),
  );

  it('clusters candidates by primary source, sorted by candidate_index', () => {
    const groups = groupDrafts([...saudi, ...qatar]);
    expect(groups).toHaveLength(2);
    const s = groups.find((g) => g.key.includes('arabnews'))!;
    expect(s.candidates.map((c) => c.data.candidate_index)).toEqual([1, 2, 3]);
  });

  it('unresolved groups float above chosen ones', () => {
    const groups = groupDrafts([...saudi, ...qatar]);
    // saudi has nothing chosen -> rank 0; qatar has a pick -> rank 1
    expect(groups[0].key).toContain('arabnews');
    expect(groups[0].chosen).toBeNull();
    expect(groups[1].chosen).not.toBeNull();
  });

  it('groups by name suffix when there is no source', () => {
    const noSrc = [1, 2].map((i) => rec(`c${i}`, `Candidate ${i} — UAE–China trade brief`, { candidate_index: i }));
    const g = groupDrafts(noSrc);
    expect(g).toHaveLength(1);
    expect(g[0].candidates).toHaveLength(2);
    expect(groupKeyOf(noSrc[0])).toBe(groupKeyOf(noSrc[1]));
  });
});

describe('candidateTitle', () => {
  it('strips the "Candidate N —" scaffolding', () => {
    expect(candidateTitle(rec('x', 'Candidate 1 — UAE–China trade brief', {}))).toBe('UAE–China trade brief');
  });
});

describe('gradeWords', () => {
  it('grades against the weekly-brief blog target', () => {
    const t = wordTargets('weekly_brief').blog;
    expect(gradeWords(462, t)).toBe('ok');
    expect(gradeWords(200, t)).toBe('low');
    expect(gradeWords(900, t)).toBe('high');
  });
  it('returns none when no target (lead-magnet linkedin)', () => {
    expect(gradeWords(100, wordTargets('lead_magnet').linkedin)).toBe('none');
  });
});
