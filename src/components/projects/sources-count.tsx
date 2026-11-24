'use client';

import { useQuery } from '@tanstack/react-query';

import { countProjectSources } from '@/lib/projects-api';

/** A project's source count, or a dash while sources are not scoped to a project. */
export function SourcesCount({ path }: { path: string }) {
  const q = useQuery({
    queryKey: ['projects', 'sources', path],
    queryFn: () => countProjectSources(path),
    staleTime: 60_000,
  });
  return <span className="text-gray-600">{q.data == null ? '—' : q.data}</span>;
}
