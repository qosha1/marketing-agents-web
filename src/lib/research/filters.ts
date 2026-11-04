/**
 * Every Research list narrows and sorts on the SERVER (rule 8): these build the
 * tenant query strings (`attr.<name>__<op>`, `order=`; see EntityFilters in
 * foundry-api) and nothing here scans rows on the client.
 */
import type { EntityFilters } from '@/lib/foundry-api';
import { getActiveProjectId } from '@/lib/project-scope';

import type { DocumentReview } from './review';

/** The statuses a document can hold that mean nobody has judged it yet. */
export const UNREVIEWED_STATUSES = ['new', 'surfaced', 'cited', 'ignored', 'preview_only'];
export const TOPIC_LISTED_STATUSES = ['suggested', 'ready', 'written'];

/**
 * The one seam where the active project reaches a list query. Nothing is added
 * until lane 1's `getActiveProjectId()` returns a project; the attribute name is
 * theirs to confirm, so it is spelled once, here.
 */
export const PROJECT_ATTR = 'project_id';
export function projectFilters(projectId: string | null = getActiveProjectId()): EntityFilters {
  return projectId ? { [`attr.${PROJECT_ATTR}`]: projectId } : {};
}

export interface SortState {
  by?: string | null;
  dir?: 'asc' | 'desc';
}

/** Table column id -> the attribute the tenant sorts on. */
function orderParam(sort: SortState | undefined, columns: Record<string, string>, fallback: string): string {
  const attr = (sort?.by && columns[sort.by]) || null;
  if (!attr) return fallback;
  return `${sort?.dir === 'desc' ? '-' : ''}attr.${attr}`;
}

const DOCUMENT_COLUMNS = { title: 'title', source: 'source_name', published: 'published_at', review: 'status' };

export interface DocumentQuery {
  search?: string;
  source?: string;
  review?: 'all' | DocumentReview;
  range?: 'all' | '7' | '30' | '90';
  sort?: SortState;
}

export function dayString(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function documentFilters(q: DocumentQuery, now: Date = new Date()): EntityFilters {
  const f: EntityFilters = { ...projectFilters() };
  const search = q.search?.trim();
  if (search) f['attr.title__icontains'] = search;
  if (q.source) f['attr.source_name'] = q.source;
  if (q.review === 'good') f['attr.status'] = 'acceptable';
  else if (q.review === 'not_good') f['attr.status'] = 'rejected';
  else if (q.review === 'unreviewed') f['attr.status__in'] = UNREVIEWED_STATUSES.join(',');
  if (q.range && q.range !== 'all') {
    const from = new Date(now);
    from.setDate(from.getDate() - Number(q.range));
    f['attr.published_at__gte'] = dayString(from);
  }
  f.order = orderParam(q.sort, DOCUMENT_COLUMNS, '-attr.published_at');
  return f;
}

const TOPIC_COLUMNS = { title: 'title', markets: 'market' };

export function topicFilters(q: { search?: string; sort?: SortState }): EntityFilters {
  const f: EntityFilters = { ...projectFilters(), 'attr.status__in': TOPIC_LISTED_STATUSES.join(',') };
  const search = q.search?.trim();
  if (search) f['attr.title__icontains'] = search;
  const order = orderParam(q.sort, TOPIC_COLUMNS, '');
  if (order) f.order = order;
  return f;
}

const SOURCE_COLUMNS = { domain: 'domain', tier: 'tier', type: 'source_type', active: 'active' };

export function sourceFilters(q: { search?: string; sort?: SortState }): EntityFilters {
  const f: EntityFilters = { ...projectFilters() };
  const search = q.search?.trim();
  if (search) f.search = search;
  const order = orderParam(q.sort, SOURCE_COLUMNS, '');
  if (order) f.order = order;
  return f;
}
