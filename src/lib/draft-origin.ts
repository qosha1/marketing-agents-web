/**
 * Where a record came from, said out loud (bd startsim-4gw21, widened by
 * startsim-8hgmq.6).
 *
 * A reviewer opened the Drafts tab, found drafts nobody on her team had written,
 * and had to ASK who made them. The answer was in the data the whole time —
 * every draft the OGMC pipeline writes carries `data._origin` and lands under
 * the automation's own `owner_sub` — it just never reached the screen. This
 * module turns those fields into something a column can render.
 *
 * WHAT THIS CAN AND CANNOT SAY, exactly. Two things start the writer: the
 * unattended 6-hourly poller ("OGMC — Auto-write Ready Topics"), and a person
 * pressing "Generate drafts" on a topic. BOTH route through the same
 * sub-workflow ("OGMC — Weekly Insight Writer"), which hardcodes
 * `_origin: "n8n-weekly-writer"` either way — so `_origin` alone can only ever
 * say "written by the AI, not typed by a person".
 *
 * SINCE 2026-09-07T21:31Z THE CALLER NAMES ITSELF (bd startsim-8hgmq.2, live in
 * n8n). Each caller passes a `trigger` into the writer and the writer stamps it
 * alongside the unchanged `_origin`:
 *
 *   `_trigger: 'schedule'`         the 6-hourly poller. Nobody asked for it.
 *   `_trigger: 'generate_button'`  somebody pressed the button, and
 *                                  `_triggered_by` names them when the caller
 *                                  said who (startsim-8hgmq.7 makes this app
 *                                  say who; the poller never does, because
 *                                  nobody pressed anything).
 *   `_trigger: 'unknown'`          NOBODY TOLD US — a hand-run from the n8n
 *                                  editor, or a caller added later that does
 *                                  not name itself. It is NOT "we tried and
 *                                  failed", and it is NOT evidence of either
 *                                  caller.
 *   no `_trigger` key at all       the 153 rows written BEFORE that stamp went
 *                                  live. They can never be back-attributed, so
 *                                  they keep the older, weaker sentence, which
 *                                  is still exactly true of them.
 *
 * `_run_id` is the WRITER's own n8n execution id — three button presses are
 * three runs and three ids, so the drafts of one run group together. It rides in
 * the tooltip, which is what turns "why are there six near-identical drafts"
 * into "two runs, one person" without opening n8n.
 *
 * THESE ARE RENDERED, NOT FILTERABLE, and that is a decision rather than an
 * omission. Stamping a key inside the data blob makes it readable; it does not
 * make it QUERYABLE. `_trigger` is not a declared attribute on the draft type,
 * and the tenant answers a filter on an undeclared attribute by APPLYING it and
 * matching nothing — `count: 0`, reported in `applied_filters`, indistinguishable
 * from a filter that legitimately found nothing. That is precisely how the
 * Drafts tab emptied itself in bd startsim-8hgmq.4. So: NEVER add
 * `?attr._trigger=…` (or any client filter that round-trips through one) until
 * the attribute is declared on the type AND `redenormalize_attributes` has been
 * run. Until somebody wants that filter enough to make the schema change, the
 * column reads the blob and sorts in the browser.
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

/** The data-blob keys the writer stamps. Read through `readData` — the shared
 *  API client camelCases response keys, so on the wire these arrive as `Origin`,
 *  `Trigger`, `TriggeredBy` and `RunId`. Never hand-roll a second spelling. */
export const ORIGIN_ATTR = '_origin';
export const TRIGGER_ATTR = '_trigger';
export const TRIGGERED_BY_ATTR = '_triggered_by';
export const RUN_ID_ATTR = '_run_id';

/** The prefix the tenant backend gives a non-human (service credential) owner. */
export const SERVICE_OWNER_PREFIX = 'svc:';

export type OriginKind =
  /** Written by an automation — no one typed it. */
  | 'automation'
  /** Created under a signed-in person's account. */
  | 'person'
  /** The row carries no origin marker and no owner. */
  | 'unknown';

export type OriginTrigger =
  /** The unattended 6-hourly poller. */
  | 'schedule'
  /** Somebody pressed "Generate drafts". */
  | 'generate_button'
  /** The record does not say — including every row written before the stamp. */
  | 'unknown';

export interface RecordOrigin {
  kind: OriginKind;
  /** The column's short label. */
  label: string;
  /** The long form, for a tooltip — says how we know, in plain words. */
  detail: string;
  /** Which caller started the run, as far as the record says. */
  trigger: OriginTrigger;
  /** Who the caller said pressed the button. Absent when the record is silent. */
  triggeredBy?: string;
  /** The writer's n8n execution id, when stamped — one run's drafts share one. */
  runId?: string;
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

/** A stamped string, or '' — anything that is not a non-blank string is absence. */
function stamp(data: EntityRecord['data'] | undefined, attr: string): string {
  const raw = readData(data, attr);
  return typeof raw === 'string' ? raw.trim() : '';
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
  const origin = stamp(record.data, ORIGIN_ATTR);
  const owner = record.ownerSub;

  if (origin) {
    const workflow = `Written automatically by the "${origin}" workflow`;
    const rawTrigger = stamp(record.data, TRIGGER_ATTR);
    const triggeredBy = stamp(record.data, TRIGGERED_BY_ATTR) || undefined;
    const runId = stamp(record.data, RUN_ID_ATTR) || undefined;
    const common = { kind: 'automation' as const, triggeredBy, runId, editedFields };

    if (rawTrigger === 'schedule') {
      return {
        ...common,
        trigger: 'schedule',
        label: 'Scheduled',
        detail: `${workflow}, started by the 6-hourly schedule that writes up approved topics. Nobody asked for this one.`,
      };
    }

    if (rawTrigger === 'generate_button') {
      return {
        ...common,
        trigger: 'generate_button',
        label: 'Generated',
        detail: triggeredBy
          ? `${workflow}, started when ${triggeredBy} pressed "Generate drafts" on the topic.`
          : `${workflow}, started when somebody pressed "Generate drafts" on the topic; the record does not say who.`,
      };
    }

    return {
      ...common,
      trigger: 'unknown',
      label: 'AI writer',
      // EXACTLY the older sentence, because it is exactly what these rows
      // support. 'unknown' means nobody told us — a hand-run, or a caller that
      // does not name itself — and an unstamped row predates the marker
      // altogether. Neither is evidence of either caller, so neither is guessed.
      detail:
        `${workflow} — nobody typed it. ` +
        'That workflow runs both on a schedule and when someone presses "Generate drafts"; ' +
        'the record does not say which of the two started this one.' +
        // A caller this app has not heard of is worth quoting rather than
        // hiding: it is the difference between "no marker" and "a marker we
        // don't understand", and only one of those is somebody's bug.
        (rawTrigger && rawTrigger !== 'unknown'
          ? ` It names its caller as "${rawTrigger}", which this app does not recognise.`
          : ''),
    };
  }

  if (isServiceOwner(owner)) {
    return {
      kind: 'automation',
      label: 'Automation',
      detail: `Created by the "${owner}" service account, not by a person.`,
      trigger: 'unknown',
      editedFields,
    };
  }

  if (typeof owner === 'string' && owner.trim()) {
    return {
      kind: 'person',
      label: 'Person',
      detail: 'Created while somebody was signed in, under their own account.',
      trigger: 'unknown',
      editedFields,
    };
  }

  return {
    kind: 'unknown',
    label: 'Unknown',
    // Said as a fact about the RECORD, not as a claim that a person made it.
    // An unstamped row predates the origin marker; it is not evidence of a human.
    detail: 'This record carries no origin marker and no owner, so where it came from is not recorded.',
    trigger: 'unknown',
    editedFields,
  };
}

/** The tooltip for the whole cell: origin, the run it belongs to, and what has
 *  been edited since. */
export function originTooltip(origin: RecordOrigin): string {
  const parts = [origin.detail];
  // The id that groups one run's drafts. A reviewer looking at six near-identical
  // candidates can see two runs here without opening n8n (bd startsim-8hgmq.3).
  if (origin.runId) parts.push(`Writer run ${origin.runId} — the drafts of one run share this id.`);
  if (origin.editedFields.length > 0) {
    parts.push(`Edited through the app since: ${origin.editedFields.join(', ')}.`);
  }
  return parts.join('\n\n');
}
