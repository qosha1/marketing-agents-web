/**
 * When to keep looking for the drafts a writer run is producing (bd startsim-tkz9d).
 *
 * WHY THIS IS A MODULE AND NOT AN EFFECT BODY. "Generate drafts" fires the n8n
 * writer and returns immediately; the candidates appear in the tenant a minute or
 * two later, so the drawer polls. Deciding when to STOP polling is the whole
 * feature, it has four distinct outcomes, and it was wrong in a way nobody could
 * see. Pure and evaluated over plain numbers so vitest can exercise it
 * (`environment: 'node'`, `.ts` only — no jsdom, no testing-library, so the
 * component itself cannot be rendered in a test here).
 *
 * WHAT WAS WRONG. The window was 90s, bound to the refetch interval, and the
 * empty-list copy never changed. Measured against the writer it was watching —
 * every retained execution of "OGMC — Weekly Insight Writer" (n8n
 * ornNNyf2MXl0qtEM), 11 runs over 2026-08-25 → 08-31, all successful:
 *
 *     97.9 100.2 103.3 104.0 112.5 113.3 113.3 115.3 117.7 118.8 130.0  (seconds)
 *     min 97.9s · p50 113.3s · p90 118.8s · p95 124.4s · max 130.0s
 *
 * ZERO of the 11 finished inside 90s — the FASTEST run is 9% past the cap. So the
 * poll stopped before the drafts landed on every run, and the page sat there not
 * looking while the copy still read "No drafts written for this topic yet." The
 * only way to see them was the Refresh button or a browser reload, which is
 * exactly what was seen twice in front of the team on 2026-08-25.
 *
 * THE FOUR OUTCOMES, and why each one exists:
 *
 *  - `waiting`      the writer is running and we have nothing yet.
 *  - `arriving`     some candidates are in, but the writer upserts them one
 *                   request at a time, so a poll can land between the first and
 *                   the third. Stopping at the first stranded the rest behind a
 *                   manual Refresh. We keep polling until the count settles.
 *  - `no_response`  the window expired with nothing. This is what the cap was
 *                   for and it is kept — a silent writer failure must not spin
 *                   forever. What changes is that it now SAYS SO.
 *  - `lost_contact` the polls themselves stopped succeeding. A different story
 *                   from a slow writer, and the reader should not be told the
 *                   writer is still working when we simply cannot see.
 */

export type GeneratePollReason =
  | 'idle'
  | 'waiting'
  | 'arriving'
  | 'drafts_arrived'
  | 'no_response'
  | 'lost_contact';

export interface GeneratePollState {
  /** True from the click on "Generate drafts" until a terminal state. */
  generating: boolean;
  /** Milliseconds since the writer was started — measured from the CLICK. */
  elapsedMs: number;
  /** Drafts visible for this topic right now. */
  draftCount: number;
  /** Drafts visible at the moment the writer was started. */
  baselineCount: number;
  /** Milliseconds since `draftCount` last changed. */
  sinceCountChangeMs: number;
  /** Milliseconds since a poll last came back successfully. */
  sinceSuccessfulPollMs: number;
}

export interface GeneratePollDecision {
  /** Keep the refetch interval running. */
  keepPolling: boolean;
  /** The wait is over, one way or another. */
  terminal: boolean;
  /** What the component renders. */
  reason: GeneratePollReason;
}

/**
 * How often we re-read the topic's drafts while the writer runs. Deliberately
 * unchanged: a longer window at this interval is ~45 polls instead of ~11, and
 * `fetchTopicDrafts` pages every relationship plus every draft record. That is
 * the cost of the fix and it is accepted — the alternative is not seeing the
 * drafts at all. Revisit the INTERVAL, not the window, if the read gets heavy.
 */
export const GENERATE_POLL_MS = 8_000;

/**
 * How long we keep polling before declaring the writer silent.
 *
 * ~2.9x the measured p95 (124.4s) and ~2.8x the measured max (130.0s). Not a
 * round number for its own sake — the headroom is doing work. Two reasons the
 * measurement is a LOWER bound, both arguing for the generous end:
 *
 *  1. All 11 retained runs are `status: success`. This is a p95 of successes; it
 *     says nothing about how long a hung run takes to die.
 *  2. All 11 are `mode: "integrated"` — sub-workflow calls. The latency a person
 *     actually waits through is the parent's, which is at least this.
 *
 * n8n prunes execution history (~3 days, ~20 runs) so 11 is the whole retained
 * population, not a sample we chose. This is why the VISIBLE terminal below
 * matters more than the exact constant: the number will drift, the copy won't.
 */
export const GENERATE_WINDOW_MS = 360_000;

/**
 * How quiet the draft count must go before we call the set complete. Two poll
 * intervals — one to notice the last candidate, one to confirm nothing follows.
 */
export const GENERATE_SETTLE_MS = 2 * GENERATE_POLL_MS;

/** How long polls may fail before we say we've lost contact rather than "waiting". */
export const GENERATE_STALL_MS = 60_000;

/**
 * How often the drawer re-asks `generatePollDecision`. Separate from the POLL
 * interval on purpose: the question "are we still waiting?" is answered from
 * numbers already in hand, costs nothing, and must be asked ON THE WINDOW
 * BOUNDARY rather than whenever a refetch happens to resolve.
 */
export const GENERATE_TICK_MS = 1_000;

/**
 * Should we still be looking, and if not, why did we stop?
 *
 * Order matters: drafts in hand beat every clock, so a set that lands right on
 * the window boundary reads as arrived rather than as a timeout.
 */
export function generatePollDecision(state: GeneratePollState): GeneratePollDecision {
  if (!state.generating) return { keepPolling: false, terminal: false, reason: 'idle' };

  if (state.draftCount > state.baselineCount) {
    const settled =
      state.sinceCountChangeMs >= GENERATE_SETTLE_MS || state.elapsedMs >= GENERATE_WINDOW_MS;
    return settled
      ? { keepPolling: false, terminal: true, reason: 'drafts_arrived' }
      : { keepPolling: true, terminal: false, reason: 'arriving' };
  }

  if (state.sinceSuccessfulPollMs >= GENERATE_STALL_MS) {
    return { keepPolling: false, terminal: true, reason: 'lost_contact' };
  }

  if (state.elapsedMs >= GENERATE_WINDOW_MS) {
    return { keepPolling: false, terminal: true, reason: 'no_response' };
  }

  return { keepPolling: true, terminal: false, reason: 'waiting' };
}

/**
 * The line shown under "Drafts" for a given reason; null when there is nothing to
 * say (no drafts and nobody waiting -> the ordinary empty copy).
 *
 * The two failure lines both point at Refresh ON PURPOSE: giving up watching is
 * not the same as the writer having failed, and the drafts may well land a moment
 * later. Saying nothing is what made a slow run look like a broken button.
 */
export function generatePollMessage(reason: GeneratePollReason): string | null {
  switch (reason) {
    case 'waiting':
      return 'Waiting for the writer to return candidates…';
    case 'arriving':
      return 'Candidates are arriving…';
    case 'no_response':
      return 'The writer hasn’t reported back yet. It may still be running — use Refresh to check.';
    case 'lost_contact':
      return 'Lost contact while waiting for the writer. Use Refresh to check for new drafts.';
    default:
      return null;
  }
}

/** True for the reasons that mean "we stopped watching and you should know". */
export function isGeneratePollFailure(reason: GeneratePollReason): boolean {
  return reason === 'no_response' || reason === 'lost_contact';
}
