/**
 * Resolve a topic's candidate drafts (bd 768w.16.8.6, 768w.16.9.5).
 *
 * A draft links to its topic two ways, and we accept either:
 *   1. an explicit `written_for` relationship edge (source = the draft record,
 *      target = the topic record) — the stored graph edge; and
 *   2. a `topic_ref` value on the draft's data blob equal to the topic id (as a
 *      string) — the flat stamp the n8n writer echoes back on each candidate it
 *      generates (see the "Generate drafts" trigger in the drawer).
 * Matching on either is exact and immune to renamed / duplicated story titles.
 * The matching itself is a pure function so it unit-tests without a backend;
 * `fetchTopicDrafts` just gathers the two record sets and hands them to it.
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
 * The drafts written for a topic: every draft that either has a `written_for`
 * edge targeting `topicId` OR carries `topic_ref === String(topicId)` on its data
 * blob. Pure and order-preserving (drafts keep their input order, not the edge
 * order) so it's unit-tested in isolation.
 */
export function matchTopicDrafts(
  topicId: number,
  relationships: RelationshipRecord[],
  drafts: EntityRecord[],
): EntityRecord[] {
  const topicRef = String(topicId);
  const draftIds = new Set(
    relationships
      .filter((r) => r.relType === WRITTEN_FOR && r.target === topicId)
      .map((r) => r.source),
  );
  return drafts.filter((d) => {
    if (draftIds.has(d.id)) return true;
    const ref = readData(d.data, 'topic_ref');
    return ref != null && String(ref) === topicRef;
  });
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

/** A draft's candidate ordinal (1-based, stamped by the writer); 0 when unset. */
export function draftCandidateIndex(d: EntityRecord): number {
  const n = Number(readData(d.data, 'candidate_index'));
  return Number.isFinite(n) ? n : 0;
}

/**
 * A draft's Content-Judge verdict (e.g. 'accept'), read out of the `judge_verdict`
 * object the writer attaches. '' when there's no verdict object or verdict field.
 */
export function draftJudgeVerdict(d: EntityRecord): string {
  const j = readData(d.data, 'judge_verdict');
  if (j && typeof j === 'object' && !Array.isArray(j)) {
    const v = (j as Record<string, unknown>).verdict;
    return v == null ? '' : String(v);
  }
  return '';
}

/**
 * The story payload the n8n writer webhook consumes — one topic → 3 candidate
 * drafts. `topic_ref` is the string topic id the writer echoes onto every
 * candidate so `matchTopicDrafts` can link them back. Kept a pure mapper (no
 * fetch) so it's unit-tested in isolation and reused by the /api route caller.
 */
export interface DraftStory {
  title: string;
  market: string;
  context: string;
  sources: string;
  content_type: string;
  topic_ref: string;
  topic_title: string;
}

/** camelCase-aware read of a data-blob value as a trimmed string ('' when unset). */
function readStr(data: EntityRecord['data'] | undefined, name: string): string {
  const v = readData(data, name);
  return v == null ? '' : String(v).trim();
}

/**
 * Build the writer story from a topic record. Title falls back to the `title`
 * attribute when the record has no name; sources 1–3 are the non-empty ones
 * newline-joined. Pure — the drawer POSTs the result to /api/generate-drafts.
 */
export function buildStoryFromTopic(topic: EntityRecord): DraftStory {
  const title = (topic.name || '').trim() || readStr(topic.data, 'title');
  const sources = [
    readStr(topic.data, 'source_1'),
    readStr(topic.data, 'source_2'),
    readStr(topic.data, 'source_3'),
  ]
    .filter(Boolean)
    .join('\n');
  return {
    title,
    market: readStr(topic.data, 'market'),
    context: readStr(topic.data, 'angle'),
    sources,
    content_type: readStr(topic.data, 'content_type'),
    topic_ref: String(topic.id),
    topic_title: title,
  };
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
