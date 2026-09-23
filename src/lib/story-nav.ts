/**
 * Where a topic decision takes the reviewer, and how it gets back (bd startsim-z384k).
 *
 * THE SHAPE QUINN PICKED (design gate startsim-w4txa, 2026-09-22, verbatim):
 * "instead of the modal popup section, once the topic gets accepted we go
 * straight to the draft detail page where the top contains the stuff about the
 * topic that we have in the modal so its all just 1 page experience."
 *
 * So approving a topic NAVIGATES. Two routes carry that:
 *
 *   /story/<topicId>   the dispatcher. A freshly approved topic has no draft for
 *                      ~2 minutes (the n8n writer), and "go straight to the draft
 *                      detail page" has nowhere to go during that window. This is
 *                      that window, rendered honestly, and it redirects into the
 *                      draft the moment there is exactly one.
 *   /draft/<draftId>   the already-shipped two-pane workspace (startsim-768w.16.15),
 *                      unchanged in size and layout, now with the topic context at
 *                      the top.
 *
 * WHY A `from` PARAM AND NOT AN ALLOWLIST. lib/view-toggle.ts carries a strict
 * allowlist of params between /t and /board because it answers a DIFFERENT
 * question — "the same records, laid out the other way" — where a param that
 * means nothing on the far side must not travel. This answers "put me back
 * exactly where I was", which is the whole location or nothing: the meeting
 * asked for back navigation to return to the topic table with its scope intact,
 * and a reviewer who had narrowed to Kind=Evergreen, State=suggested wants all
 * of it back. So the whole path+query rides along, opaque.
 *
 * IT IS VALIDATED, because it is a string from the address bar being turned into
 * a link. `safeReturnPath` accepts only a same-origin relative path under one of
 * the two list routes; everything else — an absolute url, a protocol-relative
 * host, a backslash, a route that is not a list — is refused and the caller
 * falls back to the content-kind table. An unvalidated `from` is an open redirect.
 */

import { CONTENT_TYPE_KEY, contentCategoryLabel, contentTabHref } from './content';

/** The query param carrying "where I came from". */
export const FROM_PARAM = 'from';

/** The list routes a reviewer can legitimately be sent back to. */
const RETURN_PREFIXES = ['/t/', '/board/'] as const;

/**
 * Control characters, DEL and the backslash — none of them belongs in a path
 * this app re-emits as an href. Tested by CHAR CODE rather than written as a
 * regex character class: the literal class would put real control bytes in this
 * source file, which makes git treat it as binary and every diff unreadable.
 */
function isUnsafePathChar(code: number): boolean {
  return code < 0x20 || code === 0x7f || code === 0x5c;
}

/**
 * The reviewer's own location, as the string to hand forward. Pure so the two
 * callers (the table and the board) cannot spell it differently.
 */
export function currentReturnPath(pathname: string, search: string): string {
  const qs = search.startsWith('?') ? search : search ? `?${search}` : '';
  return `${pathname}${qs}`;
}

/**
 * A `from` value that is safe to render as an href, or null.
 *
 * Deliberately strict rather than clever: no absolute urls (they would leave the
 * app), no protocol-relative `//host` (same escape), no backslash (browsers
 * normalise some backslash forms to `/`), and the path has to be one of the two
 * list routes — a `from` pointing at /draft or /actions is not a place "back"
 * means.
 */
export function safeReturnPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = String(raw);
  if (value.length > 2048) return null;
  for (let i = 0; i < value.length; i++) {
    if (isUnsafePathChar(value.charCodeAt(i))) return null;
  }
  if (!value.startsWith('/')) return null;
  if (value.startsWith('//')) return null;
  const path = value.split(/[?#]/)[0];
  return RETURN_PREFIXES.some((p) => path.startsWith(p)) ? value : null;
}

function withFrom(base: string, from?: string | null): string {
  const safe = safeReturnPath(from);
  return safe ? `${base}?${FROM_PARAM}=${encodeURIComponent(safe)}` : base;
}

/** The story page for a topic — where every approve lands. */
export function storyHref(topicId: number | string, from?: string | null): string {
  return withFrom(`/story/${encodeURIComponent(String(topicId))}`, from);
}

/** The draft workspace, carrying the return path on through. */
export function draftHref(draftId: number | string, from?: string | null): string {
  return withFrom(`/draft/${encodeURIComponent(String(draftId))}`, from);
}

export interface ReturnTarget {
  href: string;
  label: string;
}

/**
 * The back link: where it goes and what it says.
 *
 * The label is computed WITH the href, not beside it — startsim-uhmk was exactly
 * this bug on this exact link (it read "... board" while pointing at the table),
 * and the cheapest way not to repeat it is to make the two impossible to set
 * independently. The default is the topic TABLE, which is what the 2026-09-08
 * meeting asked for; a reviewer who arrived from the board still gets the board.
 */
export function returnTarget(from: string | null | undefined, contentType: string): ReturnTarget {
  const safe = safeReturnPath(from);
  if (safe) {
    const path = safe.split(/[?#]/)[0];
    return {
      href: safe,
      label: path.startsWith('/board/') ? 'Back to the board' : 'Back to topics',
    };
  }
  return {
    href: contentType ? contentTabHref(contentType) : `/t/${CONTENT_TYPE_KEY}`,
    label: contentType ? `Back to ${contentCategoryLabel(contentType)}` : 'Back to topics',
  };
}
