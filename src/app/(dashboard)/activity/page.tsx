'use client';

/**
 * Activity — every edit across records, newest first: who changed what, and
 * whether a person or a machine did it (bd startsim-1pqb9; feed bd
 * startsim-ivr3n; composer bd startsim-ucg5u).
 *
 * The customer's question — "what did Jurga change this week?", "what did the
 * pipeline overwrite?" — answered by the shared `RecordActivityPanel` over this
 * app's raw, cursor-paged reader. Nothing about the feed lives here.
 *
 * THE FILTERS LIVE IN THE URL, ON THIS PAGE. Not in component state (lost on
 * reload, unshareable) and not in a Next layout, which does not re-render on soft
 * navigation, so a filter read there goes stale on the first click. A person's
 * "their recent edits" link elsewhere in the app is simply `/activity?actor=<sub>`
 * (lib/activity-links.ts).
 */
import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  RecordActivityPanel,
  revisionFeedFiltersFrom,
  revisionFeedParams,
  type RevisionFeedEntity,
  type RevisionFeedFilters,
} from '@startsimpli/ui/history';

import { listTypes } from '@/lib/foundry-api';
import { revisionFeedClient } from '@/lib/revisions';
import { renderNextLink } from '@/lib/activity-links';
import { storyHref } from '@/lib/story-nav';

const TOPIC_TYPE = 'topic';
const DRAFT_TYPE = 'draft';

export default function ActivityPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname() || '/activity';

  const filters = useMemo(() => revisionFeedFiltersFrom(searchParams), [searchParams]);
  const client = useMemo(() => revisionFeedClient(), []);

  // The tenant's DECLARED types, by their own labels — never a list in this file.
  const typesQuery = useQuery({ queryKey: ['schema-types'], queryFn: () => listTypes() });
  const types = useMemo(() => typesQuery.data?.results ?? [], [typesQuery.data]);
  const typeOptions = useMemo(
    () => types.map((t) => ({ value: t.key, label: t.label || t.key })),
    [types],
  );
  const typeLabel = useCallback(
    (key: string) => types.find((t) => t.key === key)?.label || key,
    [types],
  );

  const here = useMemo(() => {
    const qs = new URLSearchParams(revisionFeedParams(filters) as Record<string, string>).toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }, [filters, pathname]);

  const onFiltersChange = useCallback(
    (next: RevisionFeedFilters) => {
      const qs = new URLSearchParams(revisionFeedParams(next) as Record<string, string>).toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  // Every row opens its record where a reviewer edits it. A topic carries this
  // page back in `?from=`, so "Back" returns to the same filtered feed.
  const recordHref = useCallback(
    (entity: RevisionFeedEntity) => {
      if (!entity?.id) return undefined;
      if (entity.type === TOPIC_TYPE) return storyHref(entity.id, here);
      if (entity.type === DRAFT_TYPE) return `/draft/${encodeURIComponent(String(entity.id))}`;
      return entity.type ? `/t/${encodeURIComponent(entity.type)}` : undefined;
    },
    [here],
  );

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <RecordActivityPanel
        client={client}
        filters={filters}
        onFiltersChange={onFiltersChange}
        typeOptions={typeOptions}
        typeLabel={typeLabel}
        recordHref={recordHref}
        renderLink={renderNextLink}
        queryKey={['revision-feed']}
        title="Activity"
      />
    </div>
  );
}
