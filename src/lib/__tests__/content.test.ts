import { describe, it, expect } from 'vitest';
import { contentTabHref, contentBoardHref, contentCategoryLabel } from '../content';

describe('contentTabHref', () => {
  it('links to the topic TABLE pre-filtered by content_type', () => {
    expect(contentTabHref('weekly_brief')).toBe('/t/topic?content_type=weekly_brief');
  });
});

describe('contentBoardHref (startsim-uhmk)', () => {
  it('links to the topic BOARD pre-filtered by content_type', () => {
    expect(contentBoardHref('weekly_brief')).toBe('/board/topic?content_type=weekly_brief');
  });
  it('encodes the category key', () => {
    expect(contentBoardHref('a b')).toBe('/board/topic?content_type=a%20b');
  });
});

describe('contentCategoryLabel', () => {
  it('maps a declared category key to its label', () => {
    expect(contentCategoryLabel('lead_magnet')).toBe('Lead Magnets');
  });
  it('falls back to the raw key for an unknown category', () => {
    expect(contentCategoryLabel('mystery')).toBe('mystery');
  });
});
