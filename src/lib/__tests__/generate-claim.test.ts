/**
 * The server-side in-flight claim (bd startsim-8hgmq.8).
 *
 * The claim exists to stop a second writer inside the first one's ~100s
 * latency. What these tests are really about is the OTHER half of that promise
 * — that it cannot strand a topic — because a lock that jams is a new failure
 * mode on a live customer tenant and is the reason one was not shipped with the
 * gate fix. So: it expires on its own clock, it is given back the moment a relay
 * fails, and it is per topic.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  claimGenerateRun,
  GENERATE_CLAIM_TTL_MS,
  releaseGenerateClaim,
  resetGenerateClaims,
} from '../generate-claim';

const T0 = 1_757_284_000_000;

beforeEach(() => resetGenerateClaims());

describe('claimGenerateRun', () => {
  it('gives the claim to the first caller and refuses the second', () => {
    expect(claimGenerateRun('42', T0).claimed).toBe(true);
    expect(claimGenerateRun('42', T0 + 1_000).claimed).toBe(false);
  });

  it('reports how long the holder has held it, and when it lapses', () => {
    claimGenerateRun('42', T0);
    const lost = claimGenerateRun('42', T0 + 20_000);
    expect(lost.heldForMs).toBe(20_000);
    // The refusal is a WAIT, not a "no" — the caller can say how long.
    expect(lost.expiresInMs).toBe(GENERATE_CLAIM_TTL_MS - 20_000);
  });

  it('is per topic — one topic’s writer never blocks another’s', () => {
    expect(claimGenerateRun('42', T0).claimed).toBe(true);
    expect(claimGenerateRun('43', T0).claimed).toBe(true);
  });

  it('EXPIRES on its own, so a writer that died in n8n cannot strand the topic', () => {
    // The lockout risk, bounded. A claim whose webhook said yes and whose writer
    // then went silent is the one case nothing can release explicitly; the TTL
    // is the measured max run (130s), so the wait is seconds, not minutes.
    claimGenerateRun('42', T0);
    expect(claimGenerateRun('42', T0 + GENERATE_CLAIM_TTL_MS - 1).claimed).toBe(false);
    expect(claimGenerateRun('42', T0 + GENERATE_CLAIM_TTL_MS).claimed).toBe(true);
  });

  it('is matched to the writer latency it models, not to a round number', () => {
    // 130s is the max observed run (generate-poll's own window). A claim that
    // outlived its writer by minutes would be the lock this deliberately isn't.
    expect(GENERATE_CLAIM_TTL_MS).toBe(130_000);
  });

  it('re-arms from the NEW claim, not from the expired one', () => {
    claimGenerateRun('42', T0);
    claimGenerateRun('42', T0 + GENERATE_CLAIM_TTL_MS);
    expect(claimGenerateRun('42', T0 + GENERATE_CLAIM_TTL_MS + 1).claimed).toBe(false);
  });
});

describe('releaseGenerateClaim', () => {
  it('hands the topic straight back — the writer never started', () => {
    claimGenerateRun('42', T0);
    releaseGenerateClaim('42');
    expect(claimGenerateRun('42', T0 + 1).claimed).toBe(true);
  });

  it('releases only the topic named', () => {
    claimGenerateRun('42', T0);
    claimGenerateRun('43', T0);
    releaseGenerateClaim('42');
    expect(claimGenerateRun('43', T0 + 1).claimed).toBe(false);
  });

  it('is a no-op for a topic that holds nothing', () => {
    expect(() => releaseGenerateClaim('nope')).not.toThrow();
  });
});
