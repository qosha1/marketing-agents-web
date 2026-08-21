/**
 * The draft status vocabulary OGMC actually uses (bd startsim-wn2p.1 / .2).
 *
 * STUB — every export throws until startsim-wn2p.2 declares the enum. The RED
 * suite keys its `it.fails` markers on {@link DraftStatusNotImplementedError},
 * so it arms itself and disarms itself; nothing has to be deleted to go green.
 *
 * WHY THIS FILE EXISTS. The team's "Content tracker/pipeline workflow" diagram
 * names six states per language, and only ONE of them matches what the tenant
 * declares today:
 *
 *   team wants   ready for review · under review · approved · rejected ·
 *                not for publication now · for repurpose
 *   declared     drafting · ready · needs_revision · approved · sent
 *
 * The dangerous overlap is `ready`. Today it means "ready to post" — a human
 * has approved it — while the team's `ready for review` means the opposite:
 * nobody has looked at it yet. Migrating `ready` to `ready_for_review` on the
 * strength of the shared word would silently un-approve finished work, so the
 * mapping lives in wn2p.2 as data, and this module never guesses it.
 *
 * Shape follows `content.ts`: this file is the LABEL and ORDER source, and
 * MEMBERSHIP is read from the live schema — a status the tenant declares but
 * this file does not name still renders, and one this file names but the tenant
 * does not declare is reported as missing rather than silently assumed.
 */

/** Thrown by every export while this module is still a stub. */
export class DraftStatusNotImplementedError extends Error {
  constructor(what: string) {
    super(`${what} is not implemented — bd startsim-wn2p.2`);
    this.name = 'DraftStatusNotImplementedError';
  }
}

/** The enum attribute carrying a draft's review state. */
export const STATUS_ATTR = 'status';

export interface DraftStatus {
  /** The enum value as declared in the schema. */
  key: string;
  /** The team's own words for it, from the diagram. */
  label: string;
  /**
   * A state the piece does not leave under its own power: the work is finished,
   * shelved, or set aside for reuse. The diagram sends exactly these to the
   * language's content repository and drops them from the tracker.
   */
  terminal: boolean;
}

/** Pipeline order, top to bottom, as the diagram draws it. */
export function draftStatuses(): DraftStatus[] {
  throw new DraftStatusNotImplementedError('draftStatuses');
}

/** The team's wording for a key; a key we don't name still gets a readable label. */
export function draftStatusLabel(_key: string): string {
  throw new DraftStatusNotImplementedError('draftStatusLabel');
}

/** True for rejected / not-for-publication-now / for-repurpose. */
export function isTerminalStatus(_key: string): boolean {
  throw new DraftStatusNotImplementedError('isTerminalStatus');
}

/** The status values the TENANT declares, in schema order. Membership, not labels. */
export function declaredDraftStatuses(
  _type: { attributes?: { name: string; config?: { choices?: unknown } }[] } | null | undefined,
): string[] {
  throw new DraftStatusNotImplementedError('declaredDraftStatuses');
}

/**
 * Which required values the live schema fails to declare.
 *
 * This is the gap made checkable. Empty means the tenant can express every state
 * the team's workflow needs; non-empty names exactly what is missing, so the
 * failure reads as a list of states rather than "the enum is wrong".
 */
export function missingRequiredStatuses(
  _type: { attributes?: { name: string; config?: { choices?: unknown } }[] } | null | undefined,
): string[] {
  throw new DraftStatusNotImplementedError('missingRequiredStatuses');
}
