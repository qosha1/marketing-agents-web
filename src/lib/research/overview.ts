/**
 * Overview numbers, every one a server-side COUNT (`countEntities` asks for one
 * row plus the COUNT) — never a client scan of a list.
 */
import { countEntities } from '@/lib/foundry-api';

import { dayString } from './filters';

export interface DayBar {
  day: string;
  count: number;
}

export interface OverviewData {
  sourcesConfigured: number;
  sourcesOn: number;
  documentsThisWeek: number;
  /** Documents in the seven days before those. */
  documentsLastWeek: number;
  topicsInProgress: number;
  madeIntoContent: number;
  stages: { collecting: number; ready: number; made: number };
  bars: DayBar[];
}

/** Seven local-day strings ending today, oldest first. */
export function lastSevenDays(now: Date = new Date()): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (6 - i));
    return dayString(d);
  });
}

/**
 * The day after `day`. A day is counted as [day, next day) because the tenant
 * turns a bare-date `__lte` into the START of that day, so `gte=d&lte=d` only
 * matches a document stamped at exactly midnight and every bar read zero.
 */
function dayAfter(day: string): string {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return dayString(d);
}

export async function loadOverview(now: Date = new Date()): Promise<OverviewData> {
  const days = lastSevenDays(now);
  const topicsWith = (status: string) => countEntities('topic', { 'attr.status': status });

  const before = (n: number) => dayString(new Date(new Date(now).setDate(now.getDate() - n)));

  const [sourcesConfigured, sourcesOn, counts, lastWeek, collecting, ready, made] = await Promise.all([
    countEntities('source'),
    countEntities('source', { 'attr.active': 'true' }),
    Promise.all(
      days.map((day) =>
        countEntities('news_item', { 'attr.published_at__gte': day, 'attr.published_at__lt': dayAfter(day) }),
      ),
    ),
    countEntities('news_item', { 'attr.published_at__gte': before(13), 'attr.published_at__lt': before(6) }),
    topicsWith('suggested'),
    topicsWith('ready'),
    topicsWith('written'),
  ]);

  const bars = days.map((day, i) => ({ day, count: counts[i] ?? 0 }));
  return {
    sourcesConfigured,
    sourcesOn,
    documentsThisWeek: bars.reduce((a, b) => a + b.count, 0),
    documentsLastWeek: lastWeek,
    topicsInProgress: collecting + ready,
    madeIntoContent: made,
    stages: { collecting, ready, made },
    bars,
  };
}
