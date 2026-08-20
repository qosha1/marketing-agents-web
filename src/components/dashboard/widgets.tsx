'use client';

/**
 * The system-health dashboard widgets (bd 768w.16.8.5).
 *
 * Each widget is a self-contained data-fetcher: it useQuery's the live tenant data
 * over the same-origin foundry-api, maps it with the pure helpers in
 * lib/health-data, and renders a @startsimpli/ui health block. The blocks own the
 * tone roll-up + empty states; the widget owns the fetch + loading/error skins.
 *
 * Topic-backed widgets share the `['entities','topic','all']` query key, so
 * react-query fetches the topic set once and fans it out to both.
 *
 * HONESTY RULE (bd startsim-f3ed / hfc4): a widget renders only figures it can
 * stand behind. A number computed over a bounded page window says so in the same
 * breath; a signal that cannot be observed renders an `Absence`, never a zero.
 */
import { useQuery } from '@tanstack/react-query';
import {
  Absence,
  Caveat,
  HealthCard,
  HealthDot,
  PipelineHealth,
} from '@startsimpli/ui';
import { formatRelativeDate } from '@startsimpli/ui';
import { Inbox, RadioTower } from 'lucide-react';

import {
  ingestionOverdue,
  ingestionSummary,
  queueTotal,
  topicPipeline,
  topicQueue,
} from '@/lib/health-data';
import { listAllEntities, listEntities, listTypes, type EntityRecord } from '@/lib/foundry-api';

const TOPIC_KEY = ['entities', 'topic', 'all'] as const;
const SOURCE_KEY = ['entities', 'source', 'all'] as const;
// The ingestion aggregate reads a bounded window of the newest news_items rather
// than the whole ~3.6k-row table (the whole-table fetch was the old widget's lag).
// FOUR pages, not one: live deliveries land ~40 articles within ~15 seconds, so a
// single 50-row page sits entirely inside ONE delivery and contains no
// inter-delivery gap to observe a cadence from. Four pages spans ~5 deliveries.
// The all-time article total does NOT come from this window — it comes off page
// one's `count`, because accumulating a capped page walk and reporting its length
// as a total is exactly how a wrong figure gets shipped.
const NEWS_WINDOW_PAGES = 4;
const NEWS_RECENT_KEY = ['entities', 'news_item', 'recent', NEWS_WINDOW_PAGES] as const;

interface NewsWindow {
  items: EntityRecord[];
  /** The DRF envelope's `count` — the all-time total, independent of the window. */
  total: number | null;
}

async function fetchNewsWindow(pages = NEWS_WINDOW_PAGES): Promise<NewsWindow> {
  const items: EntityRecord[] = [];
  let total: number | null = null;
  for (let page = 1; page <= pages; page++) {
    const res = await listEntities('news_item', page);
    if (page === 1) total = typeof res.count === 'number' ? res.count : null;
    items.push(...res.results);
    if (!res.next) break;
  }
  return { items, total };
}

/**
 * Muted placeholder while a widget's query is in flight. The badge says "Loading"
 * (not the neutral tone's default "No data" label) so a slow card never reads as a
 * false empty verdict while it's still fetching.
 */
function LoadingCard({ title }: { title: string }) {
  return (
    <HealthCard
      title={title}
      status="neutral"
      statusLabel="Loading"
      isLoading
      isEmpty
      emptyMessage="Loading…"
    />
  );
}

/** Shown when a widget's fetch fails — a real signal, not a blank card. */
function ErrorCard({ title }: { title: string }) {
  return (
    <HealthCard
      title={title}
      status="critical"
      statusLabel="Unavailable"
      isEmpty
      emptyMessage="Couldn’t load this data."
    />
  );
}

/**
 * (1) Content pipeline — how many topics sit in each declared status stage.
 *
 * Descriptive only. It used to carry an `attention` badge reading "19 awaiting
 * verdict"; all 19 of those topics already had a team_verdict (bd startsim-f3ed),
 * so the badge is gone and every "somebody must act" claim now lives in the queue,
 * where it is stated as a predicate the reader can check.
 */
export function PipelineHealthWidget({ title = 'Content pipeline' }: { title?: string }) {
  const typesQuery = useQuery({ queryKey: ['schema-types'], queryFn: () => listTypes() });
  const topicsQuery = useQuery({ queryKey: TOPIC_KEY, queryFn: () => listAllEntities('topic') });

  if (typesQuery.isLoading || topicsQuery.isLoading) return <LoadingCard title={title} />;
  if (typesQuery.isError || topicsQuery.isError) return <ErrorCard title={title} />;

  const topicType = typesQuery.data?.results.find((t) => t.key === 'topic');
  const { stages } = topicPipeline(topicType, topicsQuery.data ?? []);

  return <PipelineHealth title={title} stages={stages} emptyMessage="No topics yet." />;
}

/**
 * (2) Ingestion — one line about the machine that feeds the pipeline.
 *
 * Replaces the 55-row source-freshness card (bd startsim-hfc4). Per-domain
 * freshness for 55 declared sources is not knowable: 44 of them are allow-list
 * entries rather than scheduled fetchers, so there is no per-domain run ledger to
 * read and the card's wall of "never" was answering a question nobody asks daily.
 * What IS knowable — when the last delivery landed, how often deliveries land, the
 * all-time article count, and which declared domains show up in the window we
 * actually read — fits in two lines, and the source line names its window instead
 * of dressing a 200-item sample up as an all-time claim.
 */
export function IngestionWidget({ title = 'Ingestion' }: { title?: string }) {
  const sourcesQuery = useQuery({
    queryKey: SOURCE_KEY,
    queryFn: () => listAllEntities('source'),
  });
  const newsQuery = useQuery({
    queryKey: NEWS_RECENT_KEY,
    queryFn: () => fetchNewsWindow(),
  });

  if (sourcesQuery.isLoading || newsQuery.isLoading) return <LoadingCard title={title} />;
  if (sourcesQuery.isError || newsQuery.isError) return <ErrorCard title={title} />;

  const summary = ingestionSummary(
    sourcesQuery.data ?? [],
    newsQuery.data?.items ?? [],
    newsQuery.data?.total ?? null,
  );

  // Nothing has arrived: say that, rather than printing a 0 beside "last delivery".
  if (!summary.lastDeliveryAt) {
    return (
      <HealthCard
        title={title}
        status="neutral"
        icon={RadioTower}
        isEmpty
        emptyMessage="No articles have arrived yet."
      />
    );
  }

  // The freshness verdict is judged against WHEN THE DATA WAS FETCHED, not against
  // a Date.now() read during render (impure, and it drifts from the data it judges).
  const overdue = ingestionOverdue(summary, newsQuery.dataUpdatedAt);

  return (
    <HealthCard
      title={title}
      status={overdue ? 'warn' : 'ok'}
      statusLabel={overdue ? 'Overdue' : 'Delivering'}
      icon={RadioTower}
    >
      <p className="text-sm text-gray-700">
        Last delivery {formatRelativeDate(new Date(summary.lastDeliveryAt))}
        {' · '}
        {summary.cadenceHours != null ? (
          <>~every {summary.cadenceHours}h</>
        ) : (
          <>
            cadence{' '}
            <Absence
              tier="value"
              title="Delivery cadence"
              why={`Articles arrive in bursts. The ${summary.sampleSize} most recent show ${summary.deliveriesObserved} ${summary.deliveriesObserved === 1 ? 'delivery' : 'deliveries'}, which is not a stable enough distribution to call a schedule from.`}
            />
          </>
        )}
        {' · '}
        {summary.totalArticles != null ? (
          <>{summary.totalArticles.toLocaleString()} articles all-time</>
        ) : (
          <>
            all-time total{' '}
            <Absence
              tier="value"
              title="All-time article count"
              why="The paginated response did not report a total, and the number of articles we happened to read is a different fact."
            />
          </>
        )}
      </p>

      <p className="text-xs text-gray-500">
        {summary.sourcesInSample} of {summary.sourcesDeclared} approved sources appear in the{' '}
        {summary.sampleSize} most recent articles
        <Caveat subject="approved sources reached" placement="inline">
          This counts the {summary.sampleSize} most recently ingested articles, not all{' '}
          {summary.totalArticles?.toLocaleString() ?? 'the'} of them — a low-volume source that
          has produced can fall outside the window. And a source with no articles may be an
          allow-list entry the fetcher never polls, not a broken feed: most declared domains have
          never delivered anything at all.
        </Caveat>
      </p>
    </HealthCard>
  );
}

/**
 * (3) The queue — what needs a human, as predicates over fields.
 *
 * One row per predicate, each stating what is true of the records it counts and
 * linking to the filtered view where the work gets done. It used to list topics
 * whose `status` equalled 'suggested' as "awaiting an editorial verdict" while
 * every one of them already carried a team_verdict (bd startsim-f3ed) — sending
 * the reader to redo finished work. A predicate that matches nothing renders no
 * row, so the "All clear" state is meaningful when it appears.
 *
 * Composed on HealthCard rather than on @startsimpli/ui's AttentionFeed for one
 * reason: AttentionFeed derives its badge as `${items.length} to review`, and with
 * AGGREGATE rows that reads "1 to review" beside a row that says "19 topics" — a
 * number nobody can stand behind. The rows are already AttentionItems, so the day
 * AttentionFeed takes a statusLabel override this collapses back to one line
 * (bd startsim-vau9).
 */
export function AttentionWidget({ title = 'What needs a human' }: { title?: string }) {
  const typesQuery = useQuery({ queryKey: ['schema-types'], queryFn: () => listTypes() });
  const topicsQuery = useQuery({ queryKey: TOPIC_KEY, queryFn: () => listAllEntities('topic') });

  if (typesQuery.isLoading || topicsQuery.isLoading) return <LoadingCard title={title} />;
  if (typesQuery.isError || topicsQuery.isError) return <ErrorCard title={title} />;

  const topicType = typesQuery.data?.results.find((t) => t.key === 'topic');
  const rows = topicQueue(topicType, topicsQuery.data ?? []);
  const waiting = queueTotal(rows);

  return (
    <HealthCard
      title={title}
      status={rows.length === 0 ? 'ok' : 'warn'}
      statusLabel={
        rows.length === 0 ? 'All clear' : `${waiting} topic${waiting === 1 ? '' : 's'} waiting`
      }
      icon={Inbox}
      isEmpty={rows.length === 0}
      emptyMessage="All clear — nothing is waiting on a person."
    >
      <ul className="divide-y divide-gray-100" aria-label={`${title} queue`}>
        {rows.map((row) => {
          const body = (
            <span className="flex items-start gap-2 py-2 min-w-0">
              <HealthDot status={row.tone ?? 'warn'} className="mt-1.5" />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-gray-900">{row.label}</span>
                {row.meta && <span className="block text-xs text-gray-500">{row.meta}</span>}
              </span>
            </span>
          );
          return (
            <li key={row.id}>
              {row.href ? (
                <a
                  href={row.href}
                  className="block rounded px-1 -mx-1 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {body}
                </a>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ul>
    </HealthCard>
  );
}
