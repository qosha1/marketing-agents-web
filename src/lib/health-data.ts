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

/** Sort key for freshness: a missing/invalid timestamp is the stalest (sorts first). */
function staleness(lastUpdated: string | Date | null | undefined): number {
  if (!lastUpdated) return 0;
  const t = new Date(lastUpdated).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** Case-insensitive, trimmed join key ('' when absent). */
function joinKey(v: unknown): string {
  return asString(v).trim().toLowerCase();
}

/**
 * (2) Source freshness: the row set is the org's declared `source` records (the
 * canonical list) — a source that has gone quiet still shows up, it never silently
 * vanishes. A `source` carries no last-fetched timestamp, so we derive freshness
 * from the news it produced.
 *
 * JOIN KEY = `domain`, NOT the display name. A source record's name is human ("Zawya",
 * "Gulf News") while news_item.source_name is the DOMAIN ("zawya.com", "gulfnews.com"),
 * so a name-join matches almost nothing and paints every live feed "never". Both
 * entities carry a `domain`, which lines up cleanly (verified live) — with a
 * source_name fallback for the odd item that stored a human name.
 *
 * A source that HAS produced gets its MAX `last_seen` and the block derives
 * fresh/stale from it. A source that has NEVER produced is marked `neutral` (idle),
 * NOT critical — "never wired" is not the same failure as "was fresh, now broken",
 * so the card doesn't scream red for feeds that simply aren't ingested yet. Fresh
 * sources sort to the top (most recent first); idle ones fall to the bottom.
 */
export function sourceFreshness(
  sources: EntityRecord[],
  newsItems: EntityRecord[],
): SourceFreshnessItem[] {
  const latestByDomain = new Map<string, string>();
  const latestByName = new Map<string, string>();
  const bump = (map: Map<string, string>, key: string, seen: string) => {
    if (!key) return;
    const prev = map.get(key);
    if (!prev || new Date(seen).getTime() > new Date(prev).getTime()) map.set(key, seen);
  };
  for (const item of newsItems) {
    const seen = asString(readData(item.data, 'last_seen')).trim();
    if (!seen) continue;
    bump(latestByDomain, joinKey(readData(item.data, 'domain')), seen);
    bump(latestByName, joinKey(readData(item.data, 'source_name')), seen);
  }

  const seenKeys = new Set<string>();
  const rows: SourceFreshnessItem[] = [];
  for (const s of sources) {
    const name = (s.name ?? '').trim();
    const domain = joinKey(readData(s.data, 'domain'));
    const key = domain || joinKey(name);
    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);
    const latest = (domain && latestByDomain.get(domain)) || latestByName.get(joinKey(name)) || null;
    rows.push(
      latest
        ? { name: name || domain, lastUpdated: latest }
        : { name: name || domain, lastUpdated: null, status: 'neutral' },
    );
  }
  // Fresh (producing) sources first — freshest on top; idle/never at the bottom.
  return rows.sort((a, b) => staleness(b.lastUpdated) - staleness(a.lastUpdated));
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
