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
 * The route for a content tab: the `topic` status board filtered to one
 * content_type. Board (not table) because topic is a status type and the pipeline
 * is the natural "manage this content" view. The `board/[typeKey]` route reads the
 * `content_type` query param and filters the records it lays into lanes.
 */
export function contentTabHref(categoryKey: string): string {
  return `/board/${CONTENT_TYPE_KEY}?${CONTENT_TYPE_ATTR}=${encodeURIComponent(categoryKey)}`;
}

export function contentCategoryLabel(key: string): string {
  return CONTENT_CATEGORIES.find((c) => c.key === key)?.label ?? key;
}
