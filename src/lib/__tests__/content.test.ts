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
    // The team's word for this type is "Evergreen"; the stored key stays `lead_magnet`.
    expect(contentCategoryLabel('lead_magnet')).toBe('Evergreen');
  });
  it('humanizes an unknown category rather than showing the raw enum value', () => {
    // Changed deliberately: these labels drive the SIDEBAR and page headings now,
    // and a nav item reading "case_study" is a defect the old raw-key fallback
    // would have shipped the moment OGMC declares a fourth content type.
    expect(contentCategoryLabel('case_study')).toBe('Case study');
    expect(contentCategoryLabel('mystery')).toBe('Mystery');
  });
});
