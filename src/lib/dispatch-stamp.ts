/**
 * "A writer was relayed for this topic just now" — the one fact the n8n poll
 * cannot work out for itself (bd startsim-m7fdm.19, constraint 4).
 *
 * THE RACE, EXACTLY. `OGMC — Auto-write Ready Topics (poll)` reads every topic
 * and every draft, then picks `status === 'ready'` topics for which no draft
 * carries their `topic_ref`. That dedup is correct and it is also BLIND for the
 * length of a writer run: the webhook answers "Workflow got started" at once and
 * the drafts appear ~100s later (measured p50 113s, max 130s — see
 * `./generate-poll`). A dispatch from this app plus a poll tick inside that
 * window are two runs for one topic, which is how the "one topic with nine
 * drafts" row in bd startsim-nlpp4 happened.
 *
 * WHY A STAMP AND NOT THE RECORD'S OWN `updated_at`, which would need no write
 * at all. `updated_at` moves when the TOPIC changes, and the highest-collision
 * dispatch does not change the topic: the manual "Generate drafts" button writes
 * nothing to the record. And a retry is precisely a `ready` topic with no draft,
 * i.e. the exact state the poll selects on — so the press most likely to collide
 * is the one `updated_at` is structurally unable to see. This route is the single
 * chokepoint BOTH app-side dispatchers pass through, so a stamp written there
 * covers the button and the approval with one mechanism. That is the whole
 * argument for paying a write.
 *
 * WHY IT EXPIRES, AND WHY THAT IS THE ANSWER TO "WHAT IF THE WRITER NEVER
 * FINISHES". A stamp that never aged would strand a topic: a writer that died
 * silently in n8n leaves `ready`, no draft, and a stamp saying somebody is on it
 * — forever, with the 6-hourly safety net standing down for good. So the stamp
 * is a WINDOW, not a flag. Past {@link DISPATCH_STAMP_TTL_MS} it says nothing and
 * the poll's own "ready and no draft" test is authoritative again, which is
 * exactly the pre-existing behaviour this is not allowed to break (constraint 3).
 * There is no state in which a topic reads as permanently dispatched with nothing
 * to show.
 *
 * THE TTL IS `GENERATE_WINDOW_MS`, NOT A SECOND NUMBER. 360s is already this
 * app's answer to "could the writer still be working?" — it is how long
 * `TopicDrafts` keeps polling before it tells the reviewer the writer went quiet,
 * and it is ~2.8x the measured max run for the headroom reasons `generate-poll.ts`
 * sets out. The asymmetry argues for the generous end either way: too tight costs
 * a duplicate draft in a customer's queue, too generous costs the safety net one
 * tick, and the tick interval is six hours — so six minutes of extra patience is
 * noise against the thing it is being traded for.
 *
 * NOTHING IN THIS APP REFUSES A DISPATCH ON THIS STAMP, deliberately. The app's
 * own double-dispatch is already closed twice over — `./generate-run` holds one
 * run per topic in the tab, `./generate-claim` holds one in the server task — and
 * both release on a failure the route can see. Gating the route on a DURABLE
 * stamp would instead refuse the retry path for six minutes after a writer died,
 * which is the one path constraint 7 says must keep working. So this is written
 * for the poll to read and kept out of the gate.
 *
 * THE POLL'S HALF IS NOT IN THIS REPO. `Pick Unwritten Ready` reads the whole
 * data blob in JS through a camel-or-snake-tolerant helper and never sends an
 * `?attr.` filter, so honouring this costs one `continue` there and needs no
 * schema declaration and no `redenormalize_attributes`. Until that line exists
 * the stamp is a record of what happened and the race is unchanged — see the
 * bead.
 */
import { readData } from '@/lib/board';
import type { EntityRecord } from '@/lib/foundry-api';
import { GENERATE_WINDOW_MS } from '@/lib/generate-poll';

/**
 * The data-blob key naming when a writer was last relayed for this topic, ISO
 * 8601 UTC.
 *
 * UNDERSCORE-PREFIXED, like `_origin` / `_trigger` / `_edit_history`: that prefix
 * is this tenant's convention for machine metadata that rides inside the blob
 * rather than a field a reviewer fills in, and it keeps the key out of every
 * surface that renders DECLARED attributes. It is deliberately NOT declared on
 * the topic type — see the header: the poll reads the blob, so declaring it would
 * buy nothing and a filter over an undeclared attribute is the trap that emptied
 * the Drafts tab in bd startsim-8hgmq.4.
 *
 * ISO RATHER THAN AN EPOCH NUMBER because the only other reader is n8n JS, where
 * `Date.parse` handles this and a bare number invites a seconds/milliseconds
 * mistake nobody would see until it produced a duplicate.
 */
export const DISPATCH_STAMP_ATTR = '_drafts_dispatched_at';

/** How long a stamp is honoured. See the header for why it is this number. */
export const DISPATCH_STAMP_TTL_MS = GENERATE_WINDOW_MS;

/**
 * When a writer was last relayed for this topic, in ms since the epoch, or null.
 *
 * Reads through `readData` so it works on both sides of the shared client's
 * snake→camel transform (the blob stores `_drafts_dispatched_at`; the browser
 * client hands it back as `DraftsDispatchedAt`). An unparseable or non-string
 * value is ABSENCE, never 0 — a stamp nobody can read must not become a stamp
 * from 1970, which would read as expired and is at least the safe direction, but
 * only by accident.
 */
export function dispatchStampedAt(data: EntityRecord['data'] | undefined): number | null {
  const raw = readData(data, DISPATCH_STAMP_ATTR);
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const at = Date.parse(raw.trim());
  return Number.isFinite(at) ? at : null;
}

/**
 * Could a writer relayed for this topic still be running?
 *
 * `now` is a parameter so the window is testable without clock games, the same
 * shape `claimGenerateRun` takes. A stamp from the FUTURE counts as in flight:
 * clock skew between this app and whatever wrote the stamp is not a reason to
 * fire a second writer, and the window closes on its own either way.
 */
export function dispatchInFlight(
  data: EntityRecord['data'] | undefined,
  now: number,
): boolean {
  const at = dispatchStampedAt(data);
  if (at == null) return false;
  return now - at < DISPATCH_STAMP_TTL_MS;
}

/**
 * The `data` blob to PATCH for a relay that just happened.
 *
 * READ-MODIFY-WRITE, because the tenant's PATCH REPLACES the blob (see
 * `foundry-api.ts`): a body carrying only this key would delete the topic. The
 * caller passes the blob it already read to gate the press, so this adds no
 * request — and it is a pure function so the one thing that matters about it (it
 * keeps everything else) is proved rather than reviewed.
 */
export function withDispatchStamp(
  data: EntityRecord['data'] | undefined,
  at: number,
): Record<string, unknown> {
  return { ...(data ?? {}), [DISPATCH_STAMP_ATTR]: new Date(at).toISOString() };
}

/**
 * The key the relay answers the topic's NEW version under, and how to read it.
 *
 * WHY THE RELAY HAS TO SAY THIS AT ALL (bd startsim-jkkn7.13, bd startsim-j19hf).
 * The stamp above is a WRITE to the topic, and every write allocates a new
 * `version` server-side. It is issued by this route, server-side, through
 * `tenant-fetch` — which the browser's version registry (`lib/record-version.ts`)
 * cannot see. So without this field the browser goes on asserting the version it
 * held BEFORE the stamp, and the next conditional write to that topic is refused
 * with a 412 that describes no conflict: nobody else touched the row, the
 * reviewer's own approval did.
 *
 * AND THE PATH IT BREAKS IS THE ONE THIS BEAD BUILDS. Approve stamps the topic;
 * `primeEntity` writes the approve response into `['entity', <topicId>]`, which
 * `QueryProvider` keeps FRESH for five minutes with `refetchOnWindowFocus: false`;
 * the story page and then the draft page both read the topic under that same key
 * and so never refetch it; and `/draft/<id>` Accept asserts the registry's
 * version when it moves the topic to `written`. A reviewer who accepts within
 * five minutes of approving — which is the whole point of writing the draft
 * immediately — would get the draft approved and the topic refused. Measured
 * from the code, not hypothesised: five minutes is `QueryProvider`'s staleTime
 * and the writer takes ~113s.
 *
 * SO THE WRITE REPORTS ITS OWN RESULT, which is the same rule `updateEntity`
 * already follows ("the response is the freshest version that exists, and it is
 * what guards the NEXT save"). The alternative — forgetting the held version so
 * the write goes unguarded — trades a wrong refusal for a lost guard, and the
 * guard is the thing j19hf was for.
 *
 * ABSENT MEANS "NOTHING MOVED", and that is why it is optional rather than
 * defaulted. The route omits it when the relay never happened (a refusal, or a
 * deduped press) and when the stamp PATCH FAILED — and a failed stamp left the
 * version where the browser already thinks it is, so remembering nothing is
 * exactly right.
 */
export const DISPATCH_TOPIC_VERSION_KEY = 'topic_version';

/**
 * The topic version a relay reported, or `undefined` for "it did not say".
 *
 * A non-integer is ABSENCE rather than a guess: a bad value remembered as a
 * version would produce the same silent 412 this exists to remove, and an
 * unguarded write is the documented fallback for an unknown version.
 */
export function relayedTopicVersion(body: unknown): number | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const raw = (body as Record<string, unknown>)[DISPATCH_TOPIC_VERSION_KEY];
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : undefined;
}
