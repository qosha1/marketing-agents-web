/**
 * Reads for the v2 Content pages. Thin: the narrowing and ordering live in
 * lib/content-list.ts and lib/content-calendar.ts and are sent to the server.
 */
import { readData } from '@/lib/board';
import { listAllEntities, listEntities, type EntityFilters, type EntityRecord } from '@/lib/foundry-api';

export const DRAFT = 'draft';

export async function fetchContentPage(filters: EntityFilters, page: number) {
  return listEntities(DRAFT, page, filters);
}

/** The markets of the topics a page of drafts was written for: one batched read. */
export async function fetchTopicMarkets(drafts: EntityRecord[]): Promise<Record<string, { market?: string }>> {
  const ids = [
    ...new Set(drafts.map((d) => String(readData(d.data, 'topic_ref') ?? '')).filter(Boolean)),
  ];
  if (ids.length === 0) return {};
  const res = await listEntities('topic', 1, { id__in: ids.join(','), page_size: String(Math.min(ids.length, 200)) });
  const out: Record<string, { market?: string }> = {};
  for (const t of res.results ?? []) out[String(t.id)] = { market: String(readData(t.data, 'market') ?? '') };
  return out;
}

export function fetchMonth(filters: EntityFilters) {
  return listAllEntities(DRAFT, { filters });
}
