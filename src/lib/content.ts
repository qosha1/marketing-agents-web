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
  { key: 'lead_magnet', label: 'Lead Magnets' },
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

export function contentCategoryLabel(key: string): string {
  return CONTENT_CATEGORIES.find((c) => c.key === key)?.label ?? key;
}
