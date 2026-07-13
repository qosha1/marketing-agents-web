/**
 * Pure data-mapping helpers for the system-health dashboard (bd 768w.16.8.5).
 *
 * These turn raw tenant records (topics, news_items) into the plain prop shapes the
 * @startsimpli/ui health blocks consume. Kept framework-free so they're unit-tested
 * in isolation (see __tests__/health-data.test.ts); the React widgets in
 * components/dashboard/widgets.tsx just fetch the records and hand them here.
 *
 * Honesty rule (MEMORY: everything is ongoing, don't fabricate coverage): a widget
 * shows only what the data actually says. Empty scheduled_for => empty delivery card,
 * not a faked "on track". Every data-blob read goes through readData() (the shared
 * client camelCases the blob, so snake_case keys need the camel/raw fallback).
 */
import type {
  AttentionItem,
  DeliveryItem,
  PipelineStage,
  SourceFreshnessItem,
} from '@startsimpli/ui';

import {
  boardColumns,
  groupByStatus,
  pickStatusAttr,
  readData,
  UNSET_COLUMN,
} from '@/lib/board';
import { CONTENT_CATEGORIES, contentTabHref } from '@/lib/content';
import type { EntityRecord, EntityTypeDef } from '@/lib/foundry-api';

/** The topic status that means "a human still needs to give an editorial verdict". */
export const NEEDS_VERDICT_STATUS = 'suggested';

/** Coerce an unknown data-blob value to a trimmed string ('' when absent). */
function asString(v: unknown): string {
  return v == null ? '' : String(v);
}

/** A topic's display title: record.name is the title; fall back to data.title. */
function topicTitle(record: EntityRecord): string {
  return record.name || asString(readData(record.data, 'title')) || `#${record.id}`;
}

/**
 * (1) Content pipeline: count each status stage of the topic type. Lanes come from
 * the status enum's declared choices (via pickStatusAttr + groupByStatus), so the
 * stages track the live schema. `attention` = topics still awaiting a verdict.
 * The trailing "Unset" lane is dropped unless something actually landed there.
 */
export function topicPipeline(
  type: EntityTypeDef | undefined | null,
  records: EntityRecord[],
): { stages: PipelineStage[]; attention: number } {
  const statusAttr = pickStatusAttr(type);
  if (!statusAttr) return { stages: [], attention: 0 };

  const columns = boardColumns(statusAttr);
  const grouped = groupByStatus(records, statusAttr.name, columns);

  const stages: PipelineStage[] = columns
    .filter((c) => c.id !== UNSET_COLUMN.id || grouped[c.id].length > 0)
    .map((c) => ({ label: c.label, count: grouped[c.id].length }));

  const attention = grouped[NEEDS_VERDICT_STATUS]?.length ?? 0;
  return { stages, attention };
}

/**
 * (2) Source freshness: `source` records carry no last-fetched timestamp, so derive
 * freshness from the news they produced — group news_items by source_name and take
 * the MAX last_seen per source. Stalest sources first, so problems bubble to the top
 * (the block itself derives ok/stale from the age of lastUpdated).
 */
export function sourceFreshnessFromNews(newsItems: EntityRecord[]): SourceFreshnessItem[] {
  const latest = new Map<string, string>();
  for (const item of newsItems) {
    const name = asString(readData(item.data, 'source_name')).trim();
    if (!name) continue;
    const seen = asString(readData(item.data, 'last_seen')).trim();
    if (!seen) continue;
    const prev = latest.get(name);
    if (!prev || new Date(seen).getTime() > new Date(prev).getTime()) {
      latest.set(name, seen);
    }
  }
  return [...latest.entries()]
    .map(([name, lastUpdated]) => ({ name, lastUpdated }))
    .sort((a, b) => new Date(a.lastUpdated).getTime() - new Date(b.lastUpdated).getTime());
}

/**
 * (3) Delivery health: topics that have a scheduled_for date, mapped to due/delivered
 * markers. Topics with no schedule are intentionally excluded — with none scheduled
 * the card honestly renders its neutral "nothing scheduled" empty state (do NOT fake
 * a delivery cadence that the data doesn't have).
 */
export function deliveryFromTopics(topics: EntityRecord[]): DeliveryItem[] {
  return topics
    .map((t) => ({
      record: t,
      dueAt: asString(readData(t.data, 'scheduled_for')).trim(),
      deliveredAt: asString(readData(t.data, 'delivered_at')).trim(),
    }))
    .filter((row) => row.dueAt !== '')
    .map((row) => ({
      label: topicTitle(row.record),
      dueAt: row.dueAt,
      deliveredAt: row.deliveredAt || null,
    }));
}

/** True when a content_type value is one of the declared content categories. */
function isKnownCategory(key: string): boolean {
  return CONTENT_CATEGORIES.some((c) => c.key === key);
}

/**
 * (4) Needs attention: topics still in the "suggested" status — each needs a human
 * editorial verdict. Links to the content tab for the topic's content_type when it's
 * a known category. Capped so the queue stays scannable (newest first).
 */
export function attentionFromTopics(topics: EntityRecord[], limit = 8): AttentionItem[] {
  return topics
    .filter((t) => asString(readData(t.data, 'status')) === NEEDS_VERDICT_STATUS)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit)
    .map((t) => {
      const contentType = asString(readData(t.data, 'content_type')).trim();
      return {
        id: String(t.id),
        label: topicTitle(t),
        meta: 'Topic · suggested',
        href: isKnownCategory(contentType) ? contentTabHref(contentType) : undefined,
        at: t.createdAt,
      };
    });
}
