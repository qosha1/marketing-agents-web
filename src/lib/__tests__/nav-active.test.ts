/**
 * Sidebar active-state, which was wrong once the content types became their own
 * nav items.
 *
 * THE BUG: "Topics" (/t/topic) and "Lead Magnets" (/t/topic?content_type=…)
 * share a pathname. The matcher stripped the query before comparing plain
 * hrefs, so `curPath === hrefPath` was true on every category page and Topics
 * lit up alongside whichever category you were actually in — two items
 * highlighted at once, and the sidebar stopped telling you where you were.
 *
 * THE RULE: the all-kinds view yields to a kind. A plain href stays active for
 * ordinary params (paging, sort) — those are not places, they are state — but
 * NOT while a param that has its own nav destination is applied.
 */
import { describe, expect, it } from 'vitest';

import { navIsActive } from '@/lib/nav-active';

const TOPICS = '/t/topic';
const WEEKLY = '/t/topic?content_type=weekly_brief';
const LEAD = '/t/topic?content_type=lead_magnet';
const DRAFTS = '/t/draft';

describe('navIsActive', () => {
  it('lights Topics on the unfiltered topic table', () => {
    expect(navIsActive(TOPICS, '/t/topic')).toBe(true);
  });

  it('does NOT light Topics while a kind filter is applied', () => {
    // The regression this file exists for.
    expect(navIsActive(TOPICS, '/t/topic?content_type=lead_magnet')).toBe(false);
    expect(navIsActive(TOPICS, '/t/topic?content_type=weekly_brief')).toBe(false);
  });

  it('lights exactly one kind, and only the matching one', () => {
    const cur = '/t/topic?content_type=lead_magnet';
    expect(navIsActive(LEAD, cur)).toBe(true);
    expect(navIsActive(WEEKLY, cur)).toBe(false);
    expect(navIsActive(TOPICS, cur)).toBe(false);
  });

  it('does not light a kind on the unfiltered table', () => {
    expect(navIsActive(LEAD, '/t/topic')).toBe(false);
  });

  it('keeps a plain item active through paging and sorting', () => {
    // Ordinary query state is not a place — it must not blank the sidebar.
    expect(navIsActive(TOPICS, '/t/topic?page=2')).toBe(true);
    expect(navIsActive(DRAFTS, '/t/draft?page=3&sort=created')).toBe(true);
  });

  it('keeps the kind active alongside unrelated params', () => {
    expect(navIsActive(LEAD, '/t/topic?content_type=lead_magnet&page=2')).toBe(true);
  });

  it('keeps a plain item active on a child route', () => {
    expect(navIsActive(DRAFTS, '/t/draft/abc-123')).toBe(true);
  });

  it('matches Dashboard only exactly, never as a prefix of everything', () => {
    expect(navIsActive('/', '/')).toBe(true);
    expect(navIsActive('/', '/t/topic')).toBe(false);
  });

  it('is inactive with no current location', () => {
    expect(navIsActive(TOPICS, undefined)).toBe(false);
  });

  it('does not confuse a path that merely starts with the same characters', () => {
    expect(navIsActive('/t/topic', '/t/topicality')).toBe(false);
  });
});
