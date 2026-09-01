import { beforeEach, describe, it, expect } from 'vitest';
import {
  GENERATE_RUN_MEMORY_MS,
  endGenerateRun,
  generateRunDecision,
  generateRunStopped,
  isGenerateRunning,
  mountGenerateRun,
  noteGenerateCount,
  noteGeneratePoll,
  resetGenerateRuns,
  startGenerateRun,
  unmountGenerateRun,
} from '../generate-run';
import { GENERATE_SETTLE_MS, GENERATE_STALL_MS, GENERATE_WINDOW_MS } from '../generate-poll';

/**
 * The writer run outlives the component that started it (bd startsim-ozpjw.9).
 *
 * WHAT THE COMPONENT CANNOT DO. `TopicDrafts` is mounted inside a drawer that is
 * torn down constantly: ReviewDrawer keys its inner drawer on the record id, so
 * j/k, the arrow keys, the prev/next chevrons AND the auto-advance after a
 * decision all remount it; "Edit fields" (e) swaps the whole body out; closing it
 * unmounts it outright. A ~2 minute writer run cannot live in that component's
 * `useState`, because none of those actions mean "stop watching".
 *
 * WHY IT DOESN'T HEAL ITSELF. QueryProvider sets `staleTime: 5 * 60 * 1000` and
 * `refetchOnWindowFocus: false`, so coming back inside five minutes serves the
 * CACHED EMPTY LIST without refetching — with nothing polling. Only a full page
 * reload recovers, which is exactly the "I refreshed and oh, there they are"
 * shape reported on 2026-08-25.
 *
 * There is no jsdom here (`environment: 'node'`, `.ts` only), so the component is
 * not rendered. It doesn't need to be: the lifecycle is modelled structurally —
 * a run STARTED for a topic, the instance watching it TORN DOWN, a new instance
 * MOUNTED later — over plain numbers, which is the whole of what has to survive.
 * The decision itself stays in `@/lib/generate-poll`; this is only about what
 * still exists to decide over.
 */

const T = 1_700_000_000_000;
const TOPIC = 'topic-42';

beforeEach(() => resetGenerateRuns());

describe('a run survives the drawer that started it', () => {
  it('is still polling after a remount 30s into the run', () => {
    // Click "Generate drafts", then press j. ReviewDrawerInner is keyed on the
    // record id, so the whole inner drawer — TopicDrafts with it — is destroyed
    // and rebuilt. Press k to come back 30s later: the writer has been running
    // the entire time and we are 30s into a ~113s job.
    startGenerateRun(TOPIC, { at: T, baseline: 0 });
    noteGeneratePoll(TOPIC, T + 8_000);
    unmountGenerateRun(TOPIC);

    mountGenerateRun(TOPIC, T + 30_000);

    expect(generateRunDecision(TOPIC, T + 30_000)).toEqual({
      keepPolling: true,
      terminal: false,
      reason: 'waiting',
    });
  });

  it('does not mistake a closed drawer for lost contact', () => {
    // Not polling because nobody was looking is not the same as polls failing.
    // The clock that matters is "how long since we could last see", and a rejoin
    // can see right now — so the stall window must be measured from the rejoin,
    // never from the last poll a dead component happened to make.
    startGenerateRun(TOPIC, { at: T, baseline: 0 });
    noteGeneratePoll(TOPIC, T + 5_000);
    unmountGenerateRun(TOPIC);

    const backAt = T + 2 * GENERATE_STALL_MS; // drawer shut for two full stall windows
    mountGenerateRun(TOPIC, backAt);

    expect(generateRunDecision(TOPIC, backAt).reason).toBe('waiting');
  });

  it('never drags the contact point backwards when a cached poll result arrives', () => {
    // On remount react-query hands over the CACHED list first, whose
    // `dataUpdatedAt` is from before the drawer closed. Feeding that straight in
    // would re-stale the contact point the rejoin just refreshed and trip
    // `lost_contact` one tick later.
    startGenerateRun(TOPIC, { at: T, baseline: 0 });
    noteGeneratePoll(TOPIC, T + 5_000);
    unmountGenerateRun(TOPIC);

    const backAt = T + 2 * GENERATE_STALL_MS;
    mountGenerateRun(TOPIC, backAt);
    noteGeneratePoll(TOPIC, T + 5_000); // the stale cached timestamp

    expect(generateRunDecision(TOPIC, backAt).reason).toBe('waiting');
  });

  it('picks up drafts that landed while the drawer was somewhere else', () => {
    // The candidates arrive one request at a time. If they land while the reader
    // is two rows down the queue, coming back must find a run that is still
    // watching them settle — not a finished-looking empty list.
    startGenerateRun(TOPIC, { at: T, baseline: 0 });
    unmountGenerateRun(TOPIC);

    const backAt = T + 100_000;
    mountGenerateRun(TOPIC, backAt);
    noteGenerateCount(TOPIC, 3, backAt);

    expect(generateRunDecision(TOPIC, backAt)).toEqual({
      keepPolling: true,
      terminal: false,
      reason: 'arriving',
    });
    expect(generateRunDecision(TOPIC, backAt + GENERATE_SETTLE_MS)).toEqual({
      keepPolling: false,
      terminal: true,
      reason: 'drafts_arrived',
    });
  });

  it('still caps the writer — the window is not restarted by coming back', () => {
    // The run outliving the component must not make the run immortal. The cap is
    // on the WRITER, measured from the click, and a remount is not new evidence
    // that it is alive.
    startGenerateRun(TOPIC, { at: T, baseline: 0 });
    unmountGenerateRun(TOPIC);

    const backAt = T + GENERATE_WINDOW_MS + 1_000;
    mountGenerateRun(TOPIC, backAt);

    expect(generateRunDecision(TOPIC, backAt)).toEqual({
      keepPolling: false,
      terminal: true,
      reason: 'no_response',
    });
  });
});

describe('a run belongs to one topic', () => {
  it('does not lend its poll to the next record in the queue', () => {
    // j lands on a topic nobody generated for. It must not inherit the poll, and
    // its empty list must not borrow the other topic's "waiting" copy.
    startGenerateRun(TOPIC, { at: T, baseline: 0 });
    unmountGenerateRun(TOPIC);

    mountGenerateRun('topic-43', T + 30_000);

    expect(isGenerateRunning('topic-43')).toBe(false);
    expect(generateRunDecision('topic-43', T + 30_000).keepPolling).toBe(false);
    expect(generateRunStopped('topic-43')).toBe('idle');
    expect(isGenerateRunning(TOPIC)).toBe(true);
  });
});

describe('a run that has ended stays ended', () => {
  it('does not restart on the next mount, and still says why it stopped', () => {
    startGenerateRun(TOPIC, { at: T, baseline: 0 });
    endGenerateRun(TOPIC, 'no_response');
    unmountGenerateRun(TOPIC);

    mountGenerateRun(TOPIC, T + 30_000);

    expect(isGenerateRunning(TOPIC)).toBe(false);
    expect(generateRunDecision(TOPIC, T + 30_000).keepPolling).toBe(false);
    // Coming back must not swallow the reason — a terminal state nobody renders
    // is the bug startsim-tkz9d fixed, and a remount must not undo it.
    expect(generateRunStopped(TOPIC)).toBe('no_response');
  });

  it('is eventually forgotten, so the store does not grow all session', () => {
    startGenerateRun(TOPIC, { at: T, baseline: 0 });
    endGenerateRun(TOPIC, 'no_response');

    // Any later run sweeps what has gone cold. The copy is worth keeping while
    // the reader might still come back to it, not for the rest of the session.
    startGenerateRun('topic-99', { at: T + GENERATE_RUN_MEMORY_MS + 1, baseline: 0 });

    expect(generateRunStopped(TOPIC)).toBe('idle');
    expect(isGenerateRunning('topic-99')).toBe(true);
  });
});
