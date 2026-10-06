/**
 * The version this app last SAW for a record — so every write can assert one
 * (bd startsim-j19hf; server bd startsim-3c2wc; design bd startsim-j4kx6 §6).
 *
 * ── WHY A REGISTRY AND NOT A PROP ───────────────────────────────────────────
 *
 * "Send the version on every write path" is the bead's ask, and the honest way
 * to make it TRUE rather than ENUMERATED is to put it at the seam every write in
 * this app already passes through: `foundry-api.updateEntity`. That file makes
 * the argument for itself about key spelling — "this is the one seam every write
 * in this app passes through, INCLUDING the writes inside @startsimpli/ui" — and
 * it is the same argument here, for a stronger reason: most of this app's writes
 * are issued by shared components whose `CollectionClient.updateEntity(id,
 * input)` signature has no room for a precondition and cannot grow one without a
 * meta-repo PR, a publish and a bump. The review drawer, the inline review
 * actions, the draft review workspace, the board's lane move and the record
 * drawer all write through that two-argument call.
 *
 * So a read REMEMBERS the version it saw and a write ASSERTS it. The draft page,
 * which needs the conflict dialog and therefore owns its own version through
 * `useConditionalSave`, passes its precondition explicitly and bypasses this —
 * see {@link EntityWriteOptions} in foundry-api.ts, and the hazard note below.
 *
 * ── THE HAZARD THIS EXISTS TO AVOID ────────────────────────────────────────
 *
 * `apps/api/preconditions.enforce` checks BOTH `If-Match` AND `expected_version`
 * rather than the first it finds, and refuses if EITHER disagrees. So a request
 * that carried a registry-derived precondition ALONGSIDE a hook-derived one
 * would refuse ITSELF the moment a background list refetch moved one of them —
 * with a 412 indistinguishable from a real conflict. There is therefore exactly
 * ONE source of a precondition per request, decided by one `if`, and never a
 * merge of two.
 *
 * ── A STALE ENTRY IS A CORRECT REFUSAL, NOT A BUG ──────────────────────────
 *
 * The version here is as old as the read that produced it. A table fetched ten
 * minutes ago leaves a ten-minute-old version, so a drawer edit over that row is
 * refused if anybody changed it since. That is the right answer and not a
 * limitation: the blob the drawer is about to PATCH is ALSO from that read, and
 * the backend replaces `data` wholesale, so sending it would destroy whatever
 * landed in between. The refusal is the feature.
 *
 * ── AND IT FAILS TOWARD SENDING NOTHING ────────────────────────────────────
 *
 * An id this has never seen writes UNGUARDED, exactly as the app did before. The
 * server is enforce-when-present / optional-when-absent for a reason
 * (`preconditions.py`: a hard requirement would 412 every production caller on
 * the first request after the roll), and a guard that can make a save impossible
 * is a worse bug than the overwrite it prevents. The trail records such a write
 * as `precondition: "none"`, so an unguarded path is VISIBLE rather than silent.
 *
 * Not in `@startsimpli/ui` because what it holds is this app's own in-flight
 * read state, not reusable logic: the shared halves of this feature — the
 * precondition spelling, the 412 parse, the conflict hook, the dialog and the
 * history panel — are all consumed from `@startsimpli/ui/history` (rule 9).
 */
import { versionFromRecord } from '@startsimpli/ui/history';

/** `String(id) -> the version the last read or write reported.` */
const seen = new Map<string, number>();

/**
 * Note the version carried by a record payload. Anything without a readable
 * integer `version` is IGNORED rather than recorded as absent — a tenant build
 * that predates the trail serves no `version` at all, and forgetting a version
 * we already hold because one response omitted it would silently unguard the
 * next write.
 */
export function rememberVersion(id: number | string, record: unknown): void {
  const version = versionFromRecord(record);
  if (version === undefined) return;
  seen.set(String(id), version);
}

/** Note every row of a list response. */
export function rememberVersions(records: readonly unknown[] | undefined): void {
  for (const record of records ?? []) {
    const id = (record as { id?: unknown } | null)?.id;
    if (id === undefined || id === null) continue;
    rememberVersion(id as number | string, record);
  }
}

/** The version to assert for this record, or `undefined` for "we never saw one". */
export function heldVersion(id: number | string): number | undefined {
  return seen.get(String(id));
}

/** Drop everything. Tests only — a tab's registry lives as long as the tab. */
export function resetHeldVersions(): void {
  seen.clear();
}
