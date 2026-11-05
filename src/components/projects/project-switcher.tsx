'use client';

/**
 * Sidebar switcher (bd startsim-4ma5a). Scopes every list to one top-level scope
 * (a client and all its projects, or a solo project); "All" clears it. Hidden
 * when there is nothing to choose between. Also gives a first-time user their
 * default project (a tenant with no scopes at all).
 */
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@startsimpli/auth';

import { listAllEntities } from '@/lib/foundry-api';
import { ensureDefaultProject } from '@/lib/projects-api';
import { PROJECT_TYPE } from '@/lib/projects';
import { setActiveProjectId, switcherOptions } from '@/lib/project-scope';
import { useActiveProjectId } from '@/lib/use-active-project';

export function ProjectSwitcher() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const active = useActiveProjectId();
  const scopes = useQuery({
    queryKey: ['projects', 'switcher'],
    queryFn: () => listAllEntities(PROJECT_TYPE),
    staleTime: 60_000,
  });

  const empty = scopes.isSuccess && scopes.data.length === 0;
  useEffect(() => {
    if (!empty) return;
    const account = { name: (user as { name?: string } | null)?.name, email: user?.email };
    void ensureDefaultProject(account)
      .then((made) => made && queryClient.invalidateQueries({ queryKey: ['projects'] }))
      .catch(() => {});
  }, [empty, user, queryClient]);

  const options = switcherOptions(scopes.data ?? []);
  if (options.length <= 1) return null;

  return (
    <div className="px-3 pt-3">
      <label htmlFor="project-switcher" className="sr-only">
        Project
      </label>
      <select
        id="project-switcher"
        value={active ?? ''}
        onChange={(e) => {
          setActiveProjectId(e.target.value || null);
          // Every list re-asks with the new scope.
          void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'projects' && q.queryKey[0] !== 'schema-types' });
        }}
        className="h-9 w-full rounded-md border border-gray-300 bg-white px-2 text-sm"
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o.path} value={o.path}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
