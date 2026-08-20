/**
 * Pure data-mapping helpers for the system-health dashboard (bd 768w.16.8.5).
 *
 * These turn raw tenant records (topics, news_items, sources) into the plain prop
 * shapes the @startsimpli/ui health blocks consume. Kept framework-free so they're
 * unit-tested in isolation (see __tests__/health-data.test.ts); the React widgets in
 * components/dashboard/widgets.tsx just fetch the records and hand them here.
 *
 * TWO RULES, both learned the hard way (bd startsim-f3ed / hfc4 / xz0a):
 *
 * 1. "Needs a human" is a PREDICATE OVER FIELDS, never a status equality. The old
 *    NEEDS_VERDICT_STATUS = 'suggested' declared 19 topics "awaiting verdict" while
 *    all 19 already carried a team_verdict — the status had simply never been
 *    advanced. A status value is where a record sits; it is not what is true of it.
 * 2. Never render a number you cannot stand behind. A figure computed over a
 *    bounded sample is reported AS a sample fact (with its window in the shape), and
 *    a signal we cannot observe is null — never a plausible-looking zero. That is
 *    why ingestionSummary carries `sampleSize` and returns `cadenceHours: null`
 *    rather than averaging two points into a fictional SLA.
 *
 * Every data-blob read goes through readData() (the shared client camelCases the
 * blob, so snake_case keys need the camel/raw fallback).
 */
import type { AttentionItem, PipelineStage } from '@startsimpli/ui';

import {
  boardColumns,
  choicesOf,
  groupByStatus,
  pickStatusAttr,
  readData,
  UNSET_COLUMN,
} from '@/lib/board';
import { CONTENT_TYPE_KEY } from '@/lib/content';
import type { EntityRecord, EntityTypeDef } from '@/lib/foundry-api';

/** Coerce an unknown data-blob value to a trimmed string ('' when absent). */
function asString(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

/** camelCase-aware, trimmed read of one attribute off a record ('' when unset). */
function field(record: EntityRecord, name: string): string {
  return asString(readData(record.data, name));
}

/** Case-insensitive join key ('' when absent). */
function joinKey(v: unknown): string {
  return asString(v).toLowerCase();
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * (1) Content pipeline: count each status stage of the topic type. Lanes come from
 * the status enum's declared choices (via pickStatusAttr + groupByStatus), so the
 * stages track the live schema. The trailing "Unset" lane is dropped unless
 * something actually landed there.
 *
 * Deliberately returns stages ONLY. It used to also return an `attention` count
 * that PipelineHealth rendered as the badge "19 awaiting verdict" — a claim it had
 * no standing to make (see topicQueue). The card describes the shape of the
 * pipeline; the queue owns every "somebody must act" claim.
 */
export function topicPipeline(
  type: EntityTypeDef | undefined | null,
  records: EntityRecord[],
): { stages: PipelineStage[] } {
  const statusAttr = pickStatusAttr(type);
  if (!statusAttr) return { stages: [] };

  const columns = boardColumns(statusAttr);
  const grouped = groupByStatus(records, statusAttr.name, columns);

  const stages: PipelineStage[] = columns
    .filter((c) => c.id !== UNSET_COLUMN.id || grouped[c.id].length > 0)
    .map((c) => ({ label: c.label, count: grouped[c.id].length }));

  return { stages };
}

// ---- (2) The queue: predicates over fields, not status equality (startsim-f3ed) ----

/**
 * The status value that means "still in intake" — the FIRST declared choice of the
 * type's status enum, read from the live schema.
 *
 * Schema-driven on purpose: a fork that names its intake stage `inbox`, or reorders
 * its choices, gets the right lane with no code change. A type that declares no
 * status enum returns null, and the caller DROPS the row rather than reporting a
 * zero for a question the schema cannot even pose.
 */
export function intakeStage(type: EntityTypeDef | undefined | null): string | null {
  const attr = pickStatusAttr(type);
  if (!attr) return null;
  return choicesOf(attr)[0] ?? null;
}

/**
 * "Judged, but never filed": a human recorded a `team_verdict`, and the record is
 * STILL sitting in the intake stage. This is the predicate the old
 * `status === 'suggested'` check was reaching for and got backwards — it counted
 * exactly these records as *awaiting* the verdict they already have.
 *
 * The work it names is real and finishable: advance each topic to the stage its
 * verdict implies.
 */
export function isJudgedNotFiled(topic: EntityRecord, intake: string): boolean {
  return field(topic, 'team_verdict') !== '' && field(topic, 'status') === intake;
}

/**
 * Genuinely untouched: no `team_verdict` AND no `team_notes`. Two fields, because
 * a teaching note without a verdict still means a human has looked at it. Zero of
 * these exist in marketing-agents today — which is why the row vanishes rather
 * than rendering "0 awaiting review".
 */
export function isUnjudged(topic: EntityRecord): boolean {
  return field(topic, 'team_verdict') === '' && field(topic, 'team_notes') === '';
}

/**
 * The distinct `team_verdict` values actually present, as "good 11 · bad 8".
 *
 * Grouped by OBSERVED value, never by declared choices: `team_verdict` is declared
 * `text`, not `enum`, so there is no choice list to derive lanes from and faking
 * one would invent a taxonomy the tenant never declared. Sorted by count desc then
 * value asc so the string is deterministic.
 */
function verdictBreakdown(topics: EntityRecord[]): string {
  const counts = new Map<string, number>();
  for (const t of topics) {
    const v = field(t, 'team_verdict');
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value, n]) => `${value} ${n}`)
    .join(' · ');
}

/** The records table for the topic type, filtered to one status value. */
function topicStatusHref(status: string): string {
  return `/t/${CONTENT_TYPE_KEY}?status=${encodeURIComponent(status)}`;
}

/**
 * One queue row. Extends the shared AttentionItem (so it drops straight into
 * @startsimpli/ui's AttentionFeed) with the RECORD count behind the row.
 *
 * The count is not decoration. A row is an aggregate — "Judged, not filed — 19
 * topics" — so `rows.length` is the number of PREDICATES that fired, not the amount
 * of work waiting. Anything rendering a headline figure must sum `count`
 * (see queueTotal), never count the rows.
 */
export interface QueueRow extends AttentionItem {
  /** How many records satisfy this row's predicate. */
  count: number;
}

/** The records waiting across every queue row — the only total a badge may state. */
export function queueTotal(rows: QueueRow[]): number {
  return rows.reduce((sum, r) => sum + r.count, 0);
}

/**
 * The needs-a-human queue. One row per PREDICATE (not per record): each row states
 * the predicate in words the reader can check against the data, carries the count
 * it is true of, and links to the filtered view where that work gets done.
 *
 * A predicate matching nothing produces NO row — a queue listing "0 topics awaiting
 * X" is noise, and when every predicate is empty the caller renders an "All clear"
 * state, which is then meaningful.
 */
export function topicQueue(
  type: EntityTypeDef | undefined | null,
  topics: EntityRecord[],
): QueueRow[] {
  const rows: QueueRow[] = [];
  const intake = intakeStage(type);

  if (intake) {
    const stranded = topics.filter((t) => isJudgedNotFiled(t, intake));
    if (stranded.length > 0) {
      rows.push({
        id: 'judged-not-filed',
        count: stranded.length,
        label: `Judged, not filed — ${plural(stranded.length, 'topic')}`,
        meta: `A team_verdict is recorded (${verdictBreakdown(stranded)}) but status is still “${intake}”. Advance each to the stage its verdict implies.`,
        href: topicStatusHref(intake),
        tone: 'warn',
      });
    }
  }

  const unjudged = topics.filter(isUnjudged);
  if (unjudged.length > 0) {
    rows.push({
      id: 'unjudged',
      count: unjudged.length,
      label: `Not yet judged — ${plural(unjudged.length, 'topic')}`,
      meta: 'No team_verdict and no team_notes — nobody has looked at these yet.',
      href: `/t/${CONTENT_TYPE_KEY}`,
      tone: 'warn',
    });
  }

  return rows;
}

// ---- (3) Ingestion aggregate — replaces the 55-row freshness list (startsim-hfc4) ----

/** Articles arrive in bursts; a gap wider than this starts a new delivery. */
const BATCH_GAP_MINUTES = 30;
/** One gap is not a distribution — refuse to call a cadence from fewer than this. */
const MIN_OBSERVED_GAPS = 2;
/** A gap this far off the median means the cadence is unstable: say nothing. */
const CADENCE_TOLERANCE = 0.25;

export interface IngestionSummary {
  /**
   * All-time article count, straight off the DRF envelope's `count`. null when the
   * caller could not read it — NEVER the sample length, which is a different fact.
   */
  totalArticles: number | null;
  /** Newest article creation instant in the sample; null when nothing has arrived. */
  lastDeliveryAt: string | null;
  /** Observed hours between deliveries; null when too few or too irregular to state. */
  cadenceHours: number | null;
  /** Distinct delivery bursts visible in the sample. */
  deliveriesObserved: number;
  /** Articles actually inspected — the window every windowed figure below is true of. */
  sampleSize: number;
  /** Declared `source` records carrying a domain, deduped. */
  sourcesDeclared: number;
  /**
   * How many of those declared domains appear IN THE SAMPLE. Not an all-time
   * figure and must never be rendered as one: with 3,648 articles behind a 200-item
   * window, a low-volume source that has produced falls out of the window and would
   * read identically to one that never existed. The widget states the window.
   */
  sourcesInSample: number;
}

/**
 * Has the next delivery failed to show up? Only meaningful once a cadence has
 * actually been observed — with no observed schedule there is nothing to be late
 * against, so this is false rather than a guess. `now` is injected (the widget
 * passes react-query's `dataUpdatedAt`) so the verdict is pure and testable.
 */
export function ingestionOverdue(summary: IngestionSummary, now: number): boolean {
  if (!summary.lastDeliveryAt || summary.cadenceHours == null) return false;
  const last = new Date(summary.lastDeliveryAt).getTime();
  if (Number.isNaN(last)) return false;
  return (now - last) / 3_600_000 > summary.cadenceHours * 2;
}

/** Epoch ms for a record's createdAt, or null when it is missing/unparseable. */
function createdAtMs(record: EntityRecord): number | null {
  const raw = asString(record.createdAt);
  if (!raw) return null;
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? null : t;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Hours between deliveries, or null when we have no business claiming one.
 *
 * Cadence is OBSERVED (from the gaps between burst heads), never a hardcoded SLA
 * and never a config value the tenant cannot see. Two guards: fewer than
 * MIN_OBSERVED_GAPS gaps is a coincidence rather than a cadence, and a gap more
 * than CADENCE_TOLERANCE off the median means the schedule is not stable enough to
 * summarise — in both cases the phrase is omitted rather than averaged into fiction.
 *
 * Note this needs SEVERAL pages of news, not one: live bursts land ~40 articles
 * within ~15 seconds, so a single 50-row page sits entirely inside one delivery and
 * contains no inter-delivery gap at all.
 */
function observedCadenceHours(burstHeadsDesc: number[]): number | null {
  const gaps: number[] = [];
  for (let i = 0; i < burstHeadsDesc.length - 1; i++) {
    gaps.push((burstHeadsDesc[i] - burstHeadsDesc[i + 1]) / 3_600_000);
  }
  if (gaps.length < MIN_OBSERVED_GAPS) return null;
  const mid = median(gaps);
  if (mid <= 0) return null;
  if (gaps.some((g) => Math.abs(g - mid) / mid > CADENCE_TOLERANCE)) return null;
  return Math.round(mid);
}

/**
 * One honest line about ingestion, replacing the 55-row per-domain freshness card.
 *
 * Per-domain freshness for 55 declared sources is NOT knowable, and no backend fix
 * changes that: 44 of those domains are allow-list entries, not scheduled fetchers,
 * so there is no run ledger for them because nothing runs per domain. What IS
 * knowable is when the last delivery landed, how often deliveries land, how many
 * articles exist all-time, and which declared domains show up in the window we
 * actually read. The shape carries `sampleSize` so the caller cannot accidentally
 * present the windowed figure as an all-time one.
 *
 * `totalArticles` comes from the caller's paginated envelope (`count`), NOT from
 * `recentNews.length` — accumulating a capped page walk and reporting its length as
 * a total is exactly how a wrong figure gets shipped.
 */
export function ingestionSummary(
  sources: EntityRecord[],
  recentNews: EntityRecord[],
  totalArticles: number | null,
  options?: { batchGapMinutes?: number },
): IngestionSummary {
  const gapMs = (options?.batchGapMinutes ?? BATCH_GAP_MINUTES) * 60_000;

  const declared = new Set<string>();
  for (const s of sources) {
    const domain = joinKey(readData(s.data, 'domain'));
    if (domain) declared.add(domain);
  }

  const seenDomains = new Set<string>();
  const stampsDesc: number[] = [];
  let newest: { at: number; iso: string } | null = null;

  for (const item of recentNews) {
    const domain = joinKey(readData(item.data, 'domain'));
    if (domain && declared.has(domain)) seenDomains.add(domain);

    const at = createdAtMs(item);
    if (at == null) continue; // an unparseable stamp is unknown, not the epoch
    stampsDesc.push(at);
    if (!newest || at > newest.at) newest = { at, iso: asString(item.createdAt) };
  }

  stampsDesc.sort((a, b) => b - a);
  const burstHeads: number[] = [];
  for (let i = 0; i < stampsDesc.length; i++) {
    if (i === 0 || stampsDesc[i - 1] - stampsDesc[i] > gapMs) burstHeads.push(stampsDesc[i]);
  }

  return {
    totalArticles,
    lastDeliveryAt: newest?.iso ?? null,
    cadenceHours: observedCadenceHours(burstHeads),
    deliveriesObserved: burstHeads.length,
    sampleSize: recentNews.length,
    sourcesDeclared: declared.size,
    sourcesInSample: seenDomains.size,
  };
}
