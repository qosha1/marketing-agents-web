/**
 * The v2 Content list's query and rows (bd startsim-8vm6a).
 *
 * Columns per Jurga, 2026-11-04: Title, Market, Assigned, Status, Scheduled. No
 * Updated column, no sub-labels, rejected never shown. Everything the server can
 * narrow or order is narrowed and ordered there (rule 8); Title and Market are
 * not server-orderable (a draft's title is the `name` column, its market lives
 * on the topic), so they are not.
 */
import { readData } from '@/lib/board';
import { contentStatusLabel, contentStatusOf, visibleStatusValues, type ContentStatus } from '@/lib/content-status';
import type { EntityFilters, EntityRecord } from '@/lib/foundry-api';
import { draftTitle } from '@/lib/topic-drafts';

export const CONTENT_PAGE_SIZE = 25;

export interface ContentColumn {
  id: 'title' | 'market' | 'assigned' | 'status' | 'scheduled';
  label: string;
}

export const CONTENT_COLUMNS: ContentColumn[] = [
  { id: 'title', label: 'Title' },
  { id: 'market', label: 'Market' },
  { id: 'assigned', label: 'Assigned' },
  { id: 'status', label: 'Status' },
  { id: 'scheduled', label: 'Scheduled' },
];

const SERVER_ORDER: Partial<Record<ContentColumn['id'], string>> = {
  status: 'attr.status',
  assigned: 'attr.assignee_name',
  scheduled: 'attr.scheduled_for',
};

/** The `order=` value for a column, or null when the server cannot order by it. */
export function serverOrder(column: string, direction: 'asc' | 'desc'): string | null {
  const attr = SERVER_ORDER[column as ContentColumn['id']];
  if (!attr) return null;
  return direction === 'desc' ? `-${attr}` : attr;
}

export interface ContentListQuery {
  search: string;
  status: ContentStatus | null;
  sortBy: string | null;
  sortDirection: 'asc' | 'desc';
  page: number;
  declaredStatuses: string[];
  /** The active project's scope path from lib/project-scope; null = All. */
  projectId?: string | null;
}

export function contentListFilters(q: ContentListQuery): EntityFilters {
  const filters: EntityFilters = { page_size: String(CONTENT_PAGE_SIZE) };
  // `__in` over the visible values is how "not rejected" is asked: the filter
  // vocabulary has no not-in.
  const values = visibleStatusValues(q.declaredStatuses, q.status);
  // Nothing visible is declared: ask for a value no row has rather than for
  // everything, so the list can never widen to include rejected rows.
  filters['attr.status__in'] = values.length ? values.join(',') : '__none__';
  const term = q.search.trim();
  if (term) filters.search = term;
  const order = q.sortBy ? serverOrder(q.sortBy, q.sortDirection) : null;
  if (order) filters.order = order;
  return filters;
}

export interface ContentRow {
  id: string;
  title: string;
  market: string;
  assigned: string;
  status: ContentStatus | null;
  statusLabel: string;
  scheduled: string;
}

const DASH = '—';

/** "Fri 10/23", in the viewer's zone unless one is given. '' when unusable. */
export function formatWhen(iso: string, timeZone?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'numeric', day: 'numeric', ...(timeZone ? { timeZone } : {}),
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('weekday')} ${get('month')}/${get('day')}`;
}

export function contentRow(
  record: EntityRecord,
  topics: Record<string, { market?: string } | undefined>,
  timeZone?: string,
): ContentRow {
  const status = contentStatusOf(readData(record.data, 'status'));
  const topicId = String(readData(record.data, 'topic_ref') ?? '');
  const market = String(topics[topicId]?.market ?? '').trim();
  const assigned = String(readData(record.data, 'assignee_name') ?? '').trim();
  const when =
    status === 'posted'
      ? String(readData(record.data, 'sent_at') ?? '')
      : status === 'scheduled'
        ? String(readData(record.data, 'scheduled_for') ?? '')
        : '';
  return {
    id: String(record.id),
    title: draftTitle(record),
    market: market || DASH,
    assigned: assigned || DASH,
    status,
    statusLabel: status ? contentStatusLabel(status) : '',
    scheduled: formatWhen(when, timeZone),
  };
}
