import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

import { entityKey, saveEntity } from '../entity-cache';
import type { EntityRecord } from '../foundry-api';

/**
 * The READ path after a save (bd startsim-ug09d RED / startsim-mk5qp GREEN).
 *
 * Malin, 2026-09-07: "Changes in drafts are not saved despite of pressing save
 * button. When you open the same draft again, changes are gone."
 *
 * THE WRITE WAS FINE. Reproduced against the live tenant: PATCH 200, pill reads
 * "Saved", and the edited text is in the row's `data` JSONB under `blog` — every
 * key snake_case, no camelCase twin, across all 153 draft rows. A hard reload of
 * the same URL shows the edit. A SOFT-nav round trip inside five minutes does
 * not. So the defect is on the read path and nowhere else.
 *
 * WHY THIS TEST IS SHAPED LIKE THIS. A test over the write path would pass
 * against the broken code — the write path is not broken. So this test drives a
 * REAL QueryClient carrying QueryProvider's PRODUCTION defaults (staleTime five
 * minutes, no refetch on focus) across two "mounts", and asserts on what the
 * SECOND mount reads. `getQueryData` is not an implementation detail here: it is
 * literally the value `useQuery` hands the first render of a soft-nav remount,
 * and the draft page seeds `useState(() => draftSections(draft))` from that
 * object before any refetch can resolve.
 *
 * That shape is also why `invalidateQueries` cannot satisfy it: invalidation
 * marks the entry stale but leaves the stale VALUE in place for that first
 * render, and the page never re-seeds afterwards.
 */

const DRAFT_ID = '11824c6f-dd93-4ccc-b5c6-9fb9a49454e3';

/** QueryProvider's defaults, verbatim (@startsimpli/ui query-provider.tsx). */
const PRODUCTION_DEFAULTS = {
  queries: { staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false },
};

// A stand-in tenant backend. PATCH REPLACES `data` (it does not deep-merge),
// exactly like /api/v1/entities/<id>/, and returns the saved row — the response
// the app used to throw away.
const backend = vi.hoisted(() => {
  const rows = new Map<string, Record<string, unknown>>();
  const calls = { get: 0, patch: 0 };
  return { rows, calls };
});

vi.mock('../foundry-api', () => ({
  getEntity: async (id: number | string) => {
    backend.calls.get += 1;
    return structuredClone(backend.rows.get(String(id)));
  },
  updateEntity: async (
    id: number | string,
    input: { name?: string; data?: Record<string, unknown> },
  ) => {
    backend.calls.patch += 1;
    const row = { ...backend.rows.get(String(id)) };
    if (input.name !== undefined) row.name = input.name;
    if (input.data !== undefined) row.data = structuredClone(input.data);
    backend.rows.set(String(id), row);
    return structuredClone(row);
  },
}));

// Imported AFTER the mock so it resolves to the stand-in.
const { getEntity } = await import('../foundry-api');

function seedBackend(data: Record<string, unknown>) {
  backend.rows.clear();
  backend.calls.get = 0;
  backend.calls.patch = 0;
  backend.rows.set(DRAFT_ID, {
    id: DRAFT_ID,
    entityType: 'draft',
    externalId: null,
    name: 'Saudi licence growth reinforces Gulf competition',
    data,
    createdAt: '2026-09-01T00:00:00Z',
  });
}

/** What the page does on mount: useQuery(['entity', draftId]). */
function mount(qc: QueryClient) {
  return qc.fetchQuery({
    queryKey: entityKey(DRAFT_ID),
    queryFn: () => getEntity(DRAFT_ID) as Promise<EntityRecord>,
  });
}

/** What a soft-nav REMOUNT's first render sees, before any refetch resolves. */
function firstRenderOnRemount(qc: QueryClient): EntityRecord | undefined {
  return qc.getQueryData<EntityRecord>(entityKey(DRAFT_ID));
}

const blogOf = (r: EntityRecord | undefined) => String((r?.data as Record<string, unknown>)?.blog);

describe('reopening a draft inside the five-minute stale window', () => {
  it('reads back the edit that was saved, not the blob fetched before it', async () => {
    seedBackend({ blog: 'original body', linkedin: 'li', status: 'ready_for_review' });
    const qc = new QueryClient({ defaultOptions: PRODUCTION_DEFAULTS });

    const onOpen = await mount(qc);
    expect(blogOf(onOpen)).toBe('original body');

    // The blog card's onSave -> save() -> the full merged blob.
    await saveEntity(qc, DRAFT_ID, {
      data: { ...(onOpen.data as Record<string, unknown>), blog: 'edited body' },
    });

    // Navigate away and back INSIDE five minutes. Nothing refetches: the entry is
    // still inside staleTime, and refetchOnWindowFocus is off.
    expect(blogOf(firstRenderOnRemount(qc))).toBe('edited body');
  });

  it('does not PATCH the pre-edit blob back on the next save', async () => {
    // The half that loses data for real: mergedData() spreads `...draft.data`, so
    // a save made over a STALE cached blob overwrites the good row with old text.
    seedBackend({ blog: 'original body', linkedin: 'li', status: 'ready_for_review' });
    const qc = new QueryClient({ defaultOptions: PRODUCTION_DEFAULTS });

    const onOpen = await mount(qc);
    await saveEntity(qc, DRAFT_ID, {
      data: { ...(onOpen.data as Record<string, unknown>), blog: 'edited body' },
    });

    // Reopened page; the reviewer now edits a DIFFERENT field and saves again.
    const reopened = firstRenderOnRemount(qc)!;
    await saveEntity(qc, DRAFT_ID, {
      data: { ...(reopened.data as Record<string, unknown>), linkedin: 'li v2' },
    });

    const stored = backend.rows.get(DRAFT_ID)!.data as Record<string, unknown>;
    expect(stored.linkedin).toBe('li v2');
    expect(stored.blog).toBe('edited body');
  });

  it('keeps the entity fresh, so the reopen costs no extra round trip', async () => {
    seedBackend({ blog: 'original body' });
    const qc = new QueryClient({ defaultOptions: PRODUCTION_DEFAULTS });

    const onOpen = await mount(qc);
    await saveEntity(qc, DRAFT_ID, {
      data: { ...(onOpen.data as Record<string, unknown>), blog: 'edited body' },
    });
    await mount(qc);

    // One GET for the first open, and none for the reopen — the PATCH response is
    // the freshest copy there is, so re-asking the server buys nothing.
    expect(backend.calls.get).toBe(1);
    expect(blogOf(firstRenderOnRemount(qc))).toBe('edited body');
  });

  it('also primes the key the "Edit fields" drawer writes through', async () => {
    // entity-detail-drawer's RecordEditFields sends name + the full blob; it used
    // to invalidate ['entities', <type>] and leave ['entity', <id>] untouched, so
    // opening /draft/<id> right after editing fields showed the old values.
    seedBackend({ blog: 'original body', status: 'ready_for_review' });
    const qc = new QueryClient({ defaultOptions: PRODUCTION_DEFAULTS });

    const onOpen = await mount(qc);
    await saveEntity(qc, DRAFT_ID, {
      name: 'Renamed by the reviewer',
      data: { ...(onOpen.data as Record<string, unknown>), status: 'approved' },
    });

    const reopened = firstRenderOnRemount(qc)!;
    expect(reopened.name).toBe('Renamed by the reviewer');
    expect((reopened.data as Record<string, unknown>).status).toBe('approved');
  });
});

describe('entityKey', () => {
  it('normalizes the id so a writer and a reader address one cache entry', () => {
    // EntityRecord types `id` as number; the route param and the blob refs
    // (`topic_ref`, `revised_from`) are UUID strings. Both must hash the same.
    expect(entityKey(DRAFT_ID)).toEqual(['entity', DRAFT_ID]);
    expect(entityKey(42)).toEqual(['entity', '42']);
  });
});
