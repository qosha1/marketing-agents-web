/**
 * Every Research list narrows and sorts on the SERVER (rule 8): these build the
 * tenant query strings (`attr.<name>__<op>`, `order=`; see EntityFilters in
 * foundry-api) and nothing here scans rows on the client.
 */
import type { EntityFilters } from '@/lib/foundry-api';

import type { DocumentReview } from './review';

/** The statuses a document can hold that mean nobody has judged it yet. */
export const UNREVIEWED_STATUSES = ['new', 'surfaced', 'cited', 'ignored', 'preview_only'];
export const TOPIC_LISTED_STATUSES = ['suggested', 'ready', 'written'];

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
  const f: EntityFilters = {};
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

/** Sort direction -> the `order=` the tenant understands for the row's own date. */
const CREATED_ORDER: Record<string, 'recent' | 'oldest'> = { asc: 'oldest', desc: 'recent' };

/** The range chips on Topics. Default 30 days, as the wireframe shows. */
export const TOPIC_RANGES = [
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: 'all', label: 'All' },
];
export const TOPIC_DEFAULT_RANGE = '30';

const TOPIC_COLUMNS = { title: 'title', markets: 'market' };

export interface TopicQuery {
  search?: string;
  sort?: SortState;
  market?: string;
  range?: string;
}

/**
 * Topics are narrowed on the row's own `created_at` (`created_after`): the date
 * the pipeline grouped the documents into a topic. Newest first unless a column
 * says otherwise; the Dates column sorts on that same date.
 */
export function topicFilters(q: TopicQuery, now: Date = new Date()): EntityFilters {
  const f: EntityFilters = { 'attr.status__in': TOPIC_LISTED_STATUSES.join(',') };
  const search = q.search?.trim();
  if (search) f['attr.title__icontains'] = search;
  if (q.market) f['attr.market__icontains'] = q.market;
  if (q.range && q.range !== 'all') {
    const from = new Date(now);
    from.setDate(from.getDate() - Number(q.range));
    f.created_after = dayString(from);
  }
  if (q.sort?.by === 'dates') f.order = CREATED_ORDER[q.sort.dir ?? 'desc'];
  else {
    const order = orderParam(q.sort, TOPIC_COLUMNS, '');
    if (order) f.order = order;
  }
  return f;
}

// A source's name is its domain unless renamed; the tenant sorts on attributes only.
const SOURCE_COLUMNS = { name: 'domain', domain: 'domain', tier: 'tier', type: 'source_type', active: 'active' };

export interface SourceQuery {
  search?: string;
  sort?: SortState;
  type?: string;
  active?: 'all' | 'on' | 'off';
}

export function sourceFilters(q: SourceQuery): EntityFilters {
  const f: EntityFilters = {};
  const search = q.search?.trim();
  if (search) f.search = search;
  if (q.type) f['attr.source_type'] = q.type;
  if (q.active === 'on') f['attr.active'] = 'true';
  else if (q.active === 'off') f['attr.active'] = 'false';
  const order = orderParam(q.sort, SOURCE_COLUMNS, '');
  if (order) f.order = order;
  return f;
}
