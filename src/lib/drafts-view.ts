/**
 * The Drafts table's DEFAULT VIEW (bd startsim-f4lac).
 *
 * Quinn's spec from the Aug-25 call: "maybe the default filter is drafts that
 * have topics that have been approved and that were created in the last five
 * days or seven days. And then if you change the filters you can start looking
 * for... we can add a search bar, so if you remember the title you can add a
 * word in it."
 *
 * AND THE CONSTRAINT THAT RULES OUT THE OBVIOUS WRONG ANSWER, same call: "we
 * want to minimize the number of places that things go, and optimize for speed
 * of accessing and filtering them... moving it into different places makes it
 * harder for people to find it later." So this is a DEFAULT on the one Drafts
 * table, not a second tab — /t/draft stays the only home for a draft.
 *
 * THE DEFAULT IS VISIBLE AND CLEARABLE, and that is the part to get right. An
 * invisible default filter is worse than no filter: it teaches people the
 * pipeline is empty. Both halves render as their own chip, each clears on its
 * own, and both live in the URL so a narrowed view is shareable and a reload
 * does not quietly re-narrow a view someone widened.
 *
 * FORK-LOCAL ON PURPOSE (rule 9). The reusable halves — the search-filter
 * builder, the comma-list builder, the recency window — are generic and live in
 * lib/board.ts; the shared debounced search box already ships in
 * @startsimpli/ui's UnifiedTable toolbar. What is OGMC's alone is WHICH default
 * this tenant opens on, and that is all this module holds.
 */
import {
  applyRecencyWindow,
  inFilters,
  pickRecencyWindow,
  readData,
  RECENCY_ALL,
  RECENCY_PARAM,
} from '@/lib/board';
import type { AttributeDef, EntityRecord } from '@/lib/foundry-api';
import { declaresTopicRef, TOPIC_REF_ATTR } from '@/lib/topic-drafts';

/** URL param carrying the "only drafts whose topic was approved" half. */
export const TOPIC_GATE_PARAM = 'topic';

/** The param value that clears a half of the default — shared with `since`. */
export const GATE_ALL = RECENCY_ALL;

/**
 * The window the Drafts table opens on. Quinn said "five days or seven"; 7 is
 * the wider of the two and is already one of the offered RECENCY_WINDOWS, so the
 * control can express it without adding a bespoke option nothing else has.
 */
export const DRAFTS_DEFAULT_DAYS = 7;

/**
 * Topic statuses that mean "this subject was approved to write".
 *
 * `written` is included deliberately: it is the stage a topic reaches AFTER its
 * drafts exist, so gating on `ready` alone would hide the drafts of every topic
 * the pipeline has already finished with — the exact rows a reviewer is most
 * likely to be looking for the day after approving them.
 */
export const APPROVED_TOPIC_STATUSES = ['ready', 'written'];

/** The attribute on a draft that names the topic it was written for. */
export { TOPIC_REF_ATTR };

/** A default-filter chip: what it narrows, and the URL value that clears it. */
export interface ViewChip {
  /** URL param this chip owns. */
  param: string;
  /** The value that turns this half OFF (what the chip's ✕ links to). */
  value: string;
  label: string;
}

type Params = Record<string, string | undefined | null>;

/** True when the "topic approved" half is still in force. */
export function topicGateActive(params: Params): boolean {
  return String(params[TOPIC_GATE_PARAM] ?? '') !== GATE_ALL;
}

/**
 * The chips to render above the table, in display order. Empty when the user has
 * cleared both halves — at which point the table is showing the whole pipeline
 * and says so by having nothing to say.
 */
export function draftsViewChips(params: Params, now: Date = new Date()): ViewChip[] {
  const out: ViewChip[] = [];
  if (topicGateActive(params)) {
    out.push({ param: TOPIC_GATE_PARAM, value: GATE_ALL, label: 'Topic approved' });
  }
  const window = pickRecencyWindow(params, DRAFTS_DEFAULT_DAYS);
  if (window.days != null) {
    out.push({ param: RECENCY_PARAM, value: RECENCY_ALL, label: `Last ${window.days} days` });
  }
  void now;
  return out;
}

/** The params that turn the WHOLE default off — what "Show everything" links to. */
export function clearedDraftsView(): Record<string, string> {
  return { [TOPIC_GATE_PARAM]: GATE_ALL, [RECENCY_PARAM]: RECENCY_ALL };
}

/**
 * The request filters for the drafts default view — narrowed server-side, and
 * ONLY where the schema says the server can narrow.
 *
 * FINDING OUT WHY THIS CANNOT BE UNCONDITIONAL COST THE DRAFTS TAB
 * (bd startsim-8hgmq.4). It used to narrow with `attr.topic_ref__in` outright
 * (rule 8 — narrow before fetching, not after). But `topic_ref` was not a
 * DECLARED attribute on the draft type, and the tenant backend answers a filter
 * on an undeclared attribute with `count: 0` while reporting it in
 * `applied_filters` and NOT in `ignored_filters`. So the tab rendered
 * "0 total / No results found" for every user, on every load, under a chip that
 * said "Topic approved" — with 150 drafts in the tenant and 81 of them written
 * for an approved topic.
 *
 * `foundry-api.ts` already warns about the MIRROR of this: an UNRECOGNISED
 * parameter is silently IGNORED and the request returns EVERYTHING. Same
 * silence, opposite direction. Only one of the two had been defended against.
 *
 * `topic_ref` IS DECLARED NOW (bd startsim-8hgmq.11, applied 2026-09-07 via
 * `scripts/schemas/ogmc.json` + `redenormalize_attributes`; measured live,
 * `?attr.topic_ref__in=<26 approved ids>` answers 81 having answered 0 the hour
 * before). So the narrowing is back. What is NOT back is the assumption: this
 * reads `attributes` — the draft type the page has already fetched to build its
 * columns — and builds the filter only when `topic_ref` is among them. There is
 * no comment here asserting the attribute is declared, because a comment is
 * exactly what was wrong last time.
 *
 * UNDECLARE IT AND NOTHING BREAKS, WHICH IS THE WHOLE GUARANTEE. The request
 * quietly stops carrying the filter, {@link applyTopicGate} narrows the rows
 * instead, and the tab is correct-but-slower rather than silently empty. The
 * same holds while the schema query is still in flight, when `attributes` is [].
 *
 * The recency half was never a request parameter and still is not: a draft's age
 * is `core_entity.created_at`, a column, and the tenant's EntityQuery recognises
 * no filter on it (`occurred_after` aliases the `occurred_at` ATTRIBUTE, not the
 * row's own timestamp). See {@link applyDraftsRecency}.
 */
export function draftsViewFilters(
  params: Params,
  approvedTopicIds: string[],
  attributes: Pick<AttributeDef, 'name'>[],
): Record<string, string> {
  if (!topicGateActive(params)) return {};
  if (!declaresTopicRef(attributes)) return {};
  // `inFilters` returns null for an empty list and for one past the backend's
  // comma-list cap — both mean "the server cannot narrow this", never "no
  // filter". {@link draftsGateNeedsClient} is unconditional, so either way the
  // client gate still runs and the answer is the same, only wider on the wire.
  return inFilters(TOPIC_REF_ATTR, approvedTopicIds) ?? {};
}

/**
 * True whenever the gate is on — ALWAYS, even when the request above narrowed.
 *
 * The server filter is an optimisation, not the gate. This costs one Set lookup
 * over rows already in memory, and it is the standing defence against the MIRROR
 * silence: a parameter the backend does not recognise is dropped and the whole
 * corpus comes back under an active chip. Making this conditional on the server
 * filter would trade a cheap re-check for a class of failure that has already
 * happened here twice.
 *
 * Note the empty-approved case is `true` as well, and must be: the original code
 * sent an `__none__` sentinel so an active chip could never widen to the whole
 * corpus. {@link applyTopicGate} over an empty id list gives the same empty
 * result without a request that lies about what it filtered.
 */
export function draftsGateNeedsClient(params: Params, approvedTopicIds: string[]): boolean {
  void approvedTopicIds;
  return topicGateActive(params);
}

/** Client-side form of the same gate, for the cap-exceeded case above. */
export function applyTopicGate(records: EntityRecord[], approvedTopicIds: string[]): EntityRecord[] {
  const ids = new Set(approvedTopicIds.map(String));
  return records.filter((r) => ids.has(String(readData(r.data, TOPIC_REF_ATTR) ?? '')));
}

/** The ids of every topic whose status counts as approved. */
export function approvedTopicIds(topics: EntityRecord[]): string[] {
  const ok = new Set(APPROVED_TOPIC_STATUSES);
  return topics.filter((t) => ok.has(String(readData(t.data, 'status') ?? ''))).map((t) => String(t.id));
}

/**
 * The recency half, applied on the client — see {@link draftsViewFilters} for
 * why it cannot be a request parameter. `attrName` is null so every draft is
 * measured by its own `createdAt`: `draft` declares `sent_at`, which exactly one
 * of 77 live drafts carries, so measuring by the declared date would push the
 * other 76 outside every window.
 */
export function applyDraftsRecency(
  records: EntityRecord[],
  params: Params,
  now: Date = new Date(),
): EntityRecord[] {
  return applyRecencyWindow(records, pickRecencyWindow(params, DRAFTS_DEFAULT_DAYS), null, now);
}
