/**
 * Resolve a topic's candidate drafts (bd 768w.16.8.6, 768w.16.9.5).
 *
 * A draft links to its topic up to three ways, checked in this priority order
 * (bd startsim-ka3j — verified against LIVE data, not just the model):
 *   1. PRIMARY: `topic_ref` on the draft's data blob equals the topic's `id`
 *      (its UUID pk) — the flat stamp the n8n writer actually echoes back on
 *      every candidate it generates (see "Generate drafts" in the drawer).
 *      This is how linking really works in production; `written_for` below
 *      exists as a relationship type but has ~zero live rows.
 *   2. DEFENSIVE FALLBACK: an explicit `written_for` relationship edge (source
 *      = the draft record, target = the topic record) — the stored graph
 *      edge, for a tenant/pipeline that does populate it.
 *   3. DEFENSIVE FALLBACK: `topic_ref` equals the topic's `external_id`
 *      instead of its pk — in case some other tenant stamps it that way.
 * Matching on any of the three is exact and immune to renamed/duplicated story
 * titles. The matching itself is a pure function so it unit-tests without a
 * backend; `fetchTopicDrafts` just gathers the record sets and hands them to it.
 */
import type { ResolvedReview } from '@startsimpli/ui/collection';
// TYPE-ONLY, and the three functions below load the client lazily instead.
// `@/lib/foundry-api` reaches `@/lib/api`, which calls `createStartSimpliApi()`
// at MODULE SCOPE, which constructs a `FeatureFlagsApi` out of a `'use client'`
// module. A static value import therefore poisons this file for any server
// graph — and `canGenerateDrafts` now has a server caller (`topic-gate.ts`,
// bd startsim-ozpjw.2). Without this, `next build` dies with "Attempted to call
// FeatureFlagsApi() from the server"; nothing in tsc or vitest sees it, because
// both happily evaluate the same module in one runtime.
import type { EntityRecord, RelationshipRecord } from '@/lib/foundry-api';
import { readData, relatedByEdge } from '@/lib/board';

/** The edge key linking a draft (source) to the topic it was written for (target). */
export const WRITTEN_FOR = 'written_for';

/** The edge key linking a translated draft (source) to the original draft it
 *  translates (target) — startsim-ka3j. No live rows yet (no translations have
 *  been produced), so this is exercised against fixtures, not live data. */
export const TRANSLATION_OF = 'translation_of';

/** The entity type whose records are drafts. */
export const DRAFT_TYPE = 'draft';

/**
 * The attribute on a draft naming the topic it was written for — the primary
 * link above, and the one the n8n writer stamps.
 *
 * IT LIVES HERE, next to the priority order it belongs to, because two other
 * modules now have to ask the SCHEMA about it rather than just read it off a
 * record: `drafts-view.ts` and `topic-gate.ts` both narrow server-side only when
 * the draft type DECLARES it (bd startsim-8hgmq.11). Spelling the name twice is
 * how the two halves drift.
 */
export const TOPIC_REF_ATTR = 'topic_ref';

/**
 * How far EITHER half of the drafts gate will page the draft corpus before it
 * gives up — one bound, named once (bd startsim-8hgmq.13).
 *
 * IT LIVES HERE FOR THE SAME REASON `TOPIC_REF_ATTR` DOES. The gate is asked
 * twice about one question — the drawer asks `fetchTopicDrafts` below, the
 * route it guards asks `topic-gate.ts` — and both answered by paging, to depths
 * that had drifted 10x apart: `listAllEntities`'s default 50 x 200, against a
 * private MAX_PAGES 5 x 200 on the server. Same list, same decision, different
 * ceilings, so a topic could resolve in the drawer and 502 in the route.
 *
 * A DEFAULT IS NOT A SHARED BOUND, which is the specific mistake this replaces.
 * `listAllEntities`'s 50 pages is tuned for the news_item board (4,116 rows);
 * retuning it there would have moved this gate's client half and left its server
 * half where it was, with nothing to notice. Both halves now name THIS.
 *
 * The number is deliberately the larger of the two: 10,000 rows against 156 live
 * drafts. It is a stop, not a budget — see the truncation throw in
 * `topic-gate.ts`, which stays exactly as it is. Raising a ceiling does not make
 * a count we could not establish into a count of zero.
 */
export const DRAFT_SCAN = { maxPages: 50, pageSize: 200 } as const;

/**
 * Whether a draft type DECLARES `topic_ref`, and therefore whether the tenant
 * can narrow on it.
 *
 * THE THIRD ANSWER IS WHY THIS EXISTS. The tenant backend has three answers to
 * a filter, not two: honoured; unrecognised-and-ignored (which returns
 * EVERYTHING — the mirror failure `foundry-api.ts` defends against); and
 * ACCEPTED-AND-MATCHED-NOTHING, which is what `attr.<name>` does when the type
 * does not declare `<name>`. That last one comes back `count: 0`, with the
 * parameter in `applied_filters` and NOT in `ignored_filters` — a plausible
 * answer no caller thinks to distrust, and it cost this tenant three production
 * defects in one day. `topic_ref` was written on 147 of 150 live drafts and
 * declared on none of them.
 *
 * Structural argument (`{ name: string }[]`), so a caller can pass Django's raw
 * schema JSON or the camelCased `AttributeDef[]` the browser client produces
 * without a normalisation step that could itself be the bug. An empty list —
 * a type still loading, a type that does not exist — reads as "cannot narrow",
 * which is the safe answer and never "narrow by nothing".
 */
export function declaresTopicRef(attributes: readonly { name: string }[]): boolean {
  return attributes.some((a) => a.name === TOPIC_REF_ATTR);
}

/**
 * The drafts written for a topic — see the priority order documented above.
 * `topicExternalId` is optional (most callers don't have/need it — the primary
 * `topic_ref === topic.id` signal covers live data); pass it to also catch the
 * external_id-stamped fallback. Pure and order-preserving (drafts keep their
 * input order, not the edge order) so it's unit-tested in isolation.
 */
export function matchTopicDrafts(
  topicId: EntityRecord['id'],
  relationships: RelationshipRecord[],
  drafts: EntityRecord[],
  topicExternalId?: string | null,
): EntityRecord[] {
  const topicRefId = String(topicId);
  const topicRefExternal = topicExternalId ? String(topicExternalId) : null;
  const viaEdgeIds = new Set(
    relatedByEdge(topicId, WRITTEN_FOR, relationships, drafts).map((d) => d.id),
  );
  return drafts.filter((d) => {
    const ref = readData(d.data, TOPIC_REF_ATTR);
    if (ref != null && String(ref) === topicRefId) return true; // primary
    if (viaEdgeIds.has(d.id)) return true; // fallback 1
    if (ref != null && topicRefExternal != null && String(ref) === topicRefExternal) return true; // fallback 2
    return false;
  });
}

/**
 * The reverse of matchTopicDrafts: which of `topics` this ONE draft belongs to
 * — same priority order (primary topic_ref === id, then a written_for edge,
 * then topic_ref === external_id), evaluated against the concrete topic list
 * instead of a single known id. null when the draft matches none of them.
 * Used by the draft-progress rollup (startsim-4w76/n7s8): rollupByParent's
 * `parentIdOf` needs exactly this "which parent does this child belong to"
 * shape, not matchTopicDrafts's "which children does this parent have" shape.
 */
export function topicIdForDraft(
  draft: EntityRecord,
  relationships: RelationshipRecord[],
  topics: EntityRecord[],
): EntityRecord['id'] | null {
  const ref = readData(draft.data, TOPIC_REF_ATTR);
  const refStr = ref == null ? null : String(ref);
  if (refStr != null) {
    const byId = topics.find((t) => String(t.id) === refStr);
    if (byId) return byId.id;
  }
  const [viaEdge] = relatedByEdge(draft.id, WRITTEN_FOR, relationships, topics, 'outgoing');
  if (viaEdge) return viaEdge.id;
  if (refStr != null) {
    const byExternalId = topics.find((t) => t.externalId && String(t.externalId) === refStr);
    if (byExternalId) return byExternalId.id;
  }
  return null;
}

/** A draft's display title — its story_title, else the record name, else `#id`. */
export function draftTitle(d: EntityRecord): string {
  const t = readData(d.data, 'story_title');
  const title = t == null ? '' : String(t).trim();
  return title || (d.name ?? '').trim() || `#${d.id}`;
}

/**
 * A draft's status — one of the six the team names (bd startsim-wn2p.2:
 * ready_for_review | under_review | approved | rejected |
 * not_for_publication | for_repurpose), '' when unset.
 */
export function draftStatus(d: EntityRecord): string {
  const s = readData(d.data, 'status');
  return s == null ? '' : String(s);
}

/** A draft's candidate ordinal (1-based, stamped by the writer); 0 when unset. */
export function draftCandidateIndex(d: EntityRecord): number {
  const n = Number(readData(d.data, 'candidate_index'));
  return Number.isFinite(n) ? n : 0;
}

/**
 * A draft's Content-Judge verdict (e.g. 'accept'), read out of the `judge_verdict`
 * object the writer attaches. '' when there's no verdict object or verdict field.
 */
export function draftJudgeVerdict(d: EntityRecord): string {
  const j = readData(d.data, 'judge_verdict');
  if (j && typeof j === 'object' && !Array.isArray(j)) {
    const v = (j as Record<string, unknown>).verdict;
    return v == null ? '' : String(v);
  }
  return '';
}

/**
 * The story payload the n8n writer webhook consumes — one topic → 3 candidate
 * drafts. `topic_ref` is the string topic id the writer echoes onto every
 * candidate so `matchTopicDrafts` can link them back. Kept a pure mapper (no
 * fetch) so it's unit-tested in isolation and reused by the /api route caller.
 */
export interface DraftStory {
  title: string;
  market: string;
  context: string;
  sources: string;
  content_type: string;
  topic_ref: string;
  topic_title: string;
}

/** camelCase-aware read of a data-blob value as a trimmed string ('' when unset). */
function readStr(data: EntityRecord['data'] | undefined, name: string): string {
  const v = readData(data, name);
  return v == null ? '' : String(v).trim();
}

/**
 * Build the writer story from a topic record. Title falls back to the `title`
 * attribute when the record has no name; sources 1–3 are the non-empty ones
 * newline-joined. Pure — the drawer POSTs the result to /api/generate-drafts.
 */
export function buildStoryFromTopic(topic: EntityRecord): DraftStory {
  const title = (topic.name || '').trim() || readStr(topic.data, 'title');
  const sources = [
    readStr(topic.data, 'source_1'),
    readStr(topic.data, 'source_2'),
    readStr(topic.data, 'source_3'),
  ]
    .filter(Boolean)
    .join('\n');
  return {
    title,
    market: readStr(topic.data, 'market'),
    context: readStr(topic.data, 'angle'),
    sources,
    content_type: readStr(topic.data, 'content_type'),
    topic_ref: String(topic.id),
    topic_title: title,
  };
}

// ---- the "Generate drafts" gate (bd startsim-c8izw / startsim-0e9ue) ----
//
// A customer generated drafts from a topic nobody had approved, live, on
// 2026-08-25 — and the control stayed live afterwards, so the writer could be
// fired a second time over an already-reviewed candidate set.
//
// This does NOT define "approved". It consumes the review map the shared
// resolveReviewConfig already produced for this type — the very same object
// ReviewDrawer/InlineReviewActions derive their Approve button from — so the
// gate and the Approve action can never drift apart. (For the topic pipeline
// suggested → ready → written / rejected that derives approve = 'ready'. The
// literal `approveStatus: 'acceptable'` in page.tsx is the news_item config
// and is not in play here.)
//
// `status`, not `team_verdict`, is the signal: status is the pipeline gate the
// writer keys off, and team_verdict is what the re-rank agent turns INTO
// status. OR-ing the verdict in would loosen the gate; AND-ing it would block
// agent-approved topics.

/** The slice of a resolved review map the gate needs — structurally a ResolvedReview. */
export type TopicReview = Pick<ResolvedReview, 'statusName' | 'transitions'>;

/**
 * Whether the writer may be fired for a topic, and when not, WHY. A
 * discriminated result rather than a boolean because the drawer has to render
 * the reason: a disabled control with no explanation is the same confusion in
 * a different shape, and a boolean cannot carry one.
 */
export type GenerateDraftsGate =
  | { allowed: true }
  | { allowed: false; reason: 'not_approved'; message: string }
  | { allowed: false; reason: 'drafts_exist'; message: string };

/**
 * Pure gate for "Generate drafts". Refused when the topic's drafts already
 * exist (hide the control — a second run would silently add a fourth candidate
 * over a set someone has already reviewed) and, failing that, when the topic
 * has not reached its type's approve status.
 *
 * Drafts-exist is checked FIRST so a topic that is both unapproved and already
 * written — the live Aug-25 case — reports the reason worth acting on rather
 * than inviting an approval that would change nothing.
 *
 * A type with no derivable approve status (`transitions.approve` null) is
 * refused, not allowed. Comparing coerced values would make ''===''  read as
 * approved and hand back exactly the ungated button this replaces.
 */
export function canGenerateDrafts(
  topic: EntityRecord,
  review: TopicReview,
  draftCount: number,
): GenerateDraftsGate {
  if (draftCount > 0) {
    return {
      allowed: false,
      reason: 'drafts_exist',
      message: 'Drafts have already been written for this topic.',
    };
  }
  const approveStatus = review.transitions.approve;
  const status = readData(topic.data, review.statusName);
  const approved =
    approveStatus != null && approveStatus !== '' && String(status ?? '') === String(approveStatus);
  if (!approved) {
    return {
      allowed: false,
      reason: 'not_approved',
      message: 'Approve this topic to generate drafts.',
    };
  }
  return { allowed: true };
}

export async function listAllRelationships(maxPages = 20): Promise<RelationshipRecord[]> {
  const { listRelationships } = await import('@/lib/foundry-api');
  const all: RelationshipRecord[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await listRelationships(page);
    all.push(...res.results);
    if (!res.next) break;
  }
  return all;
}

/**
 * Fetch the drafts written for a topic. Gathers all relationship edges plus all
 * draft records, then matches (see matchTopicDrafts's priority order). Accepts
 * the topic record (not just its id) so the external_id fallback is available;
 * returns [] (never a thrown "no drafts") so the drawer can render a clean
 * empty state.
 */
export async function fetchTopicDrafts(
  topic: Pick<EntityRecord, 'id' | 'externalId'>,
): Promise<EntityRecord[]> {
  const { listAllEntities } = await import('@/lib/foundry-api');
  const [relationships, drafts] = await Promise.all([
    listAllRelationships(),
    // DRAFT_SCAN, not `listAllEntities`'s default. The server half of this same
    // gate reads to this bound by name; leaning on a default here is what let
    // the two drift 10x apart (bd startsim-8hgmq.13).
    listAllEntities(DRAFT_TYPE, DRAFT_SCAN),
  ]);
  return matchTopicDrafts(topic.id, relationships, drafts, topic.externalId);
}

// ---- draft <-> draft translations (startsim-ka3j) ----
// No live `translation_of` rows exist yet (no translations have been produced),
// so this is exercised against fixtures in the test file, not live data — the
// language-switcher UI is expected to render "no translations yet" against the
// current live tenant, which is the correct, honest behavior.

/** A draft's declared language ('en' | 'ar'), '' when unset. */
export function draftLang(d: EntityRecord): string {
  const l = readData(d.data, 'lang');
  return l == null ? '' : String(l);
}

/** Drafts that are translations OF `draftId` — other drafts whose
 *  `translation_of` edge targets this draft. */
export function matchDraftTranslations(
  draftId: EntityRecord['id'],
  relationships: RelationshipRecord[],
  drafts: EntityRecord[],
): EntityRecord[] {
  return relatedByEdge(draftId, TRANSLATION_OF, relationships, drafts, 'incoming');
}

/** The draft `draftId` is itself a translation OF (follows its own OUTGOING
 *  `translation_of` edge) — null when this draft isn't a translation of
 *  anything (the common case today: it IS the original). */
export function originalOfTranslation(
  draftId: EntityRecord['id'],
  relationships: RelationshipRecord[],
  drafts: EntityRecord[],
): EntityRecord | null {
  const [original] = relatedByEdge(draftId, TRANSLATION_OF, relationships, drafts, 'outgoing');
  return original ?? null;
}

/**
 * The full language group for a draft: the original (itself, if it isn't a
 * translation of anything) followed by every translation of that original —
 * deduped, `draft` never dropped even if the edges are inconsistent. Doesn't
 * matter which language variant the reviewer opened; the language switcher
 * always lists the same group. Pure — unit-tested against fixtures.
 */
export function draftLanguageGroup(
  draft: EntityRecord,
  relationships: RelationshipRecord[],
  drafts: EntityRecord[],
): EntityRecord[] {
  const original = originalOfTranslation(draft.id, relationships, drafts) ?? draft;
  const translations = matchDraftTranslations(original.id, relationships, drafts);
  const seen = new Set<EntityRecord['id']>();
  const group: EntityRecord[] = [];
  for (const d of [original, ...translations, draft]) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    group.push(d);
  }
  return group;
}

/**
 * Fetch this draft's OTHER language variants (its language group minus
 * itself) — what the language-switcher affordance renders. Returns [] (never
 * throws) so "no translations yet" is a clean, expected empty state.
 */
export async function fetchDraftTranslations(draft: EntityRecord): Promise<EntityRecord[]> {
  const { listAllEntities } = await import('@/lib/foundry-api');
  const [relationships, drafts] = await Promise.all([
    listAllRelationships(),
    listAllEntities(DRAFT_TYPE),
  ]);
  return draftLanguageGroup(draft, relationships, drafts).filter((d) => d.id !== draft.id);
}
