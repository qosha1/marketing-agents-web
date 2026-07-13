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
  sourceFreshnessFromNews,
  topicPipeline,
} from '@/lib/health-data';
import { listAllEntities, listTypes } from '@/lib/foundry-api';

const TOPIC_KEY = ['entities', 'topic', 'all'] as const;
const NEWS_KEY = ['entities', 'news_item', 'all'] as const;

/** Muted placeholder while a widget's query is in flight. */
function LoadingCard({ title }: { title: string }) {
  return <HealthCard title={title} status="neutral" isLoading isEmpty emptyMessage="Loading…" />;
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

// (2) Source freshness — derived from the latest news each source produced.
export function SourceFreshnessWidget({ title = 'Source freshness' }: { title?: string }) {
  const newsQuery = useQuery({ queryKey: NEWS_KEY, queryFn: () => listAllEntities('news_item') });

  if (newsQuery.isLoading) return <LoadingCard title={title} />;
  if (newsQuery.isError) return <ErrorCard title={title} />;

  const sources = sourceFreshnessFromNews(newsQuery.data ?? []);

  return (
    <SourceFreshness
      title={title}
      sources={sources}
      emptyMessage="No source activity yet."
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
