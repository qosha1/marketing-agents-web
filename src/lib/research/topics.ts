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

export function topicRow(topic: EntityRecord, inContent: number): TopicRow {
  return {
    id: String(topic.id),
    title: topicTitle(topic),
    angle: str(readData(topic.data, 'angle')),
    sources: topicSourceUrls(topic).length,
    markets: str(readData(topic.data, 'market')),
    dates: formatDay(topic.createdAt),
    inContent,
  };
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
