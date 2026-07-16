/**
 * Single-key shortcut guards for the draft review (bd 768w.16.15.3).
 *
 * The review page hangs bare-letter shortcuts (j/k walk the issues, a/r/x set the
 * Decision) on a page that is mostly TEXT ENTRY — the rewrite-feedback box, the blog
 * editor, the add-a-source input. Firing while the reviewer types "a fresher source"
 * would silently reject the draft, so the guard IS the feature, not a detail of it.
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
 * Shift is deliberately allowed through — the legend's own `?` is shift+/, and a
 * shifted letter is a different `key` anyway so it can't collide. Any of cmd/ctrl/alt
 * means the reviewer is reaching for a browser or OS command, never for ours.
 */
export function shouldIgnoreShortcut(event: ShortcutEventLike): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return true;
  return isTypingTarget(event.target);
}
