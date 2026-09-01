/**
 * The writer run, held where it can outlive the drawer that started it
 * (bd startsim-ozpjw.9).
 *
 * WHY THIS IS A MODULE-LEVEL STORE AND NOT COMPONENT STATE. "Generate drafts"
 * starts an n8n run that takes ~2 minutes (measured: p50 113s, max 130s — see
 * `./generate-poll`). `TopicDrafts` renders inside a drawer that is torn down
 * constantly, and NONE of those teardowns mean "stop watching":
 *
 *   - ReviewDrawer keys its inner drawer on the record id, so j/k, the arrow
 *     keys, the prev/next chevrons and the auto-advance after a decision each
 *     destroy and rebuild the whole thing;
 *   - "Edit fields" (e) swaps the body out and drops `renderExtra` with it;
 *   - closing the drawer (X / Escape / backdrop) unmounts it outright.
 *
 * With `generating` in the component's own `useState`, every one of those killed
 * the poll — and it did not heal on the way back, because QueryProvider sets
 * `staleTime: 5 * 60 * 1000` and `refetchOnWindowFocus: false`, so a remount
 * inside five minutes serves the CACHED EMPTY LIST without refetching and with
 * nothing polling. Only a full page reload recovered. That is the "I refreshed
 * and oh, there they are" report from 2026-08-25.
 *
 * SO THE RUN IS KEYED BY TOPIC ID, NOT BY COMPONENT INSTANCE. A component that
 * mounts for a topic rejoins whatever is already in flight for it.
 *
 * WHAT HAD TO MOVE, AND WHY THE OBVIOUS CUT ISN'T ENOUGH. Hoisting the boolean
 * alone leaves the clock in a `useRef` that is re-created ZEROED on every mount,
 * so a rejoined run computes `elapsedMs = now - 0` and goes terminal on its first
 * tick — polling resumes for one second and then announces that the writer never
 * reported back. All five clock inputs have to survive together.
 *
 * The decision itself is not duplicated here: `generatePollDecision` in
 * `./generate-poll` still owns when to stop looking. This owns only what is left
 * to decide over.
 */
import { generatePollDecision, type GeneratePollDecision, type GeneratePollReason } from './generate-poll';

/**
 * How long a finished run is remembered. Its terminal copy ("The writer hasn't
 * reported back yet…") is worth keeping while the reader might still come back
 * to that topic; it is not worth keeping for the rest of the session, and an
 * unbounded module-level map in a long-lived SPA is a leak. Measured from the
 * START of the run, which is within one `GENERATE_WINDOW_MS` of its end.
 */
export const GENERATE_RUN_MEMORY_MS = 30 * 60_000;

interface Run {
  /** Milliseconds since epoch at the CLICK. The cap is measured from here. */
  startedAt: number;
  /** Drafts visible when the writer was started. */
  baseline: number;
  /** Drafts visible at the last poll. */
  count: number;
  /** When `count` last changed. */
  countChangedAt: number;
  /** When we could last SEE — see `mountGenerateRun`. */
  polledAt: number;
  /** False from a terminal decision onward. */
  running: boolean;
  /** Why it stopped, once it has. Rendered as the empty-list copy. */
  stopped: GeneratePollReason;
  /** Whether a mounted component is currently watching this run. */
  watched: boolean;
}

/**
 * A topic's id. `EntityRecord['id']` is a number; tests and any future
 * string-keyed caller are normalized to the same entry by `key()` below, so 42
 * and '42' can never become two separate runs. Typed locally rather than
 * imported so this module stays free of the API layer.
 */
export type TopicId = string | number;

const runs = new Map<string, Run>();

const key = (topicId: TopicId) => String(topicId);

/** Forget finished runs nobody is coming back to. */
function sweep(now: number) {
  for (const [id, run] of runs) {
    if (!run.running && now - run.startedAt > GENERATE_RUN_MEMORY_MS) runs.delete(id);
  }
}

/** The writer was just started for this topic. */
export function startGenerateRun(topicId: TopicId, { at, baseline }: { at: number; baseline: number }) {
  sweep(at);
  runs.set(key(topicId), {
    startedAt: at,
    baseline,
    count: baseline,
    countChangedAt: at,
    polledAt: at,
    running: true,
    stopped: 'idle',
    watched: true,
  });
}

/**
 * A component instance for this topic mounted — possibly the first, possibly one
 * rejoining a run started before the reader navigated away.
 *
 * REJOINING REFRESHES THE CONTACT POINT. `lost_contact` means "our polls stopped
 * succeeding", which is a real and different story from a slow writer. But a
 * drawer that was closed was not polling and failing — it was not looking. Left
 * alone, a run rejoined more than `GENERATE_STALL_MS` after the last poll would
 * report lost contact the instant it came back, which is both wrong and alarming.
 * The stall clock only runs while somebody is watching.
 *
 * Returns whether a run is live for this topic.
 */
export function mountGenerateRun(topicId: TopicId, now: number): boolean {
  sweep(now);
  const run = runs.get(key(topicId));
  if (!run) return false;
  if (!run.watched) {
    run.watched = true;
    if (run.running) run.polledAt = now;
  }
  return run.running;
}

/** The component instance watching this topic is going away. The run is not. */
export function unmountGenerateRun(topicId: TopicId) {
  const run = runs.get(key(topicId));
  if (run) run.watched = false;
}

export function isGenerateRunning(topicId: TopicId): boolean {
  return runs.get(key(topicId))?.running ?? false;
}

export function generateRunStopped(topicId: TopicId): GeneratePollReason {
  return runs.get(key(topicId))?.stopped ?? 'idle';
}

/** A poll came back with this many drafts for the topic. */
export function noteGenerateCount(topicId: TopicId, count: number, at: number) {
  const run = runs.get(key(topicId));
  if (!run || run.count === count) return;
  run.count = count;
  run.countChangedAt = at;
}

/**
 * A poll came back successfully at `at`.
 *
 * MONOTONIC ON PURPOSE. On remount react-query hands over the CACHED list first,
 * and its `dataUpdatedAt` is from before the drawer closed. Writing that in would
 * re-stale the contact point `mountGenerateRun` just refreshed and trip
 * `lost_contact` a tick later. Contact only ever moves forward.
 */
export function noteGeneratePoll(topicId: TopicId, at: number) {
  const run = runs.get(key(topicId));
  if (run && at > run.polledAt) run.polledAt = at;
}

/** The wait is over, one way or another. */
export function endGenerateRun(topicId: TopicId, reason: GeneratePollReason) {
  const run = runs.get(key(topicId));
  if (!run) return;
  run.running = false;
  run.stopped = reason;
}

const NOT_RUNNING: GeneratePollDecision = { keepPolling: false, terminal: false, reason: 'idle' };

/**
 * Should this topic still be polled, and if not, why did it stop? Delegates to
 * `generatePollDecision` — the clock inputs are the only thing this adds.
 */
export function generateRunDecision(topicId: TopicId, now: number): GeneratePollDecision {
  const run = runs.get(key(topicId));
  if (!run || !run.running) return NOT_RUNNING;
  return generatePollDecision({
    generating: true,
    elapsedMs: now - run.startedAt,
    draftCount: run.count,
    baselineCount: run.baseline,
    sinceCountChangeMs: now - run.countChangedAt,
    sinceSuccessfulPollMs: now - run.polledAt,
  });
}

/** Test hook — the store is module-level, so a test must be able to clear it. */
export function resetGenerateRuns() {
  runs.clear();
}
