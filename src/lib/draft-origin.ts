/**
 * Where a record came from, said out loud (bd startsim-4gw21).
 *
 * A reviewer opened the Drafts tab, found drafts nobody on her team had written,
 * and had to ASK who made them. The answer was in the data the whole time —
 * every draft the OGMC pipeline writes carries `data._origin` and lands under
 * the automation's own `owner_sub` — it just never reached the screen. This
 * module turns those two fields into something a column can render.
 *
 * WHAT THIS CAN AND CANNOT SAY, exactly. Two things start the writer: the
 * unattended 6-hourly poller ("OGMC — Auto-write Ready Topics"), and a person
 * pressing "Generate drafts" on a topic. BOTH route through the same sub-workflow
 * ("OGMC — Weekly Insight Writer"), and neither caller passes a marker naming
 * itself — the writer's "Build Tenant Draft" node hardcodes
 * `_origin: "n8n-weekly-writer"` either way. So a row can honestly say
 * "written by the AI, not typed by a person"; it CANNOT yet say which of the two
 * started that run, and nothing here pretends otherwise. Making that
 * distinguishable is a change to the n8n side (stamp the caller), tracked
 * separately — until it lands, {@link describeRecordOrigin} deliberately returns
 * one automation label rather than guessing between them.
 *
 * `human_edited` is reported as "edited", never as "edited by a person": the mark
 * records that a value was set through the GET-then-write endpoints, which is an
 * ENDPOINT distinction rather than a claim about who typed it (the same nuance
 * the n8n reconcile node documents when it overrides `status` with `regenerate`).
 *
 * Generic on purpose (rule 9): it reads a record, not a draft. Every content type
 * in this tenant is written by some mix of automation and people, so the Topics
 * table can adopt the same column without a second implementation.
 */
import { readData } from '@/lib/board';
import type { EntityRecord } from '@/lib/foundry-api';

/** The data-blob key the writer stamps. Read through `readData` — the shared API
 *  client camelCases response keys, so on the wire this arrives as `Origin`. */
export const ORIGIN_ATTR = '_origin';

/** The prefix the tenant backend gives a non-human (service credential) owner. */
export const SERVICE_OWNER_PREFIX = 'svc:';

export type OriginKind =
  /** Written by an automation — no one typed it. */
  | 'automation'
  /** Created under a signed-in person's account. */
  | 'person'
  /** The row carries no origin marker and no owner. */
  | 'unknown';

export interface RecordOrigin {
  kind: OriginKind;
  /** The column's short label. */
  label: string;
  /** The long form, for a tooltip — says how we know, in plain words. */
  detail: string;
  /**
   * Fields that have been changed through the app since the record was written,
   * newest-agnostic and sorted for a stable render. Empty when untouched.
   */
  editedFields: string[];
}

/** The `human_edited` marks, as `{ data: { <field>: {...} } }`. Shape-tolerant:
 *  anything that is not that shape reads as "no edits", never as a crash. */
function editedFieldsOf(record: Pick<EntityRecord, 'humanEdited'>): string[] {
  const marks = record.humanEdited;
  if (!marks || typeof marks !== 'object') return [];
  const data = (marks as Record<string, unknown>).data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
  return Object.keys(data as Record<string, unknown>).sort();
}

/** True when an owner string names a service credential rather than a person. */
export function isServiceOwner(ownerSub: unknown): boolean {
  return typeof ownerSub === 'string' && ownerSub.startsWith(SERVICE_OWNER_PREFIX);
}

/**
 * Describe where one record came from.
 *
 * ORDER MATTERS. `_origin` is checked BEFORE the owner, because it is the more
 * truthful of the two: a draft written by the AI writer but stored under a
 * person's token (which is exactly what the translate action produces — the
 * person asked for a translation, the machine wrote it) would otherwise be
 * labelled "Person" and re-create the confusion this column exists to end.
 */
export function describeRecordOrigin(
  record: Pick<EntityRecord, 'data' | 'ownerSub' | 'humanEdited'>,
): RecordOrigin {
  const editedFields = editedFieldsOf(record);
  const origin = readData(record.data, ORIGIN_ATTR);
  const owner = record.ownerSub;

  if (typeof origin === 'string' && origin.trim()) {
    return {
      kind: 'automation',
      label: 'AI writer',
      detail:
        `Written automatically by the "${origin.trim()}" workflow — nobody typed it. ` +
        'That workflow runs both on a schedule and when someone presses "Generate drafts"; ' +
        'the record does not say which of the two started this one.',
      editedFields,
    };
  }

  if (isServiceOwner(owner)) {
    return {
      kind: 'automation',
      label: 'Automation',
      detail: `Created by the "${owner}" service account, not by a person.`,
      editedFields,
    };
  }

  if (typeof owner === 'string' && owner.trim()) {
    return {
      kind: 'person',
      label: 'Person',
      detail: 'Created while somebody was signed in, under their own account.',
      editedFields,
    };
  }

  return {
    kind: 'unknown',
    label: 'Unknown',
    // Said as a fact about the RECORD, not as a claim that a person made it.
    // An unstamped row predates the origin marker; it is not evidence of a human.
    detail: 'This record carries no origin marker and no owner, so where it came from is not recorded.',
    editedFields,
  };
}

/** The tooltip for the whole cell: origin, plus what has been edited since. */
export function originTooltip(origin: RecordOrigin): string {
  if (origin.editedFields.length === 0) return origin.detail;
  return `${origin.detail}\n\nEdited through the app since: ${origin.editedFields.join(', ')}.`;
}
