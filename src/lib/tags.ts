/**
 * Generic "tag toggle" helpers (startsim-iegx) — any entity type, not just
 * topic. Pure lookup over a Tag list so it's unit-tested without a backend; the
 * drawer component just fetches (there's no server-side `?entity=` filter yet,
 * see foundry-api.ts's listAllTags) and calls this to find the record's own tag.
 */
import type { TagRecord } from './foundry-api';

/** The label the "Mark as good example" toggle reads/writes. */
export const GOOD_EXAMPLE_LABEL = 'good_example';

/**
 * The tag row (if any) marking `entityId` with `label`. Its presence/absence IS
 * the toggle state: absent means "not tagged yet" (POST to add), present carries
 * the tag's own id (needed to DELETE it — the endpoint has no upsert-by-label).
 */
export function findTag(
  tags: TagRecord[],
  entityId: number | string,
  label: string,
): TagRecord | undefined {
  return tags.find((t) => String(t.entity) === String(entityId) && t.label === label);
}
