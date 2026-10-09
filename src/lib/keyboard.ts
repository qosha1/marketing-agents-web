/**
 * Single-key shortcut guards for the draft review (bd 768w.16.15.3).
 *
 * The review page hangs bare-key shortcuts ([ / ] step the queue) on a page that
 * is mostly TEXT ENTRY — the blog editor, the add-a-source input. Firing while
 * the reviewer types would yank them to another draft mid-sentence, so the guard
 * IS the feature, not a detail of it.
 *
 * Pure and duck-typed over the event (no DOM types at runtime) so it stays testable
 * in vitest's node environment.
 */

/** The bit of an event target we need in order to ask "is the user typing?". */
export interface TypingTarget {
  tagName?: string;
  isContentEditable?: boolean;
}

/** The bit of a KeyboardEvent a shortcut decision depends on. */
export interface ShortcutEventLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  target?: unknown;
}

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** True when the event target takes typed input (form control or contenteditable). */
export function isTypingTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as TypingTarget;
  if (el.isContentEditable === true) return true;
  return typeof el.tagName === 'string' && TYPING_TAGS.has(el.tagName.toUpperCase());
}

/**
 * True when a bare-letter shortcut must NOT fire.
 *
 * Shift is deliberately allowed through — a shifted key is a different `key`
 * anyway so it can't collide. Any of cmd/ctrl/alt
 * means the reviewer is reaching for a browser or OS command, never for ours.
 */
export function shouldIgnoreShortcut(event: ShortcutEventLike): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return true;
  return isTypingTarget(event.target);
}

/** What a draft-page shortcut does. */
export type DraftShortcut = { kind: 'queue'; delta: 1 | -1 };

/**
 * The draft page's key map, or null for a key that is not ours.
 *
 * Only [ / ] (step the review queue) are left. j / k walked the failing checks,
 * a / x set the decision and ? showed the legend in the decision card; all of
 * those went with the Checks section and the decision (bd startsim-m7fdm.25).
 */
export function draftShortcut(key: string): DraftShortcut | null {
  if (key === ']') return { kind: 'queue', delta: 1 };
  if (key === '[') return { kind: 'queue', delta: -1 };
  return null;
}
