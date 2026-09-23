/**
 * Editing a topic's TEXT from the page where its draft is being judged
 * (bd startsim-m7fdm.7).
 *
 * Quinn, 2026-09-23: "for the draft detail view even if we 'approve' the topic
 * whatever we need to be able to edit the text and description should we want to
 * change it right now we cant." The panel startsim-z384k put at the top of
 * /draft/<id> rendered the topic as prose and nothing else, so fixing a title
 * meant leaving the draft, re-finding the row in /t/topic and opening the
 * drawer — the round trip the one-page flow exists to remove.
 *
 * NOTHING WAS GATING IT ON STATUS, and it is worth saying so because the ask
 * says "even if we approve". Verified against tenant-starter `origin/main`
 * 2026-09-23: `EntityViewSet.perform_update` (apps/api/views.py) refuses a
 * changed `entity_type`, re-validates the schema, checks field-level redactions
 * and marks human edits. It reads no status and refuses no transition. The panel
 * was simply built read-only.
 *
 * ── WHY THIS MODULE EXISTS RATHER THAN A FORM COMPONENT DOING IT INLINE ─────
 *
 * The tenant PATCH REPLACES `data` — it does not deep-merge — so a save here is
 * a whole-blob write, and this tenant has already paid for three separate ways
 * of getting a whole-blob write wrong. Each of them is a property of the BODY,
 * not of the screen, so each is checked by a test over this function rather than
 * by looking at the panel:
 *
 *  1. DROPPED FIELDS. A body that carries only the edited attributes deletes
 *     every other one. So the blob is built by SPREADING the record's own data
 *     and moving only the named attributes over it.
 *  2. SPELLING. The shared API client camelises every response key and
 *     snake_cases every request key, recursively, INSIDE `data` — and the pair
 *     is not an involution: `source_1` arrives as `source1` and goes back as
 *     `source1`, renaming a declared attribute (bd startsim-8hgmq.18). So every
 *     write goes through the SHARED `writeData` / `declaredBlob` from
 *     `@startsimpli/ui/collection` — the same two functions the review drawer
 *     writes through — instead of a second hand-rolled key rule here.
 *  3. `scope_path`. It is a DECLARED attribute on this tenant's topic type
 *     (read off the live schema 2026-09-23), it carries the row's scope, and
 *     `perform_update` — unlike `perform_create` and the upsert paths — never
 *     calls `_require_scope_stamped`. A PATCH that drops it is accepted with a
 *     200 and the row becomes invisible to every non-exempt reader. There is no
 *     server-side net. It survives here because it is never NAMED: the spread
 *     carries it and nothing in this module touches an attribute it was not
 *     given.
 *
 * ── AND ONE THING IT DELIBERATELY DOES NOT FIX ─────────────────────────────
 *
 * Two people editing one record still overwrite each other (bd startsim-m7fdm.2);
 * the durable fix is the conditional-write epic startsim-jkkn7 and it is not
 * this bead. What this module DOES do is refuse to make the race worse: the
 * caller hands it the blob it just re-read from the server, not the one the page
 * loaded, so the window shrinks from "since this page opened" to "since the save
 * button was pressed". {@link topicEditData} reads the edit log out of THAT SAME
 * blob for the same reason — stamping a freshly-read blob with a stale log would
 * drop every entry somebody else added in between, which is m7fdm.2's own
 * failure mode newly minted by the fix for it.
 */
import { declaredBlob, writeData, type ResolvedReview } from '@startsimpli/ui/collection';

import { readData } from '@/lib/board';
import { readEditHistory, withEditStamp, type EditEntry } from '@/lib/edit-history';
import type { EntityTypeDef } from '@/lib/foundry-api';

/**
 * The attribute holding the one-line sub-heading.
 *
 * `ResolvedReview` has no subtitle slot, and adding one is a `packages/ui` change
 * — a meta-repo PR, a publish and a version bump before a line of behaviour could
 * ship, which is the same cost startsim-z384k declined for widening `onSaved`.
 * The guard instead is {@link topicEditFields}: every field, this one included,
 * is dropped unless the TYPE DECLARES it, so a fork whose topic has no subtitle
 * renders no subtitle editor rather than minting an undeclared blob key.
 */
export const SUBTITLE_ATTR = 'subtitle';

/** What the note field is called on screen — the read panel's own heading, so
 *  the form and the thing it edits cannot end up named two different things. */
export const NOTE_FIELD_LABEL = 'What the reviewer asked for';

/** Refusing an empty title is this form's one opinion — see {@link topicEditError}. */
export const EMPTY_TITLE_ERROR = 'A topic needs a title.';

export interface TopicEditField {
  /** The DECLARED attribute name — the spelling the tenant stores. */
  attr: string;
  /** What it is called on screen. */
  label: string;
  /** Render as a textarea. Taken from the attribute's own `dataType`, never guessed. */
  multiline: boolean;
  /** This form refuses to clear it. Only the title. */
  mandatory: boolean;
}

/** "team_notes" -> "Team notes". Only used for names with no heading of their own. */
function humanLabel(attr: string): string {
  const words = attr.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * WHICH OF THE TOPIC'S FIELDS A REVIEWER CAN EDIT FROM HERE, and why these four.
 *
 * The panel shows title, subtitle, angle, kind/market chips, status and the team
 * note. These four are the TEXT of the topic — the thing Quinn asked for:
 *
 *  • title      — the ask, verbatim.
 *  • subtitle   — "description", the ask's other half.
 *  • angle      — the topic's editorial direction and the thing the n8n writer
 *                 actually consumes. A reviewer who wants a different draft
 *                 changes THIS; leaving it read-only would keep the round trip
 *                 for the one field that steers the writer.
 *  • team_notes — already a replace-in-place single value everywhere else:
 *                 ReviewDrawer seeds its note box from the stored value and
 *                 PATCHes `{[cfg.noteAttr]: note.trim()}` straight over it. So
 *                 this is the same field with the same semantics, editable on the
 *                 page where its instruction is being satisfied. It is rendered
 *                 here as "the note that asked for this draft"; a reviewer who
 *                 has just read the draft is exactly the person who knows the
 *                 note was wrong.
 *
 * AND WHY NOT THE OTHER THREE THE PANEL SHOWS:
 *
 *  • status — approving a topic writes `status` AND `team_verdict` together, and
 *    the whole reason lib/review-vocabulary.ts is one shared object is that a
 *    surface writing one without the other desynchronises the pipeline gate from
 *    the re-rank signal. A text form editing status alone would be exactly that
 *    surface. The decision controls own it.
 *  • content_type / market — taxonomy, not text. `content_type` decides which
 *    nav destination and which table the topic belongs to and feeds
 *    `returnTarget`, so changing it mid-review re-routes the reviewer's own way
 *    back. The record drawer still edits every declared attribute, including
 *    these; this panel is the text.
 *
 * Every field is dropped unless the type DECLARES it (the same filter
 * `resolveReviewConfig` already applies to `metaAttrs` / `sourceAttrs`), and a
 * duplicate attribute — a fork that points `summaryAttr` at `subtitle`, say —
 * appears once.
 */
export function topicEditFields(
  cfg: Pick<ResolvedReview, 'titleAttr' | 'summaryAttr' | 'noteAttr'>,
  type: EntityTypeDef | null | undefined,
): TopicEditField[] {
  const declared = new Map((type?.attributes ?? []).map((a) => [a.name, a]));
  const wanted: { attr: string; label?: string; mandatory?: boolean }[] = [
    { attr: cfg.titleAttr, mandatory: true },
    { attr: SUBTITLE_ATTR },
    { attr: cfg.summaryAttr },
    { attr: cfg.noteAttr, label: NOTE_FIELD_LABEL },
  ];

  const out: TopicEditField[] = [];
  const seen = new Set<string>();
  for (const w of wanted) {
    const attr = declared.get(w.attr);
    if (!attr || seen.has(w.attr)) continue;
    seen.add(w.attr);
    out.push({
      attr: w.attr,
      label: w.label ?? humanLabel(w.attr),
      multiline: attr.dataType === 'longtext',
      mandatory: w.mandatory === true,
    });
  }
  return out;
}

/** Seed the form from a record's blob — one string per editable field. */
export function topicEditValues(
  data: Record<string, unknown> | undefined,
  fields: TopicEditField[],
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const f of fields) {
    const raw = readData(data, f.attr);
    values[f.attr] = raw == null ? '' : String(raw);
  }
  return values;
}

/**
 * The fields the reviewer actually TYPED IN — the form's values against the
 * values it was seeded with.
 *
 * WHY A SAVE WRITES THE DIFF AND NOT THE WHOLE FORM, and this is the second
 * half of the concurrency answer (bd startsim-m7fdm.2). The blob is merged onto
 * a freshly re-read record, so an attribute the form does not show — status, a
 * source, `scope_path` — already survives somebody else's concurrent edit.
 * Writing all four text fields regardless would hand that protection back for
 * the four the form DOES show: a reviewer who changed only the title would also
 * re-assert the angle as it stood when she opened the form, silently undoing a
 * colleague's rewrite of it. Writing only what she changed shrinks the clobber
 * surface to the fields she actually touched, which is the smallest it can be
 * without the conditional write startsim-jkkn7 owns.
 *
 * The BASELINE is captured when the form opens, not re-read from the record on
 * every render: a background refetch landing mid-edit would otherwise move the
 * line between "changed" and "untouched" under the reviewer's hands.
 */
export function topicEditChanges(
  fields: TopicEditField[],
  values: Record<string, string>,
  baseline: Record<string, string>,
): TopicEditField[] {
  return fields.filter((f) => (values[f.attr] ?? '').trim() !== (baseline[f.attr] ?? '').trim());
}

/**
 * The record's `name` when a title edit should carry it along, else undefined.
 *
 * FOUND IN THE BROWSER, on the deployed build of the first half of this bead
 * (PR #79): the edit saved, the panel showed it, and the TOPICS TABLE still read
 * the old words. `titleSubtitleCell` (components/record-columns.ts) renders
 * `row.name` as the leading column and FOLDS `title`/`subtitle`/`angle` into it,
 * so `data.title` has no column of its own on the content spine. Editing only
 * the attribute therefore changed a heading the reviewer was looking at and left
 * the list she was about to go back to — which is a successful-looking save that
 * does not show up where she looks next.
 *
 * THE RULE IS CONDITIONAL, and measured rather than assumed. Of 100 live topics
 * read 2026-09-23, 98 have `record.name` byte-identical to `data.title` and one
 * more has no title at all — so for practically every row the two ARE one thing
 * and a reviewer editing "Title" means both. The remaining rows have a name that
 * genuinely says something else, and lib/board-card.ts already takes the
 * position that "a `title` that has genuinely DRIFTED from the name survives,
 * which is exactly when it is worth reading". So:
 *
 *   rename when the stored title EQUALS the name (they were one thing), or when
 *   there is no stored title (the name WAS the title);
 *   otherwise leave the name alone.
 *
 * A blank new title never renames — {@link topicEditError} refuses it first, and
 * a record with no name at all is worse than a stale one.
 */
export function topicEditName(
  currentName: string | undefined,
  storedTitle: string,
  nextTitle: string,
): string | undefined {
  const name = (currentName ?? '').trim();
  const stored = storedTitle.trim();
  const next = nextTitle.trim();
  if (next === '' || next === name) return undefined;
  if (stored !== '' && stored !== name) return undefined; // deliberately different — leave it
  return next;
}

/**
 * What is wrong with the form, in words, or null.
 *
 * ONE RULE, AND IT IS THIS FORM'S OPINION RATHER THAN THE SCHEMA'S: a blank
 * title is refused. No attribute on this tenant's topic type is `required`
 * (read off the live schema 2026-09-23), so the tenant would accept the save —
 * and `writeData` treats a blank value as a DELETE, so `title` would be removed
 * and every surface would silently fall back to `record.name`, a string nobody
 * edits and which still holds the original. That is a worse outcome than a
 * refusal, and a reviewer who genuinely wants a topic with no title still has
 * the record drawer. Nothing else is refused: clearing a subtitle, an angle or a
 * note means clearing it, exactly as the drawer already does.
 */
export function topicEditError(
  fields: TopicEditField[],
  values: Record<string, string>,
): string | null {
  for (const f of fields) {
    if (f.mandatory && (values[f.attr] ?? '').trim() === '') return EMPTY_TITLE_ERROR;
  }
  return null;
}

/**
 * The PATCH body for a topic text edit: the FULL blob, with only the named
 * attributes moved, under the spellings the tenant stores, stamped with who did
 * it.
 *
 * @param source the record's `data` AS THE SERVER JUST RETURNED IT. Not the blob
 *   the page loaded — see the module header on startsim-m7fdm.2. The edit log is
 *   read from this same object, so a save never writes back a log older than the
 *   blob it is merging onto.
 * @param declaredNames `type.attributes.map(a => a.name)`, for the re-key pass
 * @param changed the fields the reviewer actually typed in — {@link topicEditChanges}.
 *   Everything else is left exactly as `source` had it.
 * @param by the editor's email; absent records the edit unattributed
 */
export function topicEditData(
  source: Record<string, unknown> | undefined,
  declaredNames: Iterable<string>,
  changed: TopicEditField[],
  values: Record<string, string>,
  by: string | null | undefined,
): { data: Record<string, unknown>; history: EditEntry[] } {
  let next: Record<string, unknown> = { ...(source ?? {}) };
  for (const f of changed) {
    // `writeData` removes every other spelling of the attribute and deletes it
    // outright on a blank — the drawer's behaviour, deliberately shared.
    next = writeData(next, f.attr, (values[f.attr] ?? '').trim());
  }
  // Repairs a row already carrying `source1` on its way past, exactly as every
  // other whole-blob write in this app does.
  next = declaredBlob(next, declaredNames);
  return withEditStamp(next, readEditHistory(source), by);
}
