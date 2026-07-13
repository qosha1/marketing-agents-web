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
 * react-query fetches the topic set once and fans it out to all three.
 */
import { useQuery } from '@tanstack/react-query';
import {
  AttentionFeed,
  DeliveryHealth,
  HealthCard,
  PipelineHealth,
  SourceFreshness,
} from '@startsimpli/ui';

import {
  attentionFromTopics,
  deliveryFromTopics,
  sourceFreshness,
  topicPipeline,
} from '@/lib/health-data';
import { listAllEntities, listTypes } from '@/lib/foundry-api';

const TOPIC_KEY = ['entities', 'topic', 'all'] as const;
const SOURCE_KEY = ['entities', 'source', 'all'] as const;
// Freshness only needs recent news. The tenant EntityViewSet orders by -created_at
// (page 1 = newest-created; PAGE_SIZE 50), so a bounded page window covers the
// freshness horizon without pulling the whole ~585-row news_item table on every
// dashboard load — the slow, whole-table fetch was the widget's original lag.
const NEWS_WINDOW_PAGES = 4; // 4 × 50 = the 200 most-recently-created news_items
const NEWS_RECENT_KEY = ['entities', 'news_item', 'recent', NEWS_WINDOW_PAGES] as const;

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

// (1) Content pipeline — topic status stages + a "needs a verdict" attention flag.
export function PipelineHealthWidget({ title = 'Content pipeline' }: { title?: string }) {
  const typesQuery = useQuery({ queryKey: ['schema-types'], queryFn: () => listTypes() });
  const topicsQuery = useQuery({ queryKey: TOPIC_KEY, queryFn: () => listAllEntities('topic') });

  if (typesQuery.isLoading || topicsQuery.isLoading) return <LoadingCard title={title} />;
  if (typesQuery.isError || topicsQuery.isError) return <ErrorCard title={title} />;

  const topicType = typesQuery.data?.results.find((t) => t.key === 'topic');
  const { stages, attention } = topicPipeline(topicType, topicsQuery.data ?? []);

  return (
    <PipelineHealth
      title={title}
      stages={stages}
      attention={attention}
      attentionLabel={attention > 0 ? `${attention} awaiting verdict` : undefined}
      emptyMessage="No topics yet."
    />
  );
}

// (2) Source freshness — every declared `source` record, ranked by the latest news
// it produced (a quiet source stays visible, correctly stale). The source list is
// the ~23 source records; the news side is a bounded recent window, not the whole
// table. While either query is in flight the card shows LoadingCard — it never
// computes a "No data" verdict from data it hasn't finished fetching.
export function SourceFreshnessWidget({ title = 'Source freshness' }: { title?: string }) {
  const sourcesQuery = useQuery({
    queryKey: SOURCE_KEY,
    queryFn: () => listAllEntities('source'),
  });
  const newsQuery = useQuery({
    queryKey: NEWS_RECENT_KEY,
    queryFn: () => listAllEntities('news_item', NEWS_WINDOW_PAGES),
  });

  if (sourcesQuery.isLoading || newsQuery.isLoading) return <LoadingCard title={title} />;
  if (sourcesQuery.isError || newsQuery.isError) return <ErrorCard title={title} />;

  const sources = sourceFreshness(sourcesQuery.data ?? [], newsQuery.data ?? []);

  return (
    <SourceFreshness
      title={title}
      sources={sources}
      emptyMessage="No sources configured."
    />
  );
}

// (3) Delivery health — scheduled topics vs their delivery (honestly empty for now).
export function DeliveryHealthWidget({ title = 'Delivery' }: { title?: string }) {
  const topicsQuery = useQuery({ queryKey: TOPIC_KEY, queryFn: () => listAllEntities('topic') });

  if (topicsQuery.isLoading) return <LoadingCard title={title} />;
  if (topicsQuery.isError) return <ErrorCard title={title} />;

  const items = deliveryFromTopics(topicsQuery.data ?? []);

  return (
    <DeliveryHealth
      title={title}
      items={items}
      limit={8}
      emptyMessage="Nothing scheduled yet."
    />
  );
}

// (4) Needs attention — topics awaiting an editorial verdict.
export function AttentionWidget({ title = 'Needs attention' }: { title?: string }) {
  const topicsQuery = useQuery({ queryKey: TOPIC_KEY, queryFn: () => listAllEntities('topic') });

  if (topicsQuery.isLoading) return <LoadingCard title={title} />;
  if (topicsQuery.isError) return <ErrorCard title={title} />;

  const items = attentionFromTopics(topicsQuery.data ?? []);

  return (
    <AttentionFeed
      title={title}
      items={items}
      emptyMessage="All clear — every topic has a verdict."
    />
  );
}
