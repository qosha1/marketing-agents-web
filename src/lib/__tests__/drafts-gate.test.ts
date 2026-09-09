import { describe, it, expect } from 'vitest';
import {
  applyOriginGate,
  applyTopicGate,
  clearedDraftsView,
  draftsGateNeedsClient,
  draftsViewChips,
  draftsViewFilters,
  originGateActive,
  ORIGIN_GATE_PARAM,
  TOPIC_GATE_PARAM,
} from '../drafts-view';
import { MAX_IN_VALUES } from '../board';
import type { AttributeDef, EntityRecord } from '../foundry-api';

/**
 * The Drafts tab opened EMPTY for every user, always (bd startsim-8hgmq.4), and
 * this file is what it left behind.
 *
 * `topic_ref` was not a DECLARED attribute on the draft type, and the tenant
 * backend answers `attr.<undeclared>` with `count: 0` while reporting it in
 * `applied_filters` and NOT in `ignored_filters` — indistinguishable from a
 * filter that legitimately matched nothing. So the default view narrowed to zero
 * rows under a chip that said "Topic approved", and the only way to see any
 * draft was to press "Show everything".
 *
 * `topic_ref` IS DECLARED NOW (bd startsim-8hgmq.11, verified live: 147 drafts
 * carry it and `?attr.topic_ref__in=<26 approved ids>` answers 81, having
 * answered 0 the hour before). So the server-side narrowing rule 8 asks for is
 * back — but it is back BEHIND A RUNTIME CHECK, not behind a comment saying the
 * attribute is declared.
 *
 * THAT CHECK IS THE POINT OF THIS FILE. The page already holds the draft type's
 * attributes; the filter is built only when `topic_ref` is among them. Undeclare
 * it — by hand, by a rebuilt tenant, by a type that never had it — and the
 * request silently stops carrying the filter and the client narrows instead:
 * correct-but-slower, which is the failure mode this bead exists to guarantee.
 * It also fail-safes while the type is still loading, when `attributes` is [].
 */
const draft = (id: number, topicRef?: string): EntityRecord =>
  ({ id, name: `d${id}`, data: topicRef ? { topic_ref: topicRef } : {} }) as unknown as EntityRecord;

const attr = (name: string): AttributeDef =>
  ({ id: name, name, dataType: 'text', required: false, config: {} }) as AttributeDef;

/** The draft type as the live tenant declares it since 2026-09-07. */
const DECLARED = [attr('status'), attr('content_type'), attr('topic_ref')];
/** The same type as it stood while it was emptying the tab for everyone. */
const UNDECLARED = [attr('status'), attr('content_type')];

describe('the drafts topic gate narrows server-side, but only where the schema says it can', () => {
  it('sends attr.topic_ref__in once the attribute is declared', () => {
    expect(draftsViewFilters({}, ['11', '22'], DECLARED)).toEqual({
      'attr.topic_ref__in': '11,22',
    });
  });

  it('sends NOTHING when topic_ref is undeclared, whatever ids it was handed', () => {
    // The 8hgmq.4 tenant. A request carrying this filter comes back `count: 0`
    // with the parameter in `applied_filters`, and the table renders
    // "0 total / No results found" under a chip claiming to have filtered.
    expect(draftsViewFilters({}, ['11', '22'], UNDECLARED)).toEqual({});
  });

  it('sends nothing while the type is still loading', () => {
    // `type?.attributes ?? []` is what the page passes before the schema query
    // resolves. An empty list must read as "cannot narrow", never as "narrow by
    // nothing" — the second is a request that comes back empty.
    expect(draftsViewFilters({}, ['11', '22'], [])).toEqual({});
  });

  it('sends no sentinel filter when nothing is approved', () => {
    // The original code sent `attr.topic_ref__in=__none__` here. It matched
    // nothing — but so did the real id list, which is what hid the defect.
    // An empty list is not narrowable server-side; applyTopicGate over an empty
    // id set returns the same empty answer without a request that lies.
    expect(draftsViewFilters({}, [], DECLARED)).toEqual({});
  });

  it('sends nothing past the backend comma-list cap', () => {
    const tooMany = Array.from({ length: MAX_IN_VALUES + 1 }, (_, i) => String(i));
    expect(draftsViewFilters({}, tooMany, DECLARED)).toEqual({});
    // …and exactly at the cap it still narrows.
    const atCap = Array.from({ length: MAX_IN_VALUES }, (_, i) => String(i));
    expect(Object.keys(draftsViewFilters({}, atCap, DECLARED))).toEqual(['attr.topic_ref__in']);
  });

  it('sends nothing once the reader clears the gate', () => {
    expect(draftsViewFilters({ topic: 'all' }, ['11'], DECLARED)).toEqual({});
  });

  it('STILL narrows on the client while the gate is on, declared or not', () => {
    // The server filter is an optimisation, never the only gate. It costs one
    // Set lookup over rows already in memory, and it is the standing defence
    // against the MIRROR silence `foundry-api.ts` warns about: an unrecognised
    // parameter that is dropped, returning EVERYTHING under an active chip.
    expect(draftsGateNeedsClient({}, ['11', '22'])).toBe(true);
    expect(draftsGateNeedsClient({}, [])).toBe(true);
  });

  it('asks for no client narrowing once the gate is cleared', () => {
    expect(draftsGateNeedsClient({ topic: 'all' }, ['11'])).toBe(false);
  });

  it('keeps only the drafts written for an approved topic', () => {
    const rows = [draft(1, '11'), draft(2, '99'), draft(3), draft(4, '22')];
    expect(applyTopicGate(rows, ['11', '22']).map((r) => r.id)).toEqual([1, 4]);
    expect(applyTopicGate(rows, [])).toEqual([]);
  });
});

/**
 * THE THIRD HALF OF THE DEFAULT VIEW: the customer stops being shown the drafts
 * we made while testing her tenant (bd startsim-onrb7).
 *
 * THE BRIEF FOR THIS BEAD SAID TO KEY OFF `_trigger` / `_triggered_by` AND NOT
 * OFF OWNERSHIP. Measured against the live tenant on 2026-09-09, over all 156
 * drafts, that is backwards:
 *
 *   _trigger        150 rows carry NO key at all; 3 say `schedule`, 3 say
 *                   `generate_button`. The stamp went live 2026-09-07T21:31Z, so
 *                   it describes two days of a two-month corpus.
 *   _triggered_by   3 rows, and every one of them names `schilder@ogmc.ai` —
 *                   THE CUSTOMER. Not one draft in this tenant is attributable
 *                   to the platform team through the trigger fields.
 *   owner_sub       153 `svc:n8n-ogmc`, and 3 rows owned by a PERSON:
 *                   `1c44a170-…` = qa-marketing-agents@startsimpli.com (2) and
 *                   `9adeea3b-…` = qa+ma@startsimpli.com (1). Resolved against
 *                   the live roster. Those three are two Chinese and one Arabic
 *                   translation, written while the translate action was being
 *                   tested. They are exactly the rows the bead is about.
 *
 * The bead's reasoning came from startsim-1oo1.2, which says ownership does not
 * gate READS because no marketing-agents type declares `row_scope`. True, and
 * about a different mechanism: the server will not filter BY owner, but every
 * row carries `owner_sub` in its response and this gate runs on the client.
 *
 * SO IT READS BOTH, and each is load-bearing for a different half of time:
 * `owner_sub` finds the three that exist today, `_triggered_by` catches the next
 * one the moment a platform account presses "Generate drafts". Neither is a
 * request parameter: `_triggered_by` is not a declared attribute (draft-origin.ts
 * spells out why filtering on one returns `count: 0` in silence — bd
 * startsim-8hgmq.4) and `owner_sub` is a row column, not an attribute at all.
 */
describe('the drafts test-draft gate', () => {
  const OPERATORS = ['1c44a170', '9adeea3b'];
  const made = (id: number, over: Partial<EntityRecord>): EntityRecord =>
    ({ id, name: `d${id}`, data: {}, ...over }) as unknown as EntityRecord;

  it('hides a draft owned by a platform account', () => {
    const rows = [
      made(1, { ownerSub: 'svc:n8n-ogmc' }),
      made(2, { ownerSub: '1c44a170' }),
      made(3, { ownerSub: '9adeea3b' }),
      made(4, { ownerSub: 'f496dea4' }), // schilder@ogmc.ai — the customer
    ];
    expect(applyOriginGate(rows, OPERATORS).map((r) => r.id)).toEqual([1, 4]);
  });

  it('hides a draft a platform account TRIGGERED, whoever owns the row', () => {
    // The forward guard. Every draft the writer produces lands under
    // `svc:n8n-ogmc` however it was started, so once someone of ours presses
    // the button the owner says nothing and `_triggered_by` is the only mark.
    const rows = [
      made(1, { ownerSub: 'svc:n8n-ogmc', data: { _triggered_by: 'schilder@ogmc.ai' } }),
      made(2, { ownerSub: 'svc:n8n-ogmc', data: { _triggered_by: 'qosha@debugg.ai' } }),
    ];
    expect(applyOriginGate(rows, OPERATORS).map((r) => r.id)).toEqual([1]);
  });

  it('reads the camelCased spelling the API client hands back', () => {
    // The shared @startsimpli/api client camelCases response keys, so
    // `_triggered_by` arrives as `TriggeredBy`. draft-origin.ts hit this first.
    const rows = [made(1, { ownerSub: 'svc:n8n-ogmc', data: { TriggeredBy: 'qa+ma@startsimpli.com' } })];
    expect(applyOriginGate(rows, OPERATORS)).toEqual([]);
  });

  it('keeps everything when the roster could not be read', () => {
    // Fail OPEN. An empty operator list means "we could not tell who is who",
    // and a queue that hides rows it cannot justify hiding is worse than one
    // that shows three it should not.
    const rows = [made(1, { ownerSub: '1c44a170' }), made(2, { ownerSub: 'svc:n8n-ogmc' })];
    expect(applyOriginGate(rows, []).map((r) => r.id)).toEqual([1, 2]);
  });

  it('clears on ?made=all, like the other two halves', () => {
    expect(originGateActive({})).toBe(true);
    expect(originGateActive({ [ORIGIN_GATE_PARAM]: 'all' })).toBe(false);
  });
});

describe('the default view says all three halves are on, and every one clears', () => {
  it('opens on three chips', () => {
    expect(draftsViewChips({}).map((c) => c.param)).toEqual([TOPIC_GATE_PARAM, 'since', ORIGIN_GATE_PARAM]);
  });

  it('drops just the half a reader cleared', () => {
    expect(draftsViewChips({ [ORIGIN_GATE_PARAM]: 'all' }).map((c) => c.param)).toEqual([
      TOPIC_GATE_PARAM,
      'since',
    ]);
  });

  it('turns the WHOLE default off in one link', () => {
    // "Show everything" and the withheld-count button both point here. It has
    // to clear all three: every one of the 38 topic-less drafts (bd
    // startsim-sr38f) is older than 15 days, so clearing the topic gate alone
    // surfaces exactly none of them — the recency window still hides them.
    expect(draftsViewChips(clearedDraftsView())).toEqual([]);
  });
});
