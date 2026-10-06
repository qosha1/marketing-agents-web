'use client';

/**
 * Approving a topic starts its writer (bd startsim-m7fdm.19, the measured
 * restatement of startsim-rc92e).
 *
 * WHAT WAS ACTUALLY WRONG, because it was not "the automation is missing". The
 * chain exists and has completed 31 times: approving writes `status=ready`, the
 * n8n poll `OGMC — Auto-write Ready Topics` picks ready topics up and relays the
 * writer, and the reconcile node moves them to `written`. The poll runs every
 * SIX HOURS and dispatches at most 2 topics per run. So a reviewer approves,
 * nothing visible happens, and the draft may not exist until tomorrow — and the
 * cure they found is to press "Generate drafts" themselves, which is the second
 * step Quinn asked to remove.
 *
 * SO THIS MODULE IS THE DISPATCH, AND IT IS DELIBERATELY NOT A SECOND WRITER
 * PATH. Everything here is a reuse:
 *
 *   - WHEN. `lib/approve-watch.ts` already answers "did that save APPROVE this
 *     topic?" off the record the server persisted, gating on the TRANSITION so a
 *     note added to an already-ready topic is not a fresh approval. Both approve
 *     surfaces (the table's cluster and the board card's) already consult it to
 *     decide whether to navigate. The dispatch hangs off that same answer — it
 *     does not re-derive "approved" and it does not read a button label.
 *   - HOW. `/actions/generate-drafts` is the gate: it re-checks
 *     `canGenerateDrafts` server-side over the tenant's own config, resolves the
 *     caller from their bearer and knows the webhook URL the browser must never
 *     see. The n8n webhook accepts unauthenticated POSTs, so going straight to it
 *     would be stepping around the only gate there is.
 *   - WHAT THE REVIEWER SEES. `lib/generate-run.ts` already owns "a writer is
 *     running for this topic", keyed by topic id in the tab, and `TopicDrafts`
 *     renders it as "Generating… (~2 min)" with the Generate button disabled.
 *
 * THE ORDER IS LOAD-BEARING: CLAIM THE RUN, THEN NAVIGATE, THEN POST. Approving
 * already sends the reviewer to /story/<topicId>, and that page mounts
 * `TopicDrafts`, which seeds `generating` from the run store AT MOUNT. So a run
 * claimed BEFORE the push means the story page renders the writer's progress on
 * its first frame. Posting first and claiming on the 202 would leave the reviewer
 * looking at an enabled "Generate drafts" button for as long as the gate's tenant
 * reads take — which is exactly the window in which they press it, and exactly
 * the complaint this bead is about. Claiming optimistically is the same trade the
 * manual button already makes (see `generate()` in entity-detail-drawer.tsx), and
 * the same undo: a dispatch that does not start ENDS the run, so the progress
 * copy never outlives the thing it describes.
 *
 * `startGenerateRunOnce`, NOT `startGenerateRun`, so an approval landing on a
 * topic whose writer is already running joins that run instead of starting a
 * second one — and then says nothing, because a second toast about a draft
 * already being written is noise.
 *
 * PROVENANCE: `topic_approved`, NOT `generate_button` (bd startsim-rc92e.1,
 * startsim-8hgmq.7). The writer stamps whatever `trigger` it is given as
 * `data._trigger`, and `lib/draft-origin.ts` renders it in the "Created by"
 * column that exists to answer Malin's "who created these drafts?". A dispatch
 * that reused `generate_button` would make every auto-written draft claim
 * somebody pressed a button, undoing that column three weeks after it was built.
 * The approver's IDENTITY is not sent from here at all: the route resolves it
 * from the bearer via `whoami`, so it cannot be spoofed and cannot be left empty
 * by a caller that forgot (bd startsim-8hgmq.2 — an empty person reads worse than
 * no person).
 */
import { notify } from '@startsimpli/ui';

import { getRegisteredToken } from '@/infrastructure/auth';
import { formatBearer } from '@/lib/bearer';
// The trigger VALUE lives with the renderer that has to understand it, not here
// (bd startsim-m7fdm.19). A literal spelled in this file and switched on in that
// one is how an auto-written draft ends up labelled "a caller this app does not
// recognise" — the regression rc92e's first constraint is about.
import { relayedTopicVersion } from '@/lib/dispatch-stamp';
import { APPROVAL_TRIGGER } from '@/lib/draft-origin';
import type { EntityRecord } from '@/lib/foundry-api';
import { endGenerateRun, startGenerateRunOnce } from '@/lib/generate-run';
import { rememberVersion } from '@/lib/record-version';
import { buildStoryFromTopic } from '@/lib/topic-drafts';

/** What the reviewer is told at the moment of approval. */
export const APPROVAL_DISPATCH_MESSAGE = 'Approved — writing the draft now (~2 min).';

/**
 * How the route's refusal should be reported to someone who pressed Approve, not
 * Generate.
 *
 * `null` means SAY NOTHING, and the case that needs it is `drafts_exist`: a
 * reviewer re-approving a topic that already has a draft has done nothing wrong
 * and asked for nothing new, so "Drafts have already been written for this
 * topic." as a red toast on an Approve click is a failure report for a
 * non-failure. The story page they are being sent to is already about to list
 * those drafts, or step straight into the only one.
 *
 * Every OTHER refusal is worth saying out loud, because the reviewer now believes
 * a draft is being written and it is not. The route's own `error` is preferred
 * over anything invented here — it is the explanation the drawer already renders
 * for the same refusals ("Approve this topic to generate drafts", "Could not
 * verify the topic") — and the fallback names the status rather than hiding it.
 *
 * Pure, so the four shapes are decided in the node lane.
 */
export function approvalDispatchRefusal(
  status: number,
  body: { error?: unknown; reason?: unknown } | null | undefined,
): string | null {
  if (body?.reason === 'drafts_exist') return null;
  const detail = typeof body?.error === 'string' ? body.error.trim() : '';
  if (detail) return `Approved, but the draft could not be started: ${detail}`;
  return `Approved, but the draft could not be started (${status}).`;
}

/**
 * Start the writer for a topic that has just been approved.
 *
 * NEVER THROWS and never blocks the caller: approving is the reviewer's act and
 * it has already succeeded by the time this runs. A dispatch that fails must
 * report itself and leave the approval alone — so this is fired and not awaited
 * by either surface, and every failure path both ends the run and says why.
 */
export async function dispatchDraftForApproval(topic: EntityRecord): Promise<void> {
  const topicId = topic.id;
  // Baseline 0, not the drawer's `drafts.length`: neither approve surface knows
  // this topic's draft count — the table and the board list topics, not drafts.
  // A freshly approved topic has none, and a re-approval with drafts already in
  // hand is refused by the gate below (`drafts_exist`) before the baseline is
  // ever consulted.
  if (!startGenerateRunOnce(topicId, { at: Date.now(), baseline: 0 })) return;

  try {
    const res = await fetch('/actions/generate-drafts', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // AWAITED. `getRegisteredToken()` is async and an unawaited
        // interpolation sends `Bearer [object Promise]`, which Django rejects —
        // the bug `lib/bearer.ts` exists to refuse (measured in production
        // 2026-08-24, Translate dead for five days).
        authorization: formatBearer(await getRegisteredToken()),
      },
      body: JSON.stringify({ story: buildStoryFromTopic(topic), trigger: APPROVAL_TRIGGER }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      endGenerateRun(topicId, 'idle');
      const message = approvalDispatchRefusal(res.status, body);
      if (message) notify.error(message);
      return;
    }
    // THE RELAY WROTE TO THIS TOPIC, so the version the next save must assert
    // has moved (bd startsim-jkkn7.13). Without this the Accept at the end of
    // the flow this bead builds — approve, wait ~2 min, read the draft, accept —
    // asserts the pre-stamp version and is refused with a 412 that describes no
    // conflict. `rememberVersion` takes a record and reads `.version` off it, so
    // the reported integer is handed over in that shape.
    const version = relayedTopicVersion(body);
    if (version !== undefined) rememberVersion(topicId, { version });
    notify.success(APPROVAL_DISPATCH_MESSAGE);
  } catch (err) {
    // Ended in the store as well as in this call, so navigating back to the
    // topic does not rejoin a run that never began.
    endGenerateRun(topicId, 'idle');
    notify.error(
      err instanceof Error
        ? `Approved, but the draft could not be started: ${err.message}`
        : 'Approved, but the draft could not be started.',
    );
  }
}
