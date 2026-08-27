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
import type { EntityRecord } from '@/lib/foundry-api';

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
export const TOPIC_REF_ATTR = 'topic_ref';

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
 * The SERVER-SIDE half of the default: the approved topics' ids as an
 * `attr.topic_ref__in` comma list (rule 8 — narrow before fetching, not after).
 *
 * THE RECENCY HALF IS NOT HERE, and that is a fact about the backend rather than
 * a shortcut. A draft's age is `core_entity.created_at`, a column, and the
 * tenant's EntityQuery recognises no filter on it: `_ENTITY_FILTERS` is
 * type, id, id__in, external_id, search, source, party, occurred_after,
 * occurred_before, the related_ family and order — and `occurred_after` aliases
 * the `occurred_at` ATTRIBUTE, not
 * the row's own timestamp. Guessing `attr.created_at__gte` would now earn a 400
 * rather than being ignored. So recency is applied by {@link applyDraftsRecency}
 * over the topic-narrowed set, whose size the gate above already bounds.
 *
 * An ACTIVE gate with no approved topics narrows to a sentinel that matches
 * nothing, never to `{}`. Returning no filter there would widen the result to
 * the whole corpus under a filled-in filter chip — the failure mode that handed
 * a cleanup loop page 1 of the corpus and cost nine production rows.
 */
export function draftsViewFilters(params: Params, approvedTopicIds: string[]): Record<string, string> {
  if (!topicGateActive(params)) return {};
  if (approvedTopicIds.length === 0) return { [`attr.${TOPIC_REF_ATTR}__in`]: '__none__' };
  return inFilters(TOPIC_REF_ATTR, approvedTopicIds) ?? {};
}

/**
 * True when the gate is on but the server cannot express it — more approved
 * topics than the backend's comma-list cap. The caller must then narrow with
 * {@link applyTopicGate} on the client rather than show an unnarrowed list under
 * an active chip.
 */
export function draftsGateNeedsClient(params: Params, approvedTopicIds: string[]): boolean {
  if (!topicGateActive(params)) return false;
  return approvedTopicIds.length > 0 && inFilters(TOPIC_REF_ATTR, approvedTopicIds) == null;
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
