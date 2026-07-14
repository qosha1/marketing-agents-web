import { describe, it, expect } from 'vitest';
import {
  parseSourceEntry,
  parseSources,
  serializeSources,
  canonicalSourceLine,
  sourceTier,
  sourceAgeDays,
  isStale,
  ageLabel,
  formatSourceDate,
  coverageSummary,
} from '../sources';
import { OGMC_APPROVED_HOSTS } from '../content-checks';

const TODAY = new Date('2026-07-14T00:00:00Z');

describe('parseSourceEntry', () => {
  it('splits publisher / date / url / note from a canonical entry', () => {
    const s = parseSourceEntry(
      'Arab News (2024-08-04) https://arabnews.com/node/misa | record licences figure',
    );
    expect(s.publisher).toBe('Arab News');
    expect(s.date).toBe('2024-08-04');
    expect(s.url).toBe('https://arabnews.com/node/misa');
    expect(s.note).toBe('record licences figure');
    expect(s.raw).toContain('Arab News');
  });

  it('falls back to the host when no publisher label precedes the url', () => {
    const s = parseSourceEntry('https://reuters.com/world/x');
    expect(s.url).toBe('https://reuters.com/world/x');
    expect(s.publisher).toBe('reuters.com');
    expect(s.date).toBe('');
    expect(s.note).toBe('');
  });

  it('trims a trailing url punctuation and reads a dash-separated publisher', () => {
    const s = parseSourceEntry('Zawya - https://zawya.com/story.');
    expect(s.publisher).toBe('Zawya');
    expect(s.url).toBe('https://zawya.com/story');
  });
});

describe('parseSources round-trip', () => {
  it('preserves a newline STRING container verbatim when nothing changed', () => {
    const stored =
      'Arab News (2024-08-04) https://arabnews.com/x | note one\nReuters (2026-01-02) https://reuters.com/y';
    const { items, container } = parseSources(stored);
    expect(container).toBe('string');
    expect(items).toHaveLength(2);
    expect(serializeSources(items, container)).toBe(stored);
  });

  it('preserves an ARRAY container and shape', () => {
    const stored = ['Arab News (2024-08-04) https://arabnews.com/x | note', 'https://ft.com/y'];
    const { items, container } = parseSources(stored);
    expect(container).toBe('array');
    expect(serializeSources(items, container)).toEqual(stored);
  });

  it('reads array-of-objects entries by url', () => {
    const { items } = parseSources([{ url: 'https://ft.com/y' }]);
    expect(items[0].url).toBe('https://ft.com/y');
  });

  it('rebuilds a NEW entry (no raw) in canonical shape and appends to the string', () => {
    const { items, container } = parseSources('Arab News (2024-08-04) https://arabnews.com/x');
    const added = { id: 'https://reuters.com/z', publisher: 'reuters.com', date: '', url: 'https://reuters.com/z', note: '', raw: '' };
    const out = serializeSources([...items, added], container);
    expect(out).toBe('Arab News (2024-08-04) https://arabnews.com/x\nreuters.com https://reuters.com/z');
  });

  it('is empty for a missing value', () => {
    expect(parseSources(undefined).items).toEqual([]);
    expect(parseSources(null).items).toEqual([]);
  });
});

describe('canonicalSourceLine', () => {
  it('assembles publisher (date) url | note', () => {
    expect(
      canonicalSourceLine({ id: 'x', publisher: 'MEED', date: '2025-03-01', url: 'https://meed.com/a', note: 'ok', raw: '' }),
    ).toBe('MEED (2025-03-01) https://meed.com/a | ok');
  });
});

describe('sourceTier', () => {
  it('marks an approved host Tier-1 and an unknown host unverified', () => {
    expect(sourceTier('https://arabnews.com/x', OGMC_APPROVED_HOSTS)).toBe('approved');
    expect(sourceTier('https://randomblog.example/x', OGMC_APPROVED_HOSTS)).toBe('unverified');
    expect(sourceTier('', OGMC_APPROVED_HOSTS)).toBe('unverified');
  });
});

describe('staleness', () => {
  it('computes whole-day age from today and flags >6 months stale', () => {
    expect(sourceAgeDays('2024-08-04', TODAY)).toBe(709);
    expect(isStale(sourceAgeDays('2024-08-04', TODAY))).toBe(true);
    expect(isStale(sourceAgeDays('2026-07-01', TODAY))).toBe(false);
    expect(sourceAgeDays('not-a-date', TODAY)).toBeNull();
  });

  it('labels ages compactly', () => {
    expect(ageLabel(709)).toBe('~2 yr old');
    expect(ageLabel(60)).toBe('~2 mo old');
    expect(ageLabel(10)).toBe('~10 d old');
    expect(ageLabel(0)).toBe('today');
    expect(ageLabel(null)).toBe('');
  });

  it('formats an ISO date human-readably', () => {
    expect(formatSourceDate('2024-08-04')).toBe('Aug 4, 2024');
    expect(formatSourceDate('')).toBe('');
  });
});

describe('coverageSummary', () => {
  it('flags a single stale source as a concern', () => {
    const { items } = parseSources('Arab News (2024-08-04) https://arabnews.com/x');
    const cov = coverageSummary(items, TODAY);
    expect(cov.count).toBe(1);
    expect(cov.oldestDays).toBe(709);
    expect(cov.concern).toBe(true);
  });

  it('is not a concern with two fresh sources', () => {
    const { items } = parseSources(
      'Reuters (2026-06-01) https://reuters.com/a\nFT (2026-05-20) https://ft.com/b',
    );
    const cov = coverageSummary(items, TODAY);
    expect(cov.count).toBe(2);
    expect(cov.concern).toBe(false);
  });
});
