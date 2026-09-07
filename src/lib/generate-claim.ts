/**
 * The writer's in-flight claim, held SERVER-side (bd startsim-8hgmq.8).
 *
 * WHAT IT CLOSES. `/actions/generate-drafts` re-checks the same gate the drawer
 * checks, and one arm of that gate is "this topic already has drafts". It
 * cannot see a topic whose drafts do not exist YET: the n8n webhook answers
 * "Workflow got started" immediately while the writer takes ~100s (measured p50
 * 113s, max 130s — see `./generate-poll`), so two presses inside that window
 * both read `draftCount: 0` and both are relayed. On 2026-09-07 that put six
 * near-duplicate drafts in the reviewer's queue and three had to be deleted by
 * hand.
 *
 * NOT THE SAME STORE AS `./generate-run`, and the difference is the point. That
 * one is the BROWSER's: it survives the drawer being torn down by j/k, "Edit
 * fields" and Close, and `startGenerateRunOnce` already makes "one run per
 * topic" a property of it. But it is module-level in the TAB — a reload, or a
 * second tab, has no memory of the run in flight, which is exactly the press
 * this store catches. Neither replaces the other: the client claim stops the
 * double-click, this one stops the second tab.
 *
 * WHY A TTL LOCK IS SAFE HERE, WHEN THE OBVIOUS ONE IS NOT. A lock that strands
 * a topic is a new failure mode on a live customer tenant, and that risk is why
 * one was deliberately not shipped with the gate fix. Three properties buy it
 * back, and all three have to hold:
 *
 *   1. THE TTL IS THE MEASURED LATENCY, not a round number. 130s is the max
 *      observed writer run, the same bound `GENERATE_WINDOW_MS` gives the
 *      client's own wait. A claim can therefore outlive its writer by seconds,
 *      never by minutes.
 *   2. EVERY FAILURE THIS ROUTE CAN SEE GIVES THE CLAIM BACK. A webhook that
 *      refuses, or one that cannot be reached, means the writer never started —
 *      so `releaseGenerateClaim` runs and the next press is free immediately.
 *      The only claim that runs its full TTL is one whose webhook said yes.
 *   3. THE ONLY PRESS IT CAN WRONGLY REFUSE IS BOUNDED AND EXPLAINED. Inside
 *      130s of a successful relay for the same topic, a second press is either
 *      the duplicate this exists to stop, or a retry after the writer died
 *      silently in n8n — and that retry waits at most 130s, having been told a
 *      run is under way, rather than being told "no".
 *
 * BEST-EFFORT, SAID OUT LOUD. The store is module-level in a long-lived Next
 * server on ECS, so it is per TASK: with more than one task, two presses routed
 * to different tasks are not compared. It can therefore MISS a duplicate; it
 * cannot invent one. That asymmetry is what makes it safe to ship in front of
 * the durable seam, which is and remains the tenant backend refusing to create
 * a second candidate set for a topic that already has one.
 */

/**
 * How long a claim is honoured. The measured maximum writer run (`generate-poll`
 * caps the client's own wait at the same number), so a claim outlives its writer
 * by seconds at worst.
 */
export const GENERATE_CLAIM_TTL_MS = 130_000;

/** When each topic's in-flight writer was relayed, keyed by `topic_ref`. */
const claims = new Map<string, number>();

/** Drop claims whose TTL has run out — an expired claim refuses nobody. */
function sweep(now: number) {
  for (const [ref, at] of claims) {
    if (now - at >= GENERATE_CLAIM_TTL_MS) claims.delete(ref);
  }
}

export interface GenerateClaim {
  /** True when this caller may relay the writer. */
  claimed: boolean;
  /** How long the CURRENT claim has been held, when this caller lost the race. */
  heldForMs?: number;
  /** How long until that claim expires, when this caller lost the race. */
  expiresInMs?: number;
}

/**
 * Claim the writer for one topic, or report that a run is already in flight.
 *
 * TEST-AND-SET, not check-then-set at the call site: the claim IS the lock, so
 * every caller races against the same entry rather than against its own reading
 * of one. `now` is passed in rather than read here so the expiry is testable
 * without clock games.
 */
export function claimGenerateRun(topicRef: string, now: number): GenerateClaim {
  sweep(now);
  const held = claims.get(topicRef);
  if (held !== undefined) {
    return {
      claimed: false,
      heldForMs: now - held,
      expiresInMs: GENERATE_CLAIM_TTL_MS - (now - held),
    };
  }
  claims.set(topicRef, now);
  return { claimed: true };
}

/**
 * Give the claim back — the writer never started.
 *
 * Called on every failure the route can see. Anything it cannot see (a webhook
 * that accepted and then died inside n8n) is what the TTL is for.
 */
export function releaseGenerateClaim(topicRef: string) {
  claims.delete(topicRef);
}

/** Test hook — the store is module-level, so a test must be able to clear it. */
export function resetGenerateClaims() {
  claims.clear();
}
