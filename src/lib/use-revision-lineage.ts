'use client';

/**
 * The draft's AI-revision lineage and the "Compare to previous" blog diff (split
 * out of the page, bd startsim-m7fdm.27, to keep it under 1,000 lines). The AI
 * rewrite itself was removed (bd startsim-whwxd.6); drafts it already made still
 * carry `revised_from`.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { unifiedTextDiff } from '@startsimpli/ui/history';

import { readData } from '@/lib/board';
import { entityKey } from '@/lib/entity-cache';
import { getEntity, type EntityRecord } from '@/lib/foundry-api';
import { revisedFrom, revisionChain } from '@/lib/review';

export function useRevisionLineage(
  draft: EntityRecord,
  allDrafts: EntityRecord[],
  thisBlog: string,
  showDiff: boolean,
) {
  const chain = useMemo(() => revisionChain(draft, allDrafts), [draft, allDrafts]);
  const children = useMemo(
    () => allDrafts.filter((d) => revisedFrom(d) === String(draft.id)),
    [allDrafts, draft.id],
  );
  const latestChild = children.length
    ? children.reduce((a, b) => (a.id > b.id ? a : b))
    : null;
  const parentId = revisedFrom(draft);

  // Parent draft (for the "Compare to previous" blog diff) — fetched only when the
  // reviewer opens the diff on a revised draft.
  const parentQuery = useQuery({
    queryKey: entityKey(parentId),
    queryFn: () => getEntity(parentId),
    enabled: !!parentId && showDiff,
  });
  const parentBlog = parentQuery.data ? String(readData(parentQuery.data.data, 'blog') ?? '') : '';
  // `blog.md` explicitly: the shared helper is generic over any record field and
  // defaults to `value.txt`, while the DiffViewer prints the path in its header
  // and this diff is a blog body.
  const blogDiff = useMemo(
    () => unifiedTextDiff(parentBlog, thisBlog, 'blog.md'),
    [parentBlog, thisBlog],
  );


  return { chain, latestChild, parentId, parentQuery, blogDiff };
}
