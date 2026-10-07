/**
 * Accept a draft: approve it AND move its topic to `written`, without leaving the
 * two records disagreeing (bd startsim-jkkn7.13).
 *
 * THE PROBLEM. These are two PATCHes to two records with no transaction. The
 * topic write used to merge `status: written` over the topic blob the page read —
 * possibly minutes earlier — so once writes became conditional (bd
 * startsim-j19hf) it could be refused with a 412 AFTER the draft had already
 * been approved. The queue then showed an approved draft under a topic that
 * still said it was unwritten.
 *
 * And it could be worse than refused. The precondition comes from the version
 * registry (lib/record-version.ts), which ANY read advances — a list refetch, or
 * the approve relay reporting the version its dispatch stamp produced (PR #86).
 * So the topic write could assert a version NEWER than the blob it merged over,
 * pass, and silently erase whatever changed in between (e.g. that dispatch
 * stamp). Re-reading the topic and merging onto what comes back fixes both.
 *
 * THE ORDER, AND WHY.
 *
 *  1. Re-read the topic. If its DECISION moved since the page read it — status
 *     or verdict — somebody else decided something about this topic, and Accept
 *     must not quietly overrule them. Stop with NOTHING written.
 *  2. Approve the draft. Its own write is guarded by the page's conflict hook,
 *     and a refusal there opens the stale-save dialog; nothing else is written.
 *  3. Move the topic, merged onto the blob from step 1 and asserting the version
 *     that read reported. The window for a refusal is now one draft PATCH wide.
 *  4. If it is refused anyway: re-read ONCE, and retry ONCE only if the decision
 *     still has not moved — merging onto the new blob, so the retry carries
 *     whatever the other writer changed rather than re-sending over it.
 *  5. If the topic still cannot be moved, put the draft back to what it was
 *     (its own guarded write), and say which state things were left in.
 *
 * WHAT THIS NEVER DOES: write the topic without a precondition. Every topic
 * PATCH goes through `saveEntity` -> `updateEntity`, which asserts the version
 * the preceding `getEntity` remembered. Adopting a refusal's `current_version`
 * and re-sending the SAME body would be the overwrite the 412 exists to stop;
 * the retry here re-reads the body as well, and only for a non-decision change.
 *
 * THE RESIDUAL GAP: a tab closed between steps 2 and 3 still leaves an approved
 * draft under an unwritten topic. Only a server-side accept can close that.
 */
import type { QueryClient } from '@tanstack/react-query';

import { readData } from '@/lib/board';
import { saveEntity } from '@/lib/entity-cache';
import { getEntity, type EntityRecord } from '@/lib/foundry-api';

export const TOPIC_WRITTEN_STATUS = 'written';

export type AcceptOutcome =
  /** Draft approved and topic written. */
  | { status: 'accepted' }
  /** The topic's decision moved since the page read it. Nothing was written. */
  | { status: 'topic-moved'; topicStatus: string }
  /** The draft's own save did not land (the page has already reported it). */
  | { status: 'draft-not-saved' }
  /**
   * The topic could not be moved. `draftRestored` says whether the draft was put
   * back; when false the two records DO disagree and the reviewer must be told.
   */
  | { status: 'topic-refused'; detail: string; draftRestored: boolean };

export interface AcceptDraftOptions {
  qc: QueryClient;
  /** The topic as the page read it — what the reviewer saw when they decided. */
  topic: EntityRecord;
  /** Approve the draft. Resolves true only when the write is on the server. */
  approveDraft: () => Promise<boolean>;
  /** Put the draft back as it was before `approveDraft`. True when it landed. */
  restoreDraft: () => Promise<boolean>;
  statusAttr?: string;
  verdictAttr?: string;
}

function field(record: EntityRecord, name: string): string {
  const v = readData(record.data, name);
  return v == null ? '' : String(v);
}

/** Did somebody else DECIDE something about this topic since `seen` was read? */
function decisionMoved(seen: EntityRecord, fresh: EntityRecord, attrs: readonly string[]): boolean {
  return attrs.some((a) => field(seen, a) !== field(fresh, a));
}

function isRefusal(error: unknown): boolean {
  return (error as { status?: unknown } | null)?.status === 412;
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  const detail = (error as { detail?: unknown } | null)?.detail;
  return typeof detail === 'string' && detail ? detail : 'the topic could not be saved';
}

export async function acceptDraft({
  qc,
  topic,
  approveDraft,
  restoreDraft,
  statusAttr = 'status',
  verdictAttr = 'team_verdict',
}: AcceptDraftOptions): Promise<AcceptOutcome> {
  const decision = [statusAttr, verdictAttr];

  // 1. The read that every later write asserts against.
  let fresh = await getEntity(topic.id);
  if (decisionMoved(topic, fresh, decision)) {
    return { status: 'topic-moved', topicStatus: field(fresh, statusAttr) };
  }

  // 2. The draft.
  if (!(await approveDraft())) return { status: 'draft-not-saved' };

  // 3 + 4. The topic, retried once on a refusal that did not move the decision.
  const write = (base: EntityRecord) =>
    saveEntity(qc, topic.id, { data: { ...base.data, [statusAttr]: TOPIC_WRITTEN_STATUS } });
  let failure: unknown;
  try {
    await write(fresh);
    return { status: 'accepted' };
  } catch (error) {
    failure = error;
  }
  if (isRefusal(failure)) {
    try {
      fresh = await getEntity(topic.id);
      if (!decisionMoved(topic, fresh, decision)) {
        await write(fresh);
        return { status: 'accepted' };
      }
      failure = new Error(
        `the topic was changed by someone else (it is now “${field(fresh, statusAttr) || 'unset'}”)`,
      );
    } catch (error) {
      failure = error;
    }
  }

  // 5. Compensate.
  let draftRestored = false;
  try {
    draftRestored = await restoreDraft();
  } catch {
    draftRestored = false;
  }
  return { status: 'topic-refused', detail: messageOf(failure), draftRestored };
}
