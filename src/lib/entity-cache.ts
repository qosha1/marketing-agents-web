/**
 * One spelling of the single-entity query key, and one way to write an entity.
 *
 * WHY THIS EXISTS (bd startsim-ug09d / startsim-mk5qp — Malin: "Changes in drafts
 * are not saved despite of pressing save button. When you open the same draft
 * again, changes are gone.").
 *
 * The write was never the problem. Measured on the live tenant 2026-09-07: the
 * PATCH returns 200, the editor's pill reads "Saved", and the edited text is in
 * the row's `data` JSONB under `blog` — all snake_case, not one camelCase
 * duplicate anywhere in 153 draft rows. Then a soft-nav round trip (Next draft ->
 * Previous draft) INSIDE five minutes puts the pre-edit text back on the screen,
 * and a hard reload of the same URL brings the edit back. Only the client cache
 * sits between those two reads.
 *
 * QueryProvider (@startsimpli/ui) defaults every query to `staleTime: 5 * 60 *
 * 1000` with `refetchOnWindowFocus: false`. Every writer here used to `await
 * updateEntity(...)` and THROW THE RESPONSE AWAY, so `['entity', <id>]` still
 * held the blob fetched before the edit. A remount inside that window gets it
 * synchronously, and the draft page seeds `useState(() => draftSections(draft))`
 * from exactly that object.
 *
 * AND IT IS WORSE THAN A STALE VIEW. `mergedData()` on the draft page spreads
 * `...draft.data`, so the NEXT save on the reopened page PATCHes the stale text
 * back over the good row. The edit isn't only invisible — a second save destroys
 * it. Same for anything else that merges over a cached blob.
 *
 * INVALIDATION IS NOT ENOUGH, WHICH IS THE WHOLE POINT. `invalidateQueries` only
 * marks the query stale: `useQuery` still hands the OLD blob to the first render
 * and refetches behind it, and by the time the refetch lands the page has already
 * seeded its section state — `key={draftQuery.data.id}` is unchanged, so it never
 * re-seeds. The cache has to be RIGHT at first render. `updateEntity` already
 * returns the saved record, so the correct blob costs nothing: keep it.
 */
import type { QueryClient } from '@tanstack/react-query';

import { updateEntity, type EntityRecord } from './foundry-api';

/**
 * The react-query key for ONE entity. Ids arrive as UUID strings from the route
 * and from the blob (`topic_ref`, `revised_from`) but are typed `number` on
 * EntityRecord, so normalize — a writer keyed by the raw value and a reader keyed
 * by `String(...)` would silently address two different cache entries.
 */
export function entityKey(id: number | string): readonly [string, string] {
  return ['entity', String(id)];
}

/**
 * PATCH an entity and hand back what the server saved.
 *
 * NOTE: the backend REPLACES the whole `data` blob (no deep merge), so callers
 * still send the FULL merged blob — see {@link updateEntity}.
 */
export async function saveEntity(
  qc: QueryClient,
  id: number | string,
  input: { name?: string; data?: Record<string, unknown> },
): Promise<EntityRecord> {
  const saved = await updateEntity(id, input);
  primeEntity(qc, id, saved);
  return saved;
}

/**
 * Put a known-good record into the single-entity cache.
 *
 * `setQueryData`, not `invalidateQueries`: invalidation leaves the STALE VALUE in
 * place for the next first render and only schedules a refetch behind it — which
 * is precisely the frame the draft page seeds its section state from. Writing the
 * value makes the entry both correct AND fresh, so the reopen needs no round trip
 * at all.
 *
 * Split out so a writer that already holds the server's answer (a caller of
 * `updateEntity` that needs the raw response first, or a list refresh) can prime
 * the same key without a second PATCH.
 */
export function primeEntity(qc: QueryClient, id: number | string, record: EntityRecord): void {
  qc.setQueryData(entityKey(id), record);
}
