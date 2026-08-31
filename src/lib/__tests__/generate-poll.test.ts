import { describe, it, expect } from 'vitest';
import {
  GENERATE_POLL_MS,
  GENERATE_SETTLE_MS,
  GENERATE_TICK_MS,
  GENERATE_WINDOW_MS,
  generatePollDecision,
  generatePollMessage,
  type GeneratePollState,
} from '../generate-poll';

/**
 * MEASURED, not guessed (bd startsim-tkz9d). Every retained execution of the n8n
 * workflow "OGMC — Weekly Insight Writer" (ornNNyf2MXl0qtEM) at the time of writing —
 * 11 runs, 2026-08-25 → 2026-08-31, all status=success:
 *
 *   97.9s 100.2s 103.3s 104.0s 112.5s 113.3s 113.3s 115.3s 117.7s 118.8s 130.0s
 *   min 97.9s · p50 113.3s · p90 118.8s · p95 124.4s · max 130.0s
 *
 * 0 of 11 finished inside the shipped 90s window. The FASTEST run is already 9%
 * past it, so the poll stopped before the drafts landed on every single run.
 */
const WRITER_FASTEST_MS = 97_876;
const WRITER_P50_MS = 113_315;
const WRITER_P95_MS = 124_400;
const WRITER_SLOWEST_MS = 130_024;

/** The button is only enabled on a topic with zero drafts (`canGenerateDrafts`). */
function waiting(over: Partial<GeneratePollState> = {}): GeneratePollState {
  return {
    generating: true,
    elapsedMs: 0,
    draftCount: 0,
    baselineCount: 0,
    sinceCountChangeMs: 0,
    sinceSuccessfulPollMs: 0,
    ...over,
  };
}

describe('generatePollDecision — the window must outlast the writer', () => {
  it('is still polling at every measured writer duration', () => {
    // The whole defect in one assertion: a run that takes as long as the real
    // writer takes must still be watched when its drafts land.
    for (const ms of [WRITER_FASTEST_MS, WRITER_P50_MS, WRITER_P95_MS, WRITER_SLOWEST_MS]) {
      const d = generatePollDecision(waiting({ elapsedMs: ms }));
      expect({ ms, keepPolling: d.keepPolling }).toEqual({ ms, keepPolling: true });
    }
  });

  it('sees a draft that lands at the p50 duration', () => {
    // Malin's case: click, wait ~113s, three candidates land. The page must be
    // looking. Under the shipped 90s cap it has already stopped.
    const stillWatching = generatePollDecision(waiting({ elapsedMs: WRITER_P50_MS }));
    expect(stillWatching.keepPolling).toBe(true);

    const landed = generatePollDecision(
      waiting({ elapsedMs: WRITER_P50_MS + GENERATE_POLL_MS, draftCount: 3, sinceCountChangeMs: 0 }),
    );
    expect(landed.reason).toBe('arriving');
  });

  it('gives the window real headroom over the measured p95', () => {
    // Not a round number for its own sake: the p95 is a p95 of SUCCESSES ONLY,
    // and every retained run is mode=integrated (a sub-workflow call), so the
    // user-perceived latency is at least this. 124.4s is a lower bound.
    expect(GENERATE_WINDOW_MS).toBeGreaterThan(WRITER_SLOWEST_MS * 2);
  });
});

describe('generatePollDecision — a partial set keeps the poll alive', () => {
  it('keeps polling while candidates are still arriving', () => {
    // The writer builds 3 candidates and upserts them one request at a time, so
    // a poll can land between the first and the third. Stopping at the first
    // strands the other two behind a manual Refresh.
    const d = generatePollDecision(
      waiting({ elapsedMs: WRITER_P50_MS, draftCount: 1, sinceCountChangeMs: 2_000 }),
    );
    expect(d).toEqual({ keepPolling: true, terminal: false, reason: 'arriving' });
  });

  it('settles once the count stops growing', () => {
    const d = generatePollDecision(
      waiting({ elapsedMs: WRITER_P50_MS + 20_000, draftCount: 3, sinceCountChangeMs: 20_000 }),
    );
    expect(d).toEqual({ keepPolling: false, terminal: true, reason: 'drafts_arrived' });
  });
});

describe('generatePollDecision — a silent writer terminates VISIBLY', () => {
  it('reports that the writer never came back, rather than going quiet', () => {
    // This is what the cap was for, and the half that was missing: it stopped
    // looking without ever saying so, and the empty list then read as the
    // ordinary "No drafts written for this topic yet."
    const d = generatePollDecision(waiting({ elapsedMs: GENERATE_WINDOW_MS }));
    expect(d.terminal).toBe(true);
    expect(d.keepPolling).toBe(false);
    expect(d.reason).toBe('no_response');
    expect(generatePollMessage(d.reason)).toMatch(/writer/i);
  });

  it('distinguishes losing contact from the writer being slow', () => {
    // Polls themselves failing is a different story from a slow run, and the
    // person watching should not be told the writer is still working.
    const d = generatePollDecision(waiting({ elapsedMs: 40_000, sinceSuccessfulPollMs: 90_000 }));
    expect(d).toEqual({ keepPolling: false, terminal: true, reason: 'lost_contact' });
    expect(generatePollMessage('lost_contact')).toBeTruthy();
  });

  it('does not cry timeout when drafts are in hand', () => {
    const d = generatePollDecision(
      waiting({ elapsedMs: GENERATE_WINDOW_MS + 1, draftCount: 3, sinceCountChangeMs: 0 }),
    );
    expect(d.reason).toBe('drafts_arrived');
  });
});

describe('the constants hold together', () => {
  it('re-asks often enough to notice the boundaries it is asked about', () => {
    // The drawer re-evaluates on a tick, not on poll results, so the tick has to
    // be small against the things it is watching for — otherwise "we stopped
    // looking" lands long after the window it is meant to enforce.
    expect(GENERATE_TICK_MS).toBeLessThan(GENERATE_POLL_MS);
    expect(GENERATE_TICK_MS).toBeLessThan(GENERATE_SETTLE_MS);
    expect(GENERATE_TICK_MS * 10).toBeLessThan(GENERATE_WINDOW_MS);
  });

  it('gives a partial set at least two polls to finish arriving', () => {
    expect(GENERATE_SETTLE_MS).toBeGreaterThanOrEqual(2 * GENERATE_POLL_MS);
  });
});

describe('generatePollDecision — the idle case', () => {
  it('does not poll before the button is pressed', () => {
    const d = generatePollDecision(waiting({ generating: false }));
    expect(d).toEqual({ keepPolling: false, terminal: false, reason: 'idle' });
    expect(generatePollMessage('idle')).toBeNull();
  });

  it('says the writer is running while we wait', () => {
    expect(generatePollDecision(waiting({ elapsedMs: 8_000 })).reason).toBe('waiting');
    expect(generatePollMessage('waiting')).toBeTruthy();
  });
});
