/**
 * RED for bd startsim-d0j7d — the findability pair.
 *
 * TWO SYMPTOMS, ONE CAUSE: the record lists have no notion of what the user just
 * did, or of what they are looking for.
 *
 * Malin, on the 2026-08-25 walkthrough, having approved a topic: "you go in, you
 * approve the topic, and then what you approved ends up down at the list, where
 * you have to scroll to find a checkmark. There should be an easier way to find
 * those." A DebuggAI browser agent independently burned its whole 20-step budget
 * on the same page for the same reason — it acted on a row and the row moved.
 *
 * THE DESIGN CONSTRAINT, in Quinn's words, because it rules out the obvious wrong
 * answer: "we want to minimize the number of places that things go, and optimize
 * for speed of accessing and filtering them... moving it into different places
 * makes it harder for people to find it later." ONE home for drafts — solved with
 * defaults and search, NOT a new tab per state.
 */
import { describe, it, expect } from 'vitest';

import {
  defaultTopicOrder,
  holdActedPositions,
  readmitActed,
  noteActed,
  searchFilters,
  pickTitleAttr,
  inFilters,
  MAX_IN_VALUES,
  applyAttrFilters,
  type ActedRow,
} from '@/lib/board';
import {
  draftsViewChips,
  clearedDraftsView,
  draftsViewFilters,
  DRAFTS_DEFAULT_DAYS,
  TOPIC_GATE_PARAM,
} from '@/lib/drafts-view';
import type { EntityRecord } from '@/lib/foundry-api';

/** A topic row. `n` doubles as the id and orders createdAt newest-first. */
function topic(n: number, status: string): EntityRecord {
  return {
    id: n,
    entityType: 'topic',
    externalId: null,
    name: `topic ${n}`,
    data: { status, title: `Topic ${n}` },
    // n=1 newest, so the natural default order is 1,2,3,4,5.
    createdAt: `2026-08-${String(20 - n).padStart(2, '0')}T00:00:00Z`,
  };
}

const suggested = [1, 2, 3, 4, 5].map((n) => topic(n, 'suggested'));

/** The list after the reviewer approves topic 2 (suggested -> ready). */
function afterApproving2(): EntityRecord[] {
  return suggested.map((r) => (r.id === 2 ? topic(2, 'ready') : r));
}

const APPROVED_2: ActedRow[] = [{ id: 2, index: 1, decision: 'approve' }];

describe('CHARACTERIZATION — why the row disappears (this is the cause, not the bug)', () => {
  it('ranks by status, so approving a topic sinks it below every remaining suggested one', () => {
    const before = [...suggested].sort(defaultTopicOrder);
    expect(before.findIndex((r) => r.id === 2)).toBe(1);

    const after = [...afterApproving2()].sort(defaultTopicOrder);
    // rank(ready)=1 > rank(suggested)=0 — the row the reviewer just touched
    // travels to the bottom of the list. On a 59-topic table that is off-page.
    expect(after.findIndex((r) => r.id === 2)).toBe(4);
  });

  it('and under an active State=suggested facet the row leaves the list entirely', () => {
    const kept = applyAttrFilters(afterApproving2(), [{ name: 'status', value: 'suggested' }]);
    expect(kept.map((r) => r.id)).not.toContain(2);
  });
});

describe('d0j7d (a) — a topic you just approved stays in reach', () => {
  it('holds a just-approved row at the position it held when it was approved', () => {
    const ordered = holdActedPositions(afterApproving2(), APPROVED_2, defaultTopicOrder);
    expect(ordered.findIndex((r) => r.id === 2)).toBe(1);
    // and it is still the same five rows, in a stable order
    expect(ordered.map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it('re-admits a just-approved row that the active facet would now drop', () => {
    const all = afterApproving2();
    const kept = applyAttrFilters(all, [{ name: 'status', value: 'suggested' }]);
    const withActed = readmitActed(all, kept, APPROVED_2);
    expect(withActed.map((r) => r.id)).toContain(2);
    // re-admitted, then held in place — not appended to the end
    expect(holdActedPositions(withActed, APPROVED_2, defaultTopicOrder).findIndex((r) => r.id === 2)).toBe(1);
  });

  it('leaves an untouched list exactly as the default order left it', () => {
    expect(holdActedPositions(afterApproving2(), [], defaultTopicOrder).map((r) => r.id))
      .toEqual([...afterApproving2()].sort(defaultTopicOrder).map((r) => r.id));
  });

  it('remembers the FIRST position a row was acted on, so re-deciding does not move it', () => {
    const once = noteActed([], { id: 2, index: 1, decision: 'approve' });
    const twice = noteActed(once, { id: 2, index: 4, decision: 'reject' });
    expect(twice).toHaveLength(1);
    expect(twice[0].index).toBe(1);
    expect(twice[0].decision).toBe('reject');
  });
});

describe('d0j7d (b) — Drafts can be searched by title, SERVER-side', () => {
  it('builds the verified attr.<name>__icontains shape, not a client-side scan', () => {
    // Verified live against the deployed tenant: ?type=topic&attr.title__icontains=qatar
    // -> count 4, applied ['attr.title__icontains','type'].
    expect(searchFilters('qatar', 'title')).toEqual({ 'attr.title__icontains': 'qatar' });
  });

  it('treats a blank box as no filter at all', () => {
    expect(searchFilters('   ', 'title')).toEqual({});
    expect(searchFilters('', 'title')).toEqual({});
  });

  it('trims the term so a trailing space does not become a substring nobody matches', () => {
    expect(searchFilters('  gas  ', 'title')).toEqual({ 'attr.title__icontains': 'gas' });
  });
});

describe('d0j7d (c) — the Drafts default filter is VISIBLE and CLEARABLE', () => {
  const now = new Date('2026-08-26T12:00:00Z');

  it('opens on "topic approved" + a 5-7 day window, and SAYS SO in two chips', () => {
    const chips = draftsViewChips({}, now);
    expect(chips.map((c) => c.param)).toEqual([TOPIC_GATE_PARAM, 'since']);
    // An invisible default filter is worse than no filter: it teaches people the
    // pipeline is empty. Both halves have to be readable on the page.
    expect(chips[0].label).toMatch(/topic approved/i);
    expect(chips[1].label).toMatch(/7 days/i);
    expect(DRAFTS_DEFAULT_DAYS).toBeGreaterThanOrEqual(5);
    expect(DRAFTS_DEFAULT_DAYS).toBeLessThanOrEqual(7);
  });

  it('clears to a view with NO chips and NO narrowing — the whole pipeline', () => {
    const cleared = clearedDraftsView();
    expect(draftsViewChips(cleared, now)).toEqual([]);
    expect(draftsViewFilters(cleared, ['10', '11'])).toEqual({});
  });

  it('each half clears on its own', () => {
    expect(draftsViewChips({ [TOPIC_GATE_PARAM]: 'all' }, now).map((c) => c.param)).toEqual(['since']);
    expect(draftsViewChips({ since: 'all' }, now).map((c) => c.param)).toEqual([TOPIC_GATE_PARAM]);
  });

  it('narrows to the approved topics SERVER-side, with the backend comma list', () => {
    expect(draftsViewFilters({}, ['10', '11'])).toEqual({ 'attr.topic_ref__in': '10,11' });
  });

  it('does not silently return everything when no topic is approved', () => {
    // A gate that matches nothing must narrow to nothing, never widen to all.
    expect(draftsViewFilters({}, [])).toEqual({ 'attr.topic_ref__in': '__none__' });
  });
});

describe('the comma-list cap the backend actually enforces', () => {
  it('builds attr.<name>__in as a comma list', () => {
    expect(inFilters('topic_ref', ['1', '2', '3'])).toEqual({ 'attr.topic_ref__in': '1,2,3' });
  });

  it('refuses a list past MAX_IN_VALUES rather than earning a 400', () => {
    // tenant-starter apps/api/filters.py: MAX_ID_LIST = 200, `at most 200 values`.
    expect(MAX_IN_VALUES).toBe(200);
    const tooMany = Array.from({ length: MAX_IN_VALUES + 1 }, (_, i) => String(i));
    expect(inFilters('topic_ref', tooMany)).toBeNull();
  });
});

describe('WHICH attribute the title search actually searches', () => {
  const typeWith = (...names: string[]) => ({
    id: 't',
    key: 'k',
    label: 'K',
    attributes: names.map((n) => ({
      id: n,
      name: n,
      dataType: 'text' as const,
      required: false,
      config: {},
    })),
  });

  it('searches `title` on the topic spine', () => {
    expect(pickTitleAttr(typeWith('title', 'angle', 'status'))).toBe('title');
  });

  it('searches `story_title` on drafts — which do NOT declare `title`', () => {
    // THE BUG THIS PINS. f4lac asks for title search on DRAFTS ("if you
    // remember the title you can add a word in it"), and a draft's title is
    // `story_title` (title-durability.ts: "a draft's title is `name` first and
    // `data.story_title` second"). Gating the box on a declared `title` put the
    // search on Topics and left it off the one surface the bead named.
    expect(pickTitleAttr(typeWith('story_title', 'blog', 'status'))).toBe('story_title');
  });

  it('offers no search box for a type with no titley attribute at all', () => {
    expect(pickTitleAttr(typeWith('domain', 'tier'))).toBeNull();
    expect(pickTitleAttr(null)).toBeNull();
  });
});

describe('a type that declares no title attribute is still searchable (bd startsim-f4lac)', () => {
  // MEASURED against the live tenant 2026-08-27, which is what makes this a bug
  // and not a design choice: `draft` declares FOURTEEN attributes and not one of
  // them is titley —
  //   content_type, candidate_index, blog, linkedin, seo, sources, judge_verdict,
  //   auto_checks, chosen, sent_at, assignee_sub, assignee_name, lang, status
  // so pickTitleAttr(draft) is null, and gating the box on it left /t/draft — the
  // one surface f4lac names — with no search box at all. Confirmed in the browser
  // after deploy: filter chips rendered, search box absent.
  //
  // A draft's title lives in the entity's `name` column, and the backend DOES
  // search it: ?type=draft&search=qatar -> count 19 of 99,
  // applied_filters ['search','type'].

  it('falls back to the backend full-text search over the entity name', () => {
    expect(searchFilters('qatar', null)).toEqual({ search: 'qatar' });
  });

  it('trims, and a blank term is no filter at all — never search=', () => {
    // Same rule as the attribute path: the backend reports an empty term as
    // ignored, and an ignored filter is a filter that silently did nothing.
    expect(searchFilters('  gas  ', null)).toEqual({ search: 'gas' });
    expect(searchFilters('   ', null)).toEqual({});
    expect(searchFilters('', null)).toEqual({});
  });

  it('still prefers the declared attribute when there is one', () => {
    // Topics declare `title`, and attr.title__icontains is narrower than a
    // full-text sweep across every field — so the fallback must not take over.
    expect(searchFilters('qatar', 'title')).toEqual({ 'attr.title__icontains': 'qatar' });
  });
});
