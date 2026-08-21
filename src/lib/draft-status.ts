/**
 * The draft status vocabulary OGMC actually uses (bd startsim-wn2p.1 / .2).
 *
 * WHY THIS FILE EXISTS. The team's "Content tracker/pipeline workflow" diagram
 * names six states per language, and only ONE of them matched what the tenant
 * declared before wn2p.2:
 *
 *   team wants   ready for review · under review · approved · rejected ·
 *                not for publication now · for repurpose
 *   declared     drafting · ready · needs_revision · approved · sent
 *
 * The dangerous overlap was `ready`. It meant "ready to post" — a human had
 * approved it — while the team's `ready for review` means the opposite: nobody
 * has looked at it yet. Migrating `ready` to `ready_for_review` on the strength
 * of the shared word would have silently un-approved finished work, so the live
 * migration mapped `ready`/`sent` -> `approved` and `drafting`/blank ->
 * `ready_for_review`, and this module never guesses that mapping: it only names
 * the target vocabulary.
 *
 * Shape follows `content.ts`: this file is the LABEL and ORDER source, and
 * MEMBERSHIP is read from the live schema — a status the tenant declares but
 * this file does not name still renders, and one this file names but the tenant
 * does not declare is reported as missing rather than silently assumed.
 */

/**
 * Thrown while this module is a stub.
 *
 * wn2p.2 implemented every export, so nothing throws this today. It stays
 * exported because the RED suite keys its `it.fails` markers on the type, and
 * `draft-status.fixtures.test.ts` asserts the class is constructible — the
 * check that the markers are pointed at a real module rather than passing by
 * accident. Deleting it would disarm that guard, not tidy it away.
 */
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

/**
 * Pipeline order, top to bottom, as the diagram draws it: the two review states
 * first, then the four dispositions a human picks between at stages 3 and 6.
 *
 * LABEL NOTE (wn2p.2): the diagram writes "Not for publication now" and the
 * team's spreadsheet writes "Not for publication". The longer wording is used
 * here because the diagram is the artifact the enum keys were snake_cased from
 * and `not_for_publication_now` is now declared live; if the team confirms the
 * sheet's shorter wording, it is a label change here and NOT a key change.
 */
const STATUSES: DraftStatus[] = [
  { key: 'ready_for_review', label: 'Ready for review', terminal: false },
  { key: 'under_review', label: 'Under review', terminal: false },
  // Approved is the opposite of finished: it is what FIRES the CN translation
  // (diagram stage 4), so it must never be treated as terminal.
  { key: 'approved', label: 'Approved', terminal: false },
  { key: 'rejected', label: 'Rejected', terminal: true },
  { key: 'not_for_publication_now', label: 'Not for publication now', terminal: true },
  { key: 'for_repurpose', label: 'For repurpose', terminal: true },
];

const BY_KEY = new Map(STATUSES.map((s) => [s.key, s]));

/** Pipeline order, top to bottom, as the diagram draws it. */
export function draftStatuses(): DraftStatus[] {
  return STATUSES.map((s) => ({ ...s }));
}

/** Turn an undeclared enum key into something readable rather than raw. */
function humanize(key: string): string {
  const words = key.replace(/[_-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : '';
}

/** The team's wording for a key; a key we don't name still gets a readable label. */
export function draftStatusLabel(key: string): string {
  return BY_KEY.get(key)?.label ?? humanize(key);
}

/** True for rejected / not-for-publication-now / for-repurpose. */
export function isTerminalStatus(key: string): boolean {
  return BY_KEY.get(key)?.terminal ?? false;
}

/** A schema type def, narrowed to the part this module reads. */
type StatusTypeDef =
  | { attributes?: { name: string; config?: { choices?: unknown } }[] }
  | null
  | undefined;

/** The status values the TENANT declares, in schema order. Membership, not labels. */
export function declaredDraftStatuses(type: StatusTypeDef): string[] {
  const attr = type?.attributes?.find((a) => a.name === STATUS_ATTR);
  const choices = attr?.config?.choices;
  if (!Array.isArray(choices)) return [];
  return choices.map((c) => String(c));
}

/**
 * Which required values the live schema fails to declare.
 *
 * This is the gap made checkable. Empty means the tenant can express every state
 * the team's workflow needs; non-empty names exactly what is missing, so the
 * failure reads as a list of states rather than "the enum is wrong".
 *
 * Membership is exact-key set difference and nothing else — no fuzzy matching,
 * no synonyms. That is what makes the `ready` trap impossible to fall into: a
 * tenant declaring `ready` is still missing `ready_for_review`, because they are
 * different states that happen to share a word.
 */
export function missingRequiredStatuses(type: StatusTypeDef): string[] {
  const declared = new Set(declaredDraftStatuses(type));
  return STATUSES.map((s) => s.key).filter((key) => !declared.has(key));
}
