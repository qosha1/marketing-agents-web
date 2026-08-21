/**
 * A human's draft title must survive the next AI write (bd startsim-wn2p.16).
 *
 * STUB — every export throws until wn2p.16's GREEN lands. The RED suite keys
 * its `it.fails` markers on {@link TitleDurabilityNotImplementedError}, so it
 * arms and disarms itself; nothing has to be deleted to go green.
 *
 * WHAT THIS IS FOR. The tracker spreadsheet says of the Title column: "Title
 * created by AI (needs to be able to be updated if changes are made in human
 * review stage". Half one — the title is editable — already works: `story_title`
 * is a declared attribute and the drawer's "Edit fields" mode writes it. Half
 * two is the one with teeth: the edit must not be undone by the next AI write.
 *
 * WHAT WAS MEASURED, 2026-08-21, against the live marketing-agents tenant.
 * Read this before changing the contract below — every clause is a measurement,
 * not a preference.
 *
 *   1. The draft writer (n8n `ornNNyf2MXl0qtEM`, node "Upsert Draft -> Tenant")
 *      is named upsert but POSTs to `/api/v1/entities/` — the plain CREATE
 *      endpoint. Its sibling on the topic side ("Upsert Topic -> Tenant
 *      (rerank)") posts to `/api/v1/entities/upsert/`. Only the second merges.
 *   2. A create with an `external_id` that already exists for the same owner is
 *      refused, not duplicated: the partial unique constraint
 *      `uniq_entity_external_id_per_org_type_owner` on
 *      (org_id, entity_type, external_id, owner_sub) turns it into
 *      `400 {"detail": "conflict: duplicate key value ..."}`. The n8n node sets
 *      `onError: continueRegularOutput`, so that 400 is swallowed in silence.
 *   3. So a human's edited title is NOT currently clobbered — it survives
 *      because nothing in the draft pipeline ever re-writes an existing row,
 *      not because anything guards it. `external_id` is `slug(headline)` fixed
 *      at create and never recomputed, so a rename cannot move a row or
 *      collide with one.
 *   4. The obvious repair for (1) — point the node at `/api/v1/entities/upsert/`,
 *      which is what its own name claims and what the topic path already does —
 *      is what makes the clobber real. Measured: a full-payload upsert reverted
 *      `name`, `story_title`, `subheadline` AND `angle` to the AI's text.
 *   5. THE NOVEL PART, and why a startsim-fobz-shaped fix is not enough here.
 *      Upsert MERGES `data`, so a `data` key you do not resend survives. It does
 *      NOT merge `name`: `_upsert_one` runs `if name is not None: entity.name =
 *      name`. A draft's title is `name` first and `data.story_title` second, so
 *      protecting only the `data` keys still loses the title. The top-level
 *      `name` must be omitted too. (The topic rerank node already gets this
 *      right — it sets `payload.name` only when the row is not approved.)
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DECIDE. Not *when* a title is
 * human-owned. The topic side uses `team_verdict === 'good'` as a proxy for "a
 * human touched this"; drafts have no such field, and an editorial verdict is
 * not an edit record either way. Whether the trigger ends up being provenance, a
 * verdict proxy, or simply unconditional is a GREEN decision — so the owned set
 * is an INPUT here. Same discipline as `draft-status.ts`: the mapping lives in
 * the issue as data, and this module never guesses it.
 */
import type { EntityRecord } from '@/lib/foundry-api';

/** Thrown by every export while this module is still a stub. */
export class TitleDurabilityNotImplementedError extends Error {
  constructor(what: string) {
    super(`${what} is not implemented — bd startsim-wn2p.16`);
    this.name = 'TitleDurabilityNotImplementedError';
  }
}

/**
 * The title pieces that live in the `data` blob. OGMC's title model is short
 * title + subtitle + angle, and `story_title` is the drawer's "Title" column.
 * Merge protects these when they are not resent.
 */
export const TITLE_DATA_FIELDS = ['story_title', 'subheadline', 'angle'] as const;

/**
 * The fourth title piece, kept separate ON PURPOSE — it is a column, not a
 * `data` key, and the server's merge does not protect it. Omitting the three
 * above while still sending this one loses the title anyway (measurement 5).
 */
export const TITLE_NAME_FIELD = 'name';

/** The endpoint that merges. `/api/v1/entities/` creates and cannot update. */
export const MERGING_UPSERT_PATH = 'api/v1/entities/upsert';

/** One row of the writer's POST body. `name` absent means "do not touch it". */
export interface DraftWrite {
  entity_type: string;
  external_id: string;
  name?: string;
  data: Record<string, unknown>;
}

/**
 * The slug half of the writer's `external_id`: lowercase, every run of
 * non-`[a-z0-9]` collapsed to a dash, leading/trailing dashes trimmed, capped at
 * 80 chars. Verified against all 75 robot-written drafts live (75/75 satisfy
 * `external_id === slugForHeadline(name)`).
 *
 * RETURNS `''` for a headline with no slug characters at all — a CJK or Arabic
 * title collapses to nothing. That is the honest result of the transform, and
 * `''` is exactly the value that must never reach the API: the unique
 * constraint is declared `condition=~Q(external_id="")`, so an empty
 * `external_id` is EXEMPT from it and silently stops de-duplicating. Two live
 * drafts sit in that state today. {@link draftExternalId} is what applies the
 * writer's fallbacks; this function deliberately does not hide the empty case.
 */
export function slugForHeadline(_headline: string): string {
  throw new TitleDurabilityNotImplementedError('slugForHeadline');
}

/**
 * The full `external_id` expression from "Build Tenant Draft", fallbacks and
 * all — which is why it needs the candidate ordinal the node has and a bare
 * slug function does not:
 *
 *   `(slug(headline || 'cand-'+(i+1))).slice(0,80) || ('draft-'+(i+1))`
 *
 * So an absent headline yields `cand-<n>`, and a headline that slugifies to
 * nothing yields `draft-<n>`. `candidateIndex` is 1-based, matching the node's
 * `i + 1` and the `candidate_index` it stamps on the row.
 */
export function draftExternalId(_headline: string, _candidateIndex: number): string {
  throw new TitleDurabilityNotImplementedError('draftExternalId');
}

/**
 * True when a stored draft's name no longer matches the slug it was created
 * under — the only live signal that a human renamed it, since the writer sets
 * `external_id = slug(name)` at create and never recomputes it. 0 of 75 robot
 * drafts drift today, which is the evidence that no human has yet edited a
 * draft title in production.
 */
export function titleWasRenamed(_record: EntityRecord): boolean {
  throw new TitleDurabilityNotImplementedError('titleWasRenamed');
}

/**
 * The payload an AI writer is allowed to send at a draft row that ALREADY
 * EXISTS: the incoming write with every human-owned title piece stripped —
 * `name` included — and addressed to the row's own `external_id` rather than to
 * a fresh slug of the new headline. Everything the AI does own (body, seo,
 * status, verdict) passes through untouched, so a re-write still updates the
 * piece; it just cannot rename it.
 *
 * `owned` is the caller's answer to "which pieces has a human claimed", named
 * with the `TITLE_DATA_FIELDS` keys plus `TITLE_NAME_FIELD`.
 */
export function aiRewritePayload(
  _existing: EntityRecord,
  _incoming: DraftWrite,
  _owned: readonly string[],
): DraftWrite {
  throw new TitleDurabilityNotImplementedError('aiRewritePayload');
}

/**
 * The tenant's own merge semantics, so a write→edit→re-write round trip is
 * assertable without a backend. Measured, not assumed: `data` shallow-merges
 * and `name` is assigned only when the payload carries one.
 */
export function applyUpsert(_existing: EntityRecord, _payload: DraftWrite): EntityRecord {
  throw new TitleDurabilityNotImplementedError('applyUpsert');
}
