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

import { listTypes, orgMembers } from '@/lib/foundry-api';
import { revisionFeedClient } from '@/lib/revisions';
import { renderNextLink, tableRecordHref } from '@/lib/activity-links';
import { memberEmail, memberSub, normalizeMembers } from '@/lib/roster';
import { storyHref } from '@/lib/story-nav';
import { humanizeHeader } from '@/components/record-columns';

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

  // Field rows read as the record forms and table headers do — "Kind", "Scope
  // path" — not as storage keys (bd startsim-9jpub).
  const fieldLabel = useCallback((field: string) => humanizeHeader(field), []);

  // Everyone on the team can be picked from the first load, not only people
  // whose edits happen to be on the loaded page (bd startsim-tfr9a). The roster
  // needs an admin bearer; for anyone else it is refused and the picker falls
  // back to the people seen in the feed, as before.
  const membersQuery = useQuery({
    queryKey: ['org-members'],
    queryFn: () => orgMembers(),
    retry: false,
  });
  const actorOptions = useMemo(
    () =>
      membersQuery.data
        ? normalizeMembers(membersQuery.data)
            .map((m) => ({ value: memberSub(m), label: memberEmail(m) || memberSub(m) }))
            .filter((o) => o.value)
        : [],
    [membersQuery.data],
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
      // Every other type opens ON the record: its table with that record's
      // drawer open, not the whole table (bd startsim-m7fdm.36).
      return entity.type ? tableRecordHref(entity.type, entity.id) : undefined;
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
        fieldLabel={fieldLabel}
        actorOptions={actorOptions}
        recordHref={recordHref}
        renderLink={renderNextLink}
        queryKey={['revision-feed']}
        title="Activity"
        // The filters say what the page does; a paragraph restating them is
        // noise (bd startsim-3j1p8).
        description={null}
      />
    </div>
  );
}
