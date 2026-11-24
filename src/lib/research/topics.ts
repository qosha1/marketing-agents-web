/** View-models for the Research topics list and the one-topic page. Pure. */
import { readData } from '@/lib/board';
import type { EntityRecord } from '@/lib/foundry-api';

export interface TopicRow {
  id: string;
  title: string;
  angle: string;
  sources: number;
  markets: string;
  dates: string;
  inContent: number;
}

const str = (v: unknown) => (v == null ? '' : String(v).trim());

export function formatDay(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** The URLs a topic cites (source_1..3; the shared client may have camelised the key). */
export function topicSourceUrls(topic: EntityRecord): string[] {
  return ['source_1', 'source_2', 'source_3'].map((k) => str(readData(topic.data, k))).filter(Boolean);
}

export function topicTitle(topic: EntityRecord): string {
  return str(readData(topic.data, 'title')) || topic.name;
}

export function topicRow(
  topic: EntityRecord,
  inContent: number,
  docsByUrl: Record<string, EntityRecord> = {},
): TopicRow {
  return {
    id: String(topic.id),
    title: topicTitle(topic),
    angle: str(readData(topic.data, 'angle')),
    sources: topicSourceUrls(topic).length,
    markets: str(readData(topic.data, 'market')),
    dates: documentSpan(topicSourceUrls(topic).map((u) => docsByUrl[u]).filter(Boolean)) || formatDay(topic.createdAt),
    inContent,
  };
}

/** Day of the week, as the overview's bars are labelled. */
export function formatWeekday(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { weekday: 'short' });
}

/** `Oct 16 – Oct 20`, or `Oct 13` when every document is from one day. */
export function documentSpan(docs: EntityRecord[]): string {
  const days = docs.map((d) => str(readData(d.data, 'published_at')).slice(0, 10)).filter(Boolean).sort();
  if (days.length === 0) return '';
  const [from, to] = [formatDay(days[0]), formatDay(days[days.length - 1])];
  return from === to ? from : `${from} – ${to}`;
}

/** `{ topic id: how many drafts }` from one list of drafts. */
export function countDraftsByTopic(drafts: EntityRecord[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of drafts) {
    const ref = str(readData(d.data, 'topic_ref'));
    if (ref) out[ref] = (out[ref] ?? 0) + 1;
  }
  return out;
}

export function documentOutlet(doc: EntityRecord): string {
  return str(readData(doc.data, 'source_name')) || str(readData(doc.data, 'domain'));
}

/** `Outlet · Oct 16` */
export function documentLine(doc: EntityRecord): string {
  return [documentOutlet(doc), formatDay(str(readData(doc.data, 'published_at')))].filter(Boolean).join(' · ');
}

const EXCERPT_MAX = 220;

/** One quoted excerpt: the snippet, else the start of the body. */
export function excerptOf(doc: EntityRecord): string {
  const text = (str(readData(doc.data, 'snippet')) || str(readData(doc.data, 'content'))).replace(/\s+/g, ' ');
  return text.length > EXCERPT_MAX ? `${text.slice(0, EXCERPT_MAX).trimEnd()}…` : text;
}

/** `12 minutes ago`, `3 hours ago`, `2 days ago`. */
export function agoText(iso: string | null | undefined, now: Date = new Date()): string {
  const t = iso ? new Date(iso).getTime() : NaN;
  if (Number.isNaN(t)) return 'a while ago';
  const mins = Math.max(0, Math.round((now.getTime() - t) / 60_000));
  const unit = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'} ago`;
  if (mins < 1) return 'just now';
  if (mins < 60) return unit(mins, 'minute');
  if (mins < 60 * 24) return unit(Math.round(mins / 60), 'hour');
  return unit(Math.round(mins / (60 * 24)), 'day');
}
