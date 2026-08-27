/**
 * The "Generate drafts" gate, resolved SERVER-side (bd startsim-ozpjw.2).
 *
 * startsim-0e9ue put the gate in the drawer: an unapproved topic renders a
 * reason instead of a button. That closed the control, not the behaviour — the
 * route behind it relayed any story to the n8n writer. This module gathers, from
 * the tenant backend, the three inputs `canGenerateDrafts` needs, so the route
 * can ask the SAME predicate the client asks. It deliberately defines nothing:
 * no approve status, no draft-linking rule, no second opinion about either.
 *
 * WHY EACH READ LOOKS THE WAY IT DOES — all three were nearly got wrong:
 *
 *  1. THE SCHEMA IS NORMALIZED BEFORE `resolveReviewConfig` SEES IT.
 *     `tenantFetch` returns Django's raw JSON; the shared browser client's
 *     snake→camel transform is a CLIENT thing and is not in play here. So the
 *     type arrives with `data_type`, while `pickStatusAttr` filters on
 *     `a.dataType === 'enum'`. Forwarding the raw shape yields zero enum attrs →
 *     `transitions.approve: null` → the gate refuses EVERY topic, approved ones
 *     included, and the feature dies for everyone. `entityTypeFromWire` is the
 *     whole fix and `__tests__/topic-gate.test.ts` fixtures it in snake_case.
 *
 *  2. THE DRAFT ROWS ARE RE-CHECKED IN JS RATHER THAN TRUSTING `count`.
 *     Measured and written down in `foundry-api.ts`: the deployed tenant image
 *     SILENTLY IGNORES a query parameter it does not recognise (`?bogus=1`
 *     returns everything, not a 400). So a dropped `attr.topic_ref` would make
 *     the envelope's `count` the total draft count — 88 today — and every topic
 *     would refuse as `drafts_exist`. Filtering the returned rows ourselves is
 *     correct when the filter works AND when it is ignored (in which case this
 *     degrades to exactly what the n8n poll does: read the drafts, match on
 *     `topic_ref`). The filter stays in the URL because it is the verified
 *     `attr.<name>` shape and saves the bandwidth when it is honoured.
 *
 *  3. IT MATCHES ON `topic_ref` ONLY, where the client's `fetchTopicDrafts`
 *     also honours a `written_for` edge and an `external_id` stamp. That is a
 *     deliberate NARROWING: `topic-drafts.ts` records that `written_for` has
 *     ~zero live rows, the n8n poll dedups on `topic_ref` alone, and paging
 *     every relationship on a button press is not worth it. The divergence can
 *     only ever ALLOW a case the client already refuses — never refuse one it
 *     allows — so it cannot cost anyone their button.
 */
import { resolveReviewConfig } from '@startsimpli/ui/collection';

import { readData } from '@/lib/board';
import type { AttributeDef, EntityRecord, EntityTypeDef, Paginated } from '@/lib/foundry-api';
import { canGenerateDrafts, DRAFT_TYPE, type GenerateDraftsGate } from '@/lib/topic-drafts';

/** A GET against the tenant backend, by path (see `tenant-fetch.ts`). */
export type TenantReader = <T>(path: string) => Promise<T>;

/** Pages to walk before giving up. Both lists are small; this is a stop, not a budget. */
const MAX_PAGES = 5;
/** Rows per page. Large enough that the realistic case is always one request. */
const PAGE_SIZE = 200;

type Wire = Record<string, unknown>;

/** Read a wire field under either casing — Django sends snake, the client camel. */
function wire(raw: Wire, snake: string, camel: string): unknown {
  return raw[camel] ?? raw[snake];
}

/**
 * Django's raw attribute JSON -> the camelCase `AttributeDef` the shared review
 * resolver reads. `config` and `name` are already casing-neutral; `data_type` is
 * the one that matters and the one that breaks everything when it is missed.
 */
function attributeFromWire(raw: Wire): AttributeDef {
  return {
    id: raw.id as AttributeDef['id'],
    name: String(raw.name ?? ''),
    dataType: wire(raw, 'data_type', 'dataType') as AttributeDef['dataType'],
    required: Boolean(raw.required),
    config: (raw.config ?? {}) as Record<string, unknown>,
  };
}

/** Django's raw entity-type JSON -> the camelCase `EntityTypeDef`. */
export function entityTypeFromWire(raw: unknown): EntityTypeDef {
  const t = (raw ?? {}) as Wire;
  const attrs = Array.isArray(t.attributes) ? (t.attributes as Wire[]) : [];
  return {
    id: t.id as EntityTypeDef['id'],
    key: String(t.key ?? ''),
    label: String(t.label ?? ''),
    attributes: attrs.map(attributeFromWire),
  };
}

/** Django's raw entity JSON -> the camelCase `EntityRecord`. */
export function entityFromWire(raw: unknown): EntityRecord {
  const e = (raw ?? {}) as Wire;
  return {
    id: e.id as EntityRecord['id'],
    entityType: String(wire(e, 'entity_type', 'entityType') ?? ''),
    externalId: (wire(e, 'external_id', 'externalId') ?? null) as string | null,
    name: String(e.name ?? ''),
    data: (e.data ?? {}) as Record<string, unknown>,
    createdAt: String(wire(e, 'created_at', 'createdAt') ?? ''),
  };
}

/** Walk a paginated list, stopping at MAX_PAGES. Returns the rows and whether more remain. */
async function readPages(
  read: TenantReader,
  path: string,
): Promise<{ rows: Wire[]; truncated: boolean }> {
  const rows: Wire[] = [];
  const join = path.includes('?') ? '&' : '?';
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await read<Paginated<Wire>>(`${path}${join}page=${page}&page_size=${PAGE_SIZE}`);
    rows.push(...(Array.isArray(res?.results) ? res.results : []));
    if (!res?.next) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

/**
 * Resolve the gate for one topic id, reading the tenant for each input.
 *
 * THROWS when the tenant cannot be read. That is the point: the caller turns a
 * throw into "could not verify", which is not the same answer as "refused" and
 * must never be treated as "allowed" — failing open on an unreachable backend
 * would reinstate exactly the hole this exists to close.
 */
export async function resolveTopicGate(
  read: TenantReader,
  topicRef: string,
): Promise<GenerateDraftsGate> {
  const topic = entityFromWire(await read(`entities/${encodeURIComponent(topicRef)}`));

  // The topic's OWN type, not a hardcoded 'topic': the review map has to come
  // from the type the record actually declares, the same one the drawer passes.
  const typeKey = topic.entityType || 'topic';
  const { rows: typeRows } = await readPages(read, 'schema/types');
  const rawType = typeRows.find((t) => String(t.key ?? '') === typeKey);
  // No matching type -> resolveReviewConfig(undefined) -> approve: null ->
  // refused. Fail closed, exactly as the client does for a type with no pipeline.
  const review = resolveReviewConfig(rawType ? entityTypeFromWire(rawType) : null);

  const topicId = String(topic.id);
  const query = new URLSearchParams({ type: DRAFT_TYPE, [`attr.topic_ref`]: topicId });
  const { rows: draftRows, truncated } = await readPages(read, `entities?${query.toString()}`);
  const draftCount = draftRows.filter(
    (d) => String(readData(d.data as EntityRecord['data'], 'topic_ref') ?? '') === topicId,
  ).length;
  if (truncated && draftCount === 0) {
    // Not a behaviour change — the line that makes a future under-count
    // diagnosable instead of invisible. Reaching here means the attr filter was
    // dropped AND the tenant holds more drafts than MAX_PAGES * PAGE_SIZE.
    console.warn('[generate-drafts] draft listing was truncated before a match', { topicId });
  }

  return canGenerateDrafts(topic, review, draftCount);
}
