/**
 * Resolve a topic's candidate drafts (bd 768w.16.8.6).
 *
 * Drafts link to their topic through an explicit `written_for` relationship edge
 * (source = the draft record, target = the topic record) — the authoritative,
 * stored link the content writer stamps. We resolve a topic's drafts by walking
 * those edges rather than heuristically matching titles: it's exact and immune to
 * renamed or duplicated story titles. The matching itself is a pure function so it
 * unit-tests without a backend; `fetchTopicDrafts` just gathers the two record
 * sets and hands them to it.
 */
import {
  listAllEntities,
  listRelationships,
  type EntityRecord,
  type RelationshipRecord,
} from '@/lib/foundry-api';
import { readData } from '@/lib/board';

/** The edge key linking a draft (source) to the topic it was written for (target). */
export const WRITTEN_FOR = 'written_for';

/** The entity type whose records are drafts. */
export const DRAFT_TYPE = 'draft';

/**
 * The drafts written for a topic: every draft whose `written_for` edge targets
 * `topicId`. Pure and order-preserving (drafts keep their input order, not the
 * edge order) so it's unit-tested in isolation.
 */
export function matchTopicDrafts(
  topicId: number,
  relationships: RelationshipRecord[],
  drafts: EntityRecord[],
): EntityRecord[] {
  const draftIds = new Set(
    relationships
      .filter((r) => r.relType === WRITTEN_FOR && r.target === topicId)
      .map((r) => r.source),
  );
  return drafts.filter((d) => draftIds.has(d.id));
}

/** A draft's display title — its story_title, else the record name, else `#id`. */
export function draftTitle(d: EntityRecord): string {
  const t = readData(d.data, 'story_title');
  const title = t == null ? '' : String(t).trim();
  return title || (d.name ?? '').trim() || `#${d.id}`;
}

/** A draft's status (drafting | ready | published), '' when unset. */
export function draftStatus(d: EntityRecord): string {
  const s = readData(d.data, 'status');
  return s == null ? '' : String(s);
}

async function listAllRelationships(maxPages = 20): Promise<RelationshipRecord[]> {
  const all: RelationshipRecord[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await listRelationships(page);
    all.push(...res.results);
    if (!res.next) break;
  }
  return all;
}

/**
 * Fetch the drafts written for a topic. Gathers all `written_for` edges plus all
 * draft records, then matches. Returns [] (never a thrown "no drafts") so the
 * drawer can render a clean empty state.
 */
export async function fetchTopicDrafts(topicId: number): Promise<EntityRecord[]> {
  const [relationships, drafts] = await Promise.all([
    listAllRelationships(),
    listAllEntities(DRAFT_TYPE),
  ]);
  return matchTopicDrafts(topicId, relationships, drafts);
}
