/**
 * The OGMC content taxonomy for marketing-agents (bd 768w.16.8).
 *
 * The three "content types" are NOT separate entity types — they are values of
 * the `content_type` enum on the existing `topic` type. `topic` is the editorial
 * spine (status pipeline: suggested → ready → rejected → written); each topic's
 * candidate drafts hang off it (draft.content_type + the `written_for` edge).
 *
 * The system-health dashboard, the grouped sidebar, and the content tabs all read
 * THIS one contract so they stay in sync. Change the taxonomy here, not in N UIs.
 */

/** The entity type that carries content_type (the editorial spine). */
export const CONTENT_TYPE_KEY = 'topic';

/** The enum attribute on that type whose values are the content categories. */
export const CONTENT_TYPE_ATTR = 'content_type';

export interface ContentCategory {
  /** The content_type enum value (matches the live schema exactly). */
  key: string;
  /** Human label for the sidebar tab + page heading. */
  label: string;
}

export const CONTENT_CATEGORIES: ContentCategory[] = [
  { key: 'weekly_brief', label: 'Weekly Briefs' },
  // OGMC calls this type "Evergreen" (confirmed by the team 2026-08-21, bd startsim-wn2p.15).
  // The STORED VALUE stays `lead_magnet` deliberately: it is written by LLM prose in two active
  // n8n agents (one of which says "use these EXACT values"), branched on by three code nodes and
  // a no-fallback Switch, and enforced by the Content Judge's LEAD-MAGNET DEPTH guardrail under a
  // hyphenated spelling. Renaming the value would silently reintroduce it every Mon/Thu run.
  { key: 'lead_magnet', label: 'Evergreen' },
  { key: 'general', label: 'General' },
];

/**
 * The route to browse one content_type: the `topic` records TABLE pre-filtered to
 * that category. Table (not board) is the primary content view now — a flat,
 * clickable data list of every instance in that kind (the board is still one click
 * away via the table's Board-view toggle). The `t/[typeKey]` route seeds its Kind
 * facet from the `content_type` query param.
 */
export function contentTabHref(categoryKey: string): string {
  return `/t/${CONTENT_TYPE_KEY}?${CONTENT_TYPE_ATTR}=${encodeURIComponent(categoryKey)}`;
}

/**
 * The route to browse one content_type as a BOARD (startsim-uhmk) — the kanban
 * pipeline pre-filtered to just that category instead of mixing all three in
 * shared status lanes. The board's own on-page category tabs use this; it's
 * the board-view sibling of contentTabHref (the table stays primary — this
 * doesn't replace it).
 */
export function contentBoardHref(categoryKey: string): string {
  return `/board/${CONTENT_TYPE_KEY}?${CONTENT_TYPE_ATTR}=${encodeURIComponent(categoryKey)}`;
}

/**
 * `weekly_brief` -> `Weekly brief`. Used only for a key the taxonomy below does
 * not name, so a content_type declared in the schema but not listed here still
 * reads as a label rather than as a raw enum value in the sidebar and headings.
 */
function humanizeKey(key: string): string {
  const words = key.replace(/[_-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

export function contentCategoryLabel(key: string): string {
  return CONTENT_CATEGORIES.find((c) => c.key === key)?.label ?? humanizeKey(key);
}

/**
 * The content_type values the TENANT actually declares, in schema order.
 *
 * Read from the live `content_type` enum rather than from CONTENT_CATEGORIES, so
 * a kind added in the schema becomes navigable with no code change — the same
 * data-driven rule the approved-source list follows (bd startsim-768w.18.14).
 * CONTENT_CATEGORIES stays as the LABEL source, not the membership source.
 */
export function declaredContentTypes(
  type: { attributes?: { name: string; config?: { choices?: unknown } }[] } | null | undefined,
): ContentCategory[] {
  const attr = (type?.attributes ?? []).find((a) => a.name === CONTENT_TYPE_ATTR);
  const choices = attr?.config?.choices;
  if (!Array.isArray(choices)) return [];
  return choices
    .map((c) => String(c))
    .filter(Boolean)
    .map((key) => ({ key, label: contentCategoryLabel(key) }));
}
