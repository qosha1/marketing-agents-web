/**
 * RED STUB (bd startsim-d0j7d) — the Drafts default view.
 * Bodies land with startsim-f4lac; today the table has no default at all.
 */
export const TOPIC_GATE_PARAM = 'topic';
export const DRAFTS_DEFAULT_DAYS = 0;

export interface ViewChip {
  param: string;
  value: string;
  label: string;
}

export function draftsViewChips(
  _params: Record<string, string | undefined | null>,
  _now?: Date,
): ViewChip[] {
  return [];
}

export function clearedDraftsView(): Record<string, string> {
  return {};
}

export function draftsViewFilters(
  _params: Record<string, string | undefined | null>,
  _approvedTopicIds: string[],
): Record<string, string> {
  return {};
}
