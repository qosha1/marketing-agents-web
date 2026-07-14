/**
 * Reviewer-feedback + AI-revise helpers (bd 768w.16.10.4/.5).
 *
 * The full-page draft editor lets a reviewer record a structured judgement
 * (ReviewScorecard) plus section-level critique (ReviewNotes), then "Request
 * revision" hands that critique to an n8n webhook that GPT-rewrites the draft into
 * a NEW version. These are the pure, backend-free helpers that back that flow:
 *   - read the stored review / notes off a draft's `data` blob (camelCase-aware);
 *   - compile the scorecard + notes into the plain-text feedback the rewriter
 *     consumes;
 *   - resolve a draft's revision lineage (revised_from) into an ordered chain for
 *     the "Revision history" affordance and the parent diff.
 * All pure so they unit-test without a running tenant.
 */
import type { ReviewScore, ReviewNote } from '@startsimpli/ui';

import { readData } from '@/lib/board';
import type { EntityRecord } from '@/lib/foundry-api';

/**
 * The reviewer's stored scorecard off a draft's data blob, or an empty score when
 * absent/malformed. The tenant client round-trips the camelCase ReviewScore keys
 * (verdict / dimensions / overallNote) through the wire's snake_case, so a plain
 * read gives them back camelCased.
 */
export function readReview(data: EntityRecord['data'] | undefined): ReviewScore {
  const r = readData(data, 'review');
  return r && typeof r === 'object' && !Array.isArray(r) ? (r as ReviewScore) : {};
}

/** The reviewer's stored section notes off a draft's data blob ([] when absent). */
export function readNotes(data: EntityRecord['data'] | undefined): ReviewNote[] {
  const n = readData(data, 'notes');
  return Array.isArray(n) ? (n as ReviewNote[]) : [];
}

/** The parent draft id a draft was revised from ('' when this is an original). */
export function revisedFrom(d: EntityRecord): string {
  const v = readData(d.data, 'revised_from');
  return v == null ? '' : String(v);
}

/**
 * Compile a reviewer's scorecard + notes into the plain-text feedback the revise
 * webhook feeds GPT: the overall note, then each scored dimension that carries a
 * note (`key: note`), then each UNRESOLVED section note (`[section] body`). Resolved
 * notes are dropped — they're already addressed, so re-feeding them to the rewriter
 * would fight edits the reviewer already accepted. Blank lines are filtered out.
 */
export function compileFeedback(review: ReviewScore, notes: ReviewNote[]): string {
  return [
    review.overallNote,
    ...Object.entries(review.dimensions ?? {})
      .filter(([, v]) => v?.note)
      .map(([k, v]) => `${k}: ${v?.note}`),
    ...notes
      .filter((n) => !n.resolved)
      .map((n) => `[${n.section || 'general'}] ${n.body}`),
  ]
    .map((line) => (line ?? '').trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * The revision lineage a draft belongs to, ordered oldest → newest, so the editor
 * can render "Revision history" (v1, v2, …) and pick the parent to diff against.
 * Walks up via `revised_from` to the root original, then down the `revised_from`
 * children. Assumes a linear chain (each draft revised at most once); cycles and
 * missing links terminate the walk safely. `all` is the full draft set; the focus
 * draft is always included even if `all` omits it.
 */
export function revisionChain(draft: EntityRecord, all: EntityRecord[]): EntityRecord[] {
  const byId = new Map<string, EntityRecord>(all.map((d) => [String(d.id), d]));
  byId.set(String(draft.id), byId.get(String(draft.id)) ?? draft);

  // Walk up to the root original.
  let root = byId.get(String(draft.id)) as EntityRecord;
  const seenUp = new Set<string>([String(root.id)]);
  for (;;) {
    const parentId = revisedFrom(root);
    if (!parentId || !byId.has(parentId) || seenUp.has(parentId)) break;
    seenUp.add(parentId);
    root = byId.get(parentId) as EntityRecord;
  }

  // Walk down the revised_from children from the root.
  const chain: EntityRecord[] = [root];
  const used = new Set<string>([String(root.id)]);
  let cur = root;
  for (;;) {
    const child = all.find((d) => revisedFrom(d) === String(cur.id) && !used.has(String(d.id)));
    if (!child) break;
    chain.push(child);
    used.add(String(child.id));
    cur = child;
  }
  return chain;
}
