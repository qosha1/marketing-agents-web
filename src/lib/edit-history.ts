/**
 * Who edited this record, and when (bd startsim-j9rxf).
 *
 * The 2026-09-08 touch base asked for "an edit history log showing who made a
 * change and when, providing basic accountability". This is that log and only
 * that log: it answers WHO TOUCHED THIS AND WHEN, never WHAT THEY CHANGED. Real
 * track changes is a separate, later, riskier piece of work (bd startsim-b3twa,
 * deferred on the call because legal content is going through this pipeline) —
 * do NOT grow a diff here. `packages/ui` DiffViewer and lib/blog-diff.ts already
 * exist and are the seed of THAT feature; nothing in this module touches them.
 *
 * THE SIBLING RELATIONSHIP. lib/draft-origin.ts says where a record CAME FROM
 * (`data._origin` / `_trigger` / `_triggered_by`, rendered as the "Created by"
 * column). This is the same idea one step later in the record's life: creation
 * provenance is stamped by the n8n writer, edit provenance is stamped by the app
 * on every write a person makes. Read that module's header first — the wire
 * conventions and the "rendered, not filtered" rule below both come from it.
 *
 * ── THE PROBLEM THIS EXISTS TO SOLVE: THE AUTOSAVE ──────────────────────────
 *
 * The draft editor autosaves on a 1200ms debounce (BlogSection, and the shared
 * DocumentEditor it mirrors). A reviewer working through a 500-word blog issues
 * DOZENS of PATCHes. One row per PATCH is not accountability, it is a wall of
 * near-identical timestamps that nobody reads — and the wall is worse than
 * nothing, because it hides the one thing the customer asked for.
 *
 * So consecutive saves BY THE SAME PERSON inside {@link COLLAPSE_WINDOW_MS}
 * collapse into ONE entry that grows: `from` stays at the first save, `at`
 * advances to the latest, `saves` counts how many were folded in.
 *
 * WHY FIVE MINUTES. Not because five is special — because of where the gaps
 * actually fall. Inside one sitting at the keyboard the gaps are SECONDS (the
 * debounce is 1.2s and typing is continuous), so almost any window kills the
 * autosave noise. What a window has to get right is the other side: the smallest
 * gap that means "she stopped, and came back". Five minutes is comfortably longer
 * than reading a rendered preview or fixing an issue in the rail, and comfortably
 * shorter than leaving the desk. Longer windows only merge sittings that really
 * were separate, which is a loss of truth for no gain in quiet.
 *
 * AND IT IS ONE NUMBER. The open question from the call — one line per save, or
 * one per session? — is settled by Jurga's workflow document (bd startsim-ldayj),
 * which had not arrived when this shipped. It does not need a redesign either
 * way: per-save is this constant set to 0, per-session is it set higher. Nothing
 * else in this module knows the answer.
 *
 * THE COLLAPSE ASSUMES ONE THING, stated so it is not a surprise: two adjacent
 * UNATTRIBUTED saves inside the window are treated as the same sitting, because
 * an unresolved editor is a session-wide condition (whoami unavailable), not a
 * per-save coin flip. It is the same rule as for a named editor — same `by`,
 * including no `by` at all — rather than a special case.
 *
 * ── IDENTITY IS THE EMAIL ───────────────────────────────────────────────────
 *
 * `whoami` returns `{sub, email, companyId, orgId, role}` and no display name, so
 * the real choice is email or a `sub` UUID, and `1c44a170-eee3-…` answers "who?"
 * with a string no reader can resolve — which is the entire question this log
 * exists for. Same decision, for the same reason, as the "Generate drafts" relay
 * (see app/actions/generate-drafts/route.ts). One line to change if the customer
 * ever wants it shortened.
 *
 * AN UNKNOWN EDITOR IS STILL AN EDIT. When the email cannot be resolved the entry
 * is recorded WITHOUT a `by` rather than skipped: losing the fact that the record
 * was touched is a worse lie than not knowing who touched it. Absence reads as
 * "not recorded", never as a person with a blank name — matching the writer,
 * which omits `_triggered_by` rather than stamping an empty string.
 *
 * ── WIRE SHAPE, AND THE TWO TRAPS ───────────────────────────────────────────
 *
 * 1. THE SCHEMA TRAP. This is stamped inside the `data` blob and is RENDERED,
 *    NEVER FILTERED. `_edit_history` is not a declared attribute on the draft
 *    type, and this tenant answers a filter over an undeclared attribute by
 *    APPLYING it and matching nothing — `count: 0`, indistinguishable from a
 *    filter that legitimately found nothing (bd startsim-8hgmq.4, and again in
 *    .11). So: NEVER add `?attr._edit_history=…`, or any client filter that
 *    round-trips through one, until the attribute is declared on the type AND
 *    `redenormalize_attributes` has been run. Sorting and grouping happen in the
 *    browser, over rows that were fetched for another reason.
 *
 * 2. THE SPELLING. The shared API client camelCases every response key and
 *    snake_cases every request key, RECURSIVELY — including inside the `data`
 *    blob. So the row stores `_edit_history` and the client hands it back as
 *    `EditHistory`. A patch body must therefore be written under
 *    {@link EDIT_HISTORY_PATCH_KEY}, the camel form: `mergedData()` spreads the
 *    blob it was handed, so writing the snake form alongside it leaves BOTH keys
 *    in the object, they collide on the wire, and only key order decides which
 *    survives. (Exactly why the draft page writes `sourceMeta` in camel.) Every
 *    key INSIDE an entry is a single lowercase word — `by`, `from`, `at`,
 *    `saves` — so it round-trips through both transforms untouched. Do not add a
 *    multi-word key here without checking what it becomes in both directions.
 *
 * ── TWO LIMITS THIS LOG INHERITS AND CANNOT FIX ─────────────────────────────
 *
 * ── WHY `human_edited` IS NOT THIS, THOUGH IT LOOKS LIKE IT ────────────────
 *
 * The backend already maintains `EntityRecord.humanEdited`, shaped
 * `{data: {<field>: {at, sub}}}` — a timestamp and a user id per field. It reads
 * like the answer, and lib/draft-origin.ts already parses it (throwing the `at`
 * and `sub` away and keeping only the field names). It was reconsidered as the
 * basis for this log and rejected on MEASURED evidence, not preference. Four
 * separate saves to one live draft (2026-09-09, tenant marketing-agents) left it
 * looking like this:
 *
 *   blog        { at: 18:03:53, sub: 9adeea3b-… }   <- ONE timestamp, not four
 *   seo         { at: 18:03:45, sub: 9adeea3b-… }
 *   linkedin    { at: 18:03:45, sub: 9adeea3b-… }
 *   notes/review/sources/source_meta …  all marked, none of them typed in
 *
 * Three things that map says, and each of them breaks an accountability log:
 *
 *   • IT KEEPS ONLY THE LATEST. Four saves produced one `at` per field. There is
 *     no earlier touch to read and no second person to see. A map of last-touch
 *     per field cannot answer "what happened to this draft", which is the
 *     question that was asked.
 *   • IT MARKS FIELDS NOBODY TOUCHED. Only the blog was typed into, yet seo,
 *     linkedin, notes, review, sources and source_meta are all marked — because
 *     the PATCH replaces the whole blob and the mark records that the ENDPOINT
 *     wrote a key. draft-origin.ts already says this out loud: it is an endpoint
 *     distinction, never a claim that a person typed the value, which is also
 *     why a machine writing through the same endpoints gets marked.
 *   • IT NAMES A UUID. `sub` is `9adeea3b-c2db-4c87-9117-6c6f10c24ba9`, which
 *     answers "who?" with a string no reader can resolve — the very failure the
 *     email decision above exists to avoid, and it needs a roster lookup that
 *     does not resolve service identities at all.
 *
 * So it is not a duplicate implementation (rule 1) — it is a different fact. It
 * stays useful as an independent CROSS-CHECK on these timestamps, and nothing
 * more.
 *
 * The backend PATCH REPLACES the whole `data` blob (no deep merge), so two people
 * editing the same draft at once already overwrite each other's TEXT. This log
 * rides in that same blob and will lose entries the same way. That is
 * pre-existing, not introduced here — but a log whose whole job is accountability
 * has to say so out loud rather than imply a completeness it does not have. Filed
 * as bd startsim-m7fdm.2; the fix is a conditional write or a server-side merge,
 * NOT optimistic concurrency on the log alone (that would protect the record of
 * the edits while the edits themselves still vanish).
 *
 * IT COVERS TWO WRITE PATHS, and both go through {@link withEditStamp}: the
 * draft review page's `mergedData()`, and the generic record drawer's "Edit
 * fields" (components/entity-detail-drawer), added for bd startsim-m7fdm.3 — a
 * reviewer can change a headline or a status from the /t/<type> table without
 * ever opening /draft/<id>, and that edit used to be invisible in the log.
 *
 * THE DRAWER IS GENERIC OVER EVERY ENTITY TYPE, so stamping there means topic,
 * news_item, scope, client and source rows now carry `_edit_history` too. That is
 * deliberate and it is the honest shape: the log answers "who touched this record
 * and when", which is a true and useful fact about any record. Only the draft
 * review page RENDERS it today; nothing filters on it (see THE SCHEMA TRAP).
 *
 * ONE WRITE PATH IS STILL DELIBERATELY UNSTAMPED, do not "fix" it: a board lane
 * move (components/entity-board). `laneMoveData` reasons at length that a drag
 * writes the status and ONLY the status, because a drag says "put this in that
 * lane", not "I judge this good". Its effect is already visible in the status.
 * A documented boundary is not a lie; a silent one is.
 *
 * Generic on purpose (rule 9): it reads a data blob, not a draft. It stays
 * fork-local for the same reason lib/draft-origin.ts does — this app consumes
 * `@startsimpli/ui` as a PUBLISHED package, so shared logic costs a meta-repo
 * PR + a publish + a version bump before it can be used here. What IS shared is
 * already shared: the panel renders through the `ActivityTimeline` /
 * `ActorIdentity` primitives instead of a second timeline. Extraction when a
 * second tenant wants it — bd startsim-m7fdm.1.
 */
import { readData } from '@/lib/board';
import type { EntityRecord } from '@/lib/foundry-api';

/** The key as it lands in the row's `data` JSONB. Read/write via the constants
 *  below — never hand-roll a second spelling. */
export const EDIT_HISTORY_ATTR = '_edit_history';

/**
 * The spelling to WRITE into a patch body — the camel form the API client both
 * returns and converts back to {@link EDIT_HISTORY_ATTR} on the way out. Writing
 * the snake form into a body that also spreads the client's blob leaves two keys
 * that collide on the wire; see the header.
 */
export const EDIT_HISTORY_PATCH_KEY = 'EditHistory';

/**
 * How close two saves by the same person have to be to count as one sitting.
 *
 * THE ONE NUMBER. 0 gives a row per save; a bigger number gives a row per visit.
 * See the header for why five minutes, and bd startsim-ldayj for the input that
 * may move it.
 */
export const COLLAPSE_WINDOW_MS = 5 * 60 * 1000;

/**
 * How many entries a record keeps. The blob is re-sent whole on every PATCH, so
 * an unbounded log would grow the cost of every save on a long-lived draft. The
 * NEWEST entries are the ones kept — an accountability question is almost always
 * "who touched this recently", and the oldest touches are the ones a reader has
 * already stopped caring about.
 */
export const MAX_EDIT_ENTRIES = 50;

/** One sitting: a person, when they started, when they last saved, how many
 *  saves were folded in. `by` is absent when the editor could not be resolved. */
export interface EditEntry {
  /** The editor's email. Absent means NOT RECORDED, never "anonymous". */
  by?: string;
  /** ISO-8601 — the first save of this sitting. */
  from: string;
  /** ISO-8601 — the latest save of this sitting. */
  at: string;
  /** How many saves collapsed into this entry. At least 1. */
  saves: number;
}

/** A non-blank trimmed string, or undefined. Anything else is absence. */
function editor(by: unknown): string | undefined {
  if (typeof by !== 'string') return undefined;
  const trimmed = by.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** An ISO instant we can actually order by, or undefined. */
function instant(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : value;
}

/**
 * The stored log, read defensively.
 *
 * Anything that is not an array of timestamped objects reads as "no history" —
 * never as a crash. A blob is written by more than this app (the n8n writer owns
 * most of it), so an unexpected shape here is a thing to survive, not a thing to
 * assume away. An entry missing `from` or `saves` is REPAIRED rather than
 * dropped: the timestamp is the load-bearing part.
 */
export function readEditHistory(data: EntityRecord['data'] | undefined): EditEntry[] {
  const raw = readData(data, EDIT_HISTORY_ATTR);
  if (!Array.isArray(raw)) return [];

  const entries: EditEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const at = instant(row.at);
    if (!at) continue;
    const by = editor(row.by);
    const saves = typeof row.saves === 'number' && row.saves >= 1 ? Math.floor(row.saves) : 1;
    entries.push({ ...(by ? { by } : {}), from: instant(row.from) ?? at, at, saves });
  }
  return entries;
}

/**
 * Fold one save into the log.
 *
 * Pure: it returns the next history and mutates nothing, so the caller can drop
 * it straight into a patch body. The result is oldest-first and capped at
 * {@link MAX_EDIT_ENTRIES}.
 *
 * @param history the log as {@link readEditHistory} returned it
 * @param by      the caller's email; blank/absent records the edit unattributed
 * @param at      when the save happened, ISO-8601 (defaults to now)
 * @param windowMs how close counts as the same sitting — see {@link COLLAPSE_WINDOW_MS}
 */
export function recordEdit(
  history: EditEntry[],
  by: string | null | undefined,
  at: string = new Date().toISOString(),
  windowMs: number = COLLAPSE_WINDOW_MS,
): EditEntry[] {
  const who = editor(by);
  const when = instant(at);
  // A save we cannot place in time is not a log entry — it would sort anywhere
  // and say nothing. Leave the history exactly as it was.
  if (!when) return history;

  const last = history[history.length - 1];
  // Same person (including the same absence of one) AND close enough to be the
  // same sitting. `>= 0` guards a clock that went backwards: an out-of-order
  // save extends the entry rather than opening one that appears to precede it.
  const sameSitting =
    last !== undefined &&
    last.by === who &&
    Date.parse(when) - Date.parse(last.at) <= windowMs &&
    Date.parse(when) - Date.parse(last.at) >= 0;

  const next = sameSitting
    ? [...history.slice(0, -1), { ...last!, at: when, saves: last!.saves + 1 }]
    : [...history, { ...(who ? { by: who } : {}), from: when, at: when, saves: 1 }];

  return next.length > MAX_EDIT_ENTRIES ? next.slice(next.length - MAX_EDIT_ENTRIES) : next;
}

/**
 * Fold one save into a log AND into the blob that is about to be PATCHed.
 *
 * THE POINT IS THAT THERE IS EXACTLY ONE OF THESE. Both write paths in this app
 * stamp through here — the draft review page's `mergedData()` and the generic
 * record drawer's "Edit fields" — because a second hand-rolled stamp is how the
 * two surfaces came to disagree in the first place (bd startsim-m7fdm.3: an edit
 * made from the /t/<type> table never reached the log at all).
 *
 * THE CALLER SUPPLIES THE HISTORY rather than having it read out of `data`,
 * because the two surfaces hold it differently and both are right. The draft page
 * advances an in-memory log OPTIMISTICALLY across a burst of debounced autosaves,
 * so re-reading the blob would fold every save of a burst onto the same stale
 * base. The drawer saves once from a freshly-opened record, so it reads the blob.
 *
 * The key is the CAMEL spelling ({@link EDIT_HISTORY_PATCH_KEY}) because `data`
 * here is the client's camelised blob; writing the snake form alongside it leaves
 * two keys that collide on the wire. See the header.
 */
export function withEditStamp(
  data: Record<string, unknown>,
  history: EditEntry[],
  by: string | null | undefined,
  at: string = new Date().toISOString(),
): { data: Record<string, unknown>; history: EditEntry[] } {
  const next = recordEdit(history, by, at);
  return { data: { ...data, [EDIT_HISTORY_PATCH_KEY]: next }, history: next };
}

/** The newest sitting, or undefined when the record has never been edited. */
export function lastEdit(history: EditEntry[]): EditEntry | undefined {
  return history[history.length - 1];
}

/**
 * What the entry collapsed, in words.
 *
 * A collapsed entry MUST say it is a collapse. A bare timestamp over twelve folded
 * saves quietly claims a precision it does not have — the reader should be able to
 * see that this was a sitting, not a keystroke. Locale-free on purpose: the
 * absolute time is rendered by the timeline, this is only the shape of the sitting.
 */
export function editSummary(entry: EditEntry): string {
  if (entry.saves <= 1) return '1 save';
  const minutes = Math.floor((Date.parse(entry.at) - Date.parse(entry.from)) / 60_000);
  return minutes >= 1 ? `${entry.saves} saves over ${minutes} min` : `${entry.saves} saves`;
}
