/**
 * FIRST CUT (bd startsim-ozpjw.9) — hoist the `generating` state out of the
 * component so navigating the queue doesn't cancel the writer.
 *
 * `TopicDrafts` holds `generating` in its own `useState` and binds the poll to it
 * (`refetchInterval: generating ? GENERATE_POLL_MS : false`), so every teardown
 * of the drawer stops the poll dead. This lifts that boolean into a module-level
 * store keyed by topic id, which a remounting component rejoins.
 *
 * The CLOCK stays where it is today: `useRef({ startedAt: 0, baseline: 0, ... })`
 * inside the component, re-created zeroed on every mount.
 */
import { generatePollDecision, type GeneratePollDecision, type GeneratePollReason } from './generate-poll';

/** How long a finished run's terminal copy is worth keeping. */
export const GENERATE_RUN_MEMORY_MS = 30 * 60_000;

interface RunClock {
  startedAt: number;
  baseline: number;
  count: number;
  countChangedAt: number;
  polledAt: number;
}

interface Run {
  running: boolean;
  stopped: GeneratePollReason;
  endedAt: number;
  clock: RunClock;
}

/** A freshly-created `useRef` — what every new mount starts with. */
function zeroClock(): RunClock {
  return { startedAt: 0, baseline: 0, count: 0, countChangedAt: 0, polledAt: 0 };
}

const runs = new Map<string, Run>();

/** Drop finished runs nobody is coming back to. */
function sweep(now: number) {
  for (const [id, run] of runs) {
    if (!run.running && run.endedAt && now - run.endedAt > GENERATE_RUN_MEMORY_MS) runs.delete(id);
  }
}

export function startGenerateRun(topicId: string, { at, baseline }: { at: number; baseline: number }) {
  sweep(at);
  runs.set(topicId, {
    running: true,
    stopped: 'idle',
    endedAt: 0,
    clock: { startedAt: at, baseline, count: baseline, countChangedAt: at, polledAt: at },
  });
}

/** The component instance watching this topic is going away. */
export function unmountGenerateRun(topicId: string) {
  const run = runs.get(topicId);
  // The boolean is hoisted and survives; the clock lived in the component's
  // refs, so it goes down with the component.
  if (run) run.clock = zeroClock();
}

/** A component instance for this topic mounted. Returns whether a run is live. */
export function mountGenerateRun(topicId: string, now: number): boolean {
  sweep(now);
  return isGenerateRunning(topicId);
}

export function isGenerateRunning(topicId: string): boolean {
  return runs.get(topicId)?.running ?? false;
}

export function generateRunStopped(topicId: string): GeneratePollReason {
  return runs.get(topicId)?.stopped ?? 'idle';
}

export function noteGenerateCount(topicId: string, count: number, at: number) {
  const run = runs.get(topicId);
  if (!run || run.clock.count === count) return;
  run.clock.count = count;
  run.clock.countChangedAt = at;
}

export function noteGeneratePoll(topicId: string, at: number) {
  const run = runs.get(topicId);
  if (run) run.clock.polledAt = at;
}

export function endGenerateRun(topicId: string, reason: GeneratePollReason) {
  const run = runs.get(topicId);
  if (!run) return;
  run.running = false;
  run.stopped = reason;
  run.endedAt = Date.now();
}

/** Should this topic still be polled, and if not, why did it stop? */
export function generateRunDecision(topicId: string, now: number): GeneratePollDecision {
  const run = runs.get(topicId);
  if (!run || !run.running) {
    return generatePollDecision({
      generating: false,
      elapsedMs: 0,
      draftCount: 0,
      baselineCount: 0,
      sinceCountChangeMs: 0,
      sinceSuccessfulPollMs: 0,
    });
  }
  const c = run.clock;
  return generatePollDecision({
    generating: true,
    elapsedMs: now - c.startedAt,
    draftCount: c.count,
    baselineCount: c.baseline,
    sinceCountChangeMs: now - c.countChangedAt,
    sinceSuccessfulPollMs: now - (c.polledAt || c.startedAt),
  });
}

/** Test hook — the store is module-level, so a test must be able to clear it. */
export function resetGenerateRuns() {
  runs.clear();
}
