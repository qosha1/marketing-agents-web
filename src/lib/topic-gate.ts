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
 *  2. THE DRAFTS ARE NARROWED ONLY AS FAR AS THE SCHEMA SAYS THEY CAN BE, AND
 *     ARE MATCHED IN JS EITHER WAY.
 *     This read is the whole gate: `canGenerateDrafts` refuses on
 *     `draftCount > 0`, so a draft this misses is a writer fired twice.
 *
 *     It used to narrow with `attr.topic_ref=<id>` unconditionally. That filter
 *     is what broke it (bd startsim-8hgmq.3). The tenant has THREE answers to a
 *     filter, not two, and only two were reasoned about here:
 *       - HONOURED — the rows come back narrowed;
 *       - IGNORED — an UNRECOGNISED parameter is dropped and EVERYTHING comes
 *         back (measured, and written down in `foundry-api.ts`), which is why
 *         the rows are re-checked in JS instead of trusting the envelope
 *         `count`: 88 unrelated drafts would otherwise refuse every topic;
 *       - ACCEPTED AND MATCHED NOTHING — a filter on an attribute the type does
 *         not DECLARE is applied and finds no rows. `count: 0`, the parameter
 *         reported in `applied_filters` and NOT in `ignored_filters`,
 *         indistinguishable from a filter that legitimately matched nothing.
 *     `topic_ref` was undeclared on the draft type — verified against the live
 *     tenant in bd startsim-8hgmq.4, where the same filter emptied the entire
 *     Drafts tab. So this gate counted ZERO drafts for every topic in the
 *     tenant, always, and the JS re-check ran over an empty array and could not
 *     save it. On 2026-09-07 that relayed the writer twice for one topic
 *     (n8n 12848 at 15:43:02 and 12853 at 15:46:08, the second fired 79 seconds
 *     AFTER the first three drafts had already landed), leaving six
 *     near-duplicate drafts in the reviewer's queue.
 *
 *     `topic_ref` IS DECLARED NOW (bd startsim-8hgmq.11, applied 2026-09-07 via
 *     `scripts/schemas/ogmc.json` + `redenormalize_attributes`; measured live,
 *     `?type=draft&attr.topic_ref=<id>` answers 3 for a topic that has three
 *     drafts, having answered 0 the hour before). So the narrowing is back — and
 *     it is back BEHIND A CHECK OF THE SCHEMA THIS FUNCTION ALREADY FETCHES.
 *     `readPages('schema/types')` is read for the topic's own review map; the
 *     draft type is in the same response, so `declaresTopicRef` costs no extra
 *     request. Undeclare the attribute and the filter silently stops being sent:
 *     the gate lists by `type` alone and matches in JS, which is slower and
 *     correct. There is no comment here asserting the attribute is declared,
 *     because a comment is exactly what was wrong last time.
 *
 *     THE JS RE-CHECK RUNS IN BOTH CASES, deliberately. The server filter is an
 *     optimisation; the count is established here. That is what keeps the
 *     IGNORED case above from refusing an eligible topic.
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
import {
  canGenerateDrafts,
  declaresTopicRef,
  DRAFT_TYPE,
  TOPIC_REF_ATTR,
  type GenerateDraftsGate,
} from '@/lib/topic-drafts';

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
  // The DRAFT type is in the schema response already read above, so asking
  // whether it declares `topic_ref` costs nothing. See note 2 in the header: a
  // filter on an UNDECLARED attribute is accepted and answers with nothing, and
  // that is what zeroed this count for every topic in the tenant.
  const draftType = typeRows.find((t) => String(t.key ?? '') === DRAFT_TYPE);
  const query = new URLSearchParams({ type: DRAFT_TYPE });
  if (declaresTopicRef(entityTypeFromWire(draftType ?? null).attributes)) {
    query.set(`attr.${TOPIC_REF_ATTR}`, topicId);
  }
  const { rows: draftRows, truncated } = await readPages(read, `entities?${query.toString()}`);
  // COUNTED HERE, NOT TAKEN FROM THE ENVELOPE, whether or not the filter above
  // was sent — an ignored parameter returns the whole corpus and would refuse
  // every topic.
  const draftCount = draftRows.filter(
    (d) => String(readData(d.data as EntityRecord['data'], TOPIC_REF_ATTR) ?? '') === topicId,
  ).length;
  if (truncated && draftCount === 0) {
    // A COUNT WE COULD NOT ESTABLISH IS NOT A COUNT OF ZERO. The unnarrowed
    // path — the one taken when the draft type does not declare `topic_ref` — is
    // a listing bounded by MAX_PAGES * PAGE_SIZE (1000; 150 drafts today). Past
    // that ceiling a topic whose drafts sit beyond the last page read would
    // count 0 and be waved through — the very defect this function exists to
    // stop, re-entering through the door the fallback opens.
    //
    // So it throws, which the caller turns into "could not verify" (502), the
    // same answer an unreachable tenant gets. Warning and allowing would fail
    // OPEN on an unverifiable read while the paragraph above this function
    // promises the opposite.
    throw new Error(
      `draft listing was truncated at ${MAX_PAGES * PAGE_SIZE} rows before matching topic ${topicId}`,
    );
  }

  return canGenerateDrafts(topic, review, draftCount);
}
