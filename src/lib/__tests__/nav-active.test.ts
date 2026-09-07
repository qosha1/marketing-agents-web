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

import { buildNav } from '@/foundry.nav';
import type { AttributeDef, EntityTypeDef } from '@/lib/foundry-api';
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

/**
 * BOTH PRESENTATIONS OF ONE THING (bd startsim-flv2x.10).
 *
 * A nav item names a set of records, not a route. `/t/<type>` and
 * `/board/<type>` are two ways of LOOKING at that same set — the table and the
 * status lanes — and every nav item has to pick exactly one of them for its
 * href. So on the other one the sidebar went blank:
 *
 *   /t/topic?content_type=weekly_brief      Weekly Briefs lit (href is the table)
 *   /board/topic?content_type=weekly_brief  NOTHING lit — measured live
 *
 * and the Data group has the same hole mirrored, because typeRoute sends a
 * status-carrying type to the board: News Item's href IS /board/news_item, so
 * its TABLE at /t/news_item lit nothing. Either way exactly one of the two
 * presentations left the sidebar with no selection at all, which reads as "you
 * have left where you were" — the complaint startsim-flv2x is about, and it
 * fires even now that flv2x.3 makes the scope survive the trip.
 *
 * THE TRAP, and why these assertions are on the WHOLE nav rather than on one
 * href: matching by type alone fixes the blank sidebar and lights the wrong
 * item. /board/topic?content_type=lead_magnet and
 * /board/topic?content_type=weekly_brief are both `topic`; the Content items
 * are told apart by content_type, not by type. "Nothing highlighted" traded for
 * "confidently the wrong thing highlighted" is a worse bug, so the assertion
 * that matters is EXACTLY ONE, by name, on each of the four locations.
 */
const schemaStatusAttr: AttributeDef = {
  id: 's', name: 'status', dataType: 'enum', required: false,
  config: { choices: ['suggested', 'ready', 'written'] },
};
const schemaContentTypeAttr: AttributeDef = {
  id: 'ct', name: 'content_type', dataType: 'enum', required: false,
  config: { choices: ['weekly_brief', 'lead_magnet', 'general'] },
};

/** The live shape: topic + draft under Content, and a board type + a table type under Data. */
const SCHEMA: EntityTypeDef[] = [
  { id: 'topic', key: 'topic', label: 'Topic', attributes: [schemaStatusAttr, schemaContentTypeAttr] },
  { id: 'draft', key: 'draft', label: 'Draft', attributes: [] },
  // Declares status, so typeRoute makes its nav href the BOARD, not the table.
  { id: 'news_item', key: 'news_item', label: 'News Item', attributes: [schemaStatusAttr] },
  { id: 'source', key: 'source', label: 'Source', attributes: [] },
];

/** Every nav item the sidebar would highlight at `location`, by label. */
function highlighted(location: string): string[] {
  const lit: string[] = [];
  for (const entry of buildNav(SCHEMA)) {
    const links = 'items' in entry ? entry.items : [entry];
    for (const link of links) {
      if (navIsActive(link.href, location)) lit.push(link.label);
    }
  }
  return lit;
}

describe('a nav item is active for BOTH presentations of the thing it names', () => {
  it('lights the kind you are in on its table', () => {
    expect(highlighted('/t/topic?content_type=weekly_brief')).toEqual(['Weekly Briefs']);
  });

  it('lights the same kind on its BOARD, where the sidebar used to go blank', () => {
    expect(highlighted('/board/topic?content_type=weekly_brief')).toEqual(['Weekly Briefs']);
  });

  it('lights a board-href Data item on its TABLE, the mirror of the same hole', () => {
    // News Item's href is /board/news_item (typeRoute), so this is the side the
    // Data group was blank on.
    expect(highlighted('/t/news_item')).toEqual(['News Item']);
  });

  it('lights a board-href Data item on its own board', () => {
    expect(highlighted('/board/news_item')).toEqual(['News Item']);
  });

  it('THE TRAP: a board of another kind lights THAT kind, never its sibling', () => {
    // Both are `topic`. Matching on type alone lights Weekly Briefs here, which
    // is worse than lighting nothing because it is confidently wrong.
    expect(highlighted('/board/topic?content_type=lead_magnet')).toEqual(['Evergreen']);
  });

  it('lights Topics on the all-kinds board, as it already does on the all-kinds table', () => {
    expect(highlighted('/board/topic')).toEqual(['Topics']);
    expect(highlighted('/t/topic')).toEqual(['Topics']);
  });

  it('yields the all-kinds item to a kind on the board too', () => {
    expect(navIsActive('/t/topic', '/board/topic?content_type=lead_magnet')).toBe(false);
    expect(navIsActive(WEEKLY, '/board/topic?content_type=lead_magnet')).toBe(false);
    expect(navIsActive(LEAD, '/board/topic?content_type=lead_magnet')).toBe(true);
  });

  it('does not spread a type across its neighbours', () => {
    expect(navIsActive('/board/news_item', '/board/deal')).toBe(false);
    expect(navIsActive('/board/news_item', '/t/deal')).toBe(false);
    // The /t/topicality guard above, from the board side.
    expect(navIsActive('/t/topic', '/board/topicality')).toBe(false);
    expect(navIsActive('/t/room', '/boardroom')).toBe(false);
  });
});
