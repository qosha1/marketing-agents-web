/**
 * Reads for the v2 Content pages. Thin: the narrowing and ordering live in
 * lib/content-list.ts and lib/content-calendar.ts and are sent to the server.
 */
import { readData } from '@/lib/board';
import { listAllEntities, listEntities, type EntityFilters, type EntityRecord } from '@/lib/foundry-api';

export const DRAFT = 'draft';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function fetchContentPage(filters: EntityFilters, page: number) {
  return listEntities(DRAFT, page, filters);
}

/** The markets of the topics a page of drafts was written for: one batched read. */
export async function fetchTopicMarkets(drafts: EntityRecord[]): Promise<Record<string, { market?: string }>> {
  // The server rejects the WHOLE read when any id in id__in is not a UUID, so a
  // stray ref would blank the list. Send only UUID-shaped ids; the Market of a
  // draft whose topic is unknown is simply blank. A refused lookup never
  // hides the drafts either.
  const ids = [
    ...new Set(
      drafts.map((d) => String(readData(d.data, 'topic_ref') ?? '')).filter((id) => UUID.test(id)),
    ),
  ];
  if (ids.length === 0) return {};
  const out: Record<string, { market?: string }> = {};
  try {
    const res = await listEntities('topic', 1, { id__in: ids.join(','), page_size: String(Math.min(ids.length, 200)) });
    for (const t of res.results ?? []) out[String(t.id)] = { market: String(readData(t.data, 'market') ?? '') };
  } catch {
    return {};
  }
  return out;
}

export function fetchMonth(filters: EntityFilters) {
  return listAllEntities(DRAFT, { filters });
}

/** Posted items of a month. Best effort: a tenant that refuses the filter just shows none. */
export async function fetchPosted(filters: EntityFilters): Promise<EntityRecord[]> {
  try {
    return await listAllEntities(DRAFT, { filters });
  } catch {
    return [];
  }
}
