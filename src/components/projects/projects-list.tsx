'use client';

/**
 * Projects (wireframe V08, bd startsim-frfk8): Name, Client, Sources. Search, sort,
 * the Client filter and paging are all asked of the server. The Client column and
 * filter only exist once the account has a client; a project of your own has none.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Plus } from 'lucide-react';
import { Button, UnifiedTable, type ColumnConfig } from '@startsimpli/ui';

import { NewProjectDialog } from '@/components/projects/new-project-dialog';
import { SourcesCount } from '@/components/projects/sources-count';
import { ResearchHead, plural } from '@/components/research/page-head';
import { PROJECTS_PAGE_SIZE, SOLO_CLIENT, type ProjectRow } from '@/lib/projects';
import { listClients, listProjectsPage } from '@/lib/projects-api';
import { useActiveProjectId } from '@/lib/use-active-project';

const selectClass = 'h-9 rounded-md border border-border bg-background px-2 text-sm text-neutral-800';

export function ProjectsList() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ sortBy: string | null; sortDirection: 'asc' | 'desc' }>({
    sortBy: null,
    sortDirection: 'asc',
  });
  const [clientPath, setClientPath] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const router = useRouter();
  const activePath = useActiveProjectId();

  const clientsQuery = useQuery({ queryKey: ['projects', 'clients'], queryFn: listClients });
  const clients = clientsQuery.data ?? [];

  const query = { search, ...sort, clientPath };
  const listQuery = useQuery({
    queryKey: ['projects', 'list', page, query, clients],
    queryFn: () => listProjectsPage(page, query, clients),
    enabled: clientsQuery.isSuccess || clientsQuery.isError,
  });

  const hasClients = clients.length > 0;

  const columns: ColumnConfig<ProjectRow>[] = [
    {
      id: 'name',
      header: 'Name',
      sortable: true,
      cell: (row) => (
        <span className="flex items-center gap-2">
          <span className="font-medium text-neutral-900">{row.name}</span>
          {row.path === activePath ? (
            <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">Current</span>
          ) : null}
        </span>
      ),
    },
    ...(hasClients
      ? [{ id: 'client', header: 'Client', sortable: true, width: 200, cell: (row: ProjectRow) => row.client ?? '' }]
      : []),
    { id: 'sources', header: 'Sources', sortable: false, width: 130, cell: (row) => <SourcesCount path={row.path} /> },
    {
      id: 'open',
      header: '',
      sortable: false,
      width: 40,
      cell: () => <ChevronRight className="h-4 w-4 text-neutral-400" aria-hidden />,
    },
  ];

  const count = listQuery.data?.count ?? 0;
  const filtered = !!search.trim() || !!clientPath;

  return (
    <div className="space-y-4">
      <ResearchHead
        title="Projects"
        sub={plural(count, 'project')}
        action={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            New project
          </Button>
        }
      />

      {hasClients ? (
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="f-client">
            Client
          </label>
          <select
            id="f-client"
            className={selectClass}
            value={clientPath ?? ''}
            onChange={(e) => {
              setClientPath(e.target.value || null);
              setPage(1);
            }}
          >
            <option value="">Client: all</option>
            {clients.map((c) => (
              <option key={c.path} value={c.path}>
                {c.name}
              </option>
            ))}
            <option value={SOLO_CLIENT}>No client</option>
          </select>
        </div>
      ) : null}

      <UnifiedTable<ProjectRow>
        tableId="projects"
        data={listQuery.data?.rows ?? []}
        columns={columns}
        getRowId={(row) => String(row.id)}
        loading={listQuery.isLoading}
        onRowClick={(row) => router.push(`/projects/${row.id}`)}
        search={{
          enabled: true,
          placeholder: 'Search projects…',
          value: search,
          onChange: (v) => {
            setSearch(v);
            setPage(1);
          },
          debounceMs: 300,
          preserveFocus: true,
        }}
        sorting={{
          enabled: true,
          serverSide: true,
          value: sort,
          onChange: (s) => {
            setSort({ sortBy: s.sortBy, sortDirection: s.sortDirection });
            setPage(1);
          },
        }}
        pagination={{
          enabled: count > 0,
          serverSide: true,
          pageSize: PROJECTS_PAGE_SIZE,
          totalCount: count,
          currentPage: page,
          onPageChange: setPage,
        }}
        emptyState={
          filtered ? (
            <p className="py-8 text-center text-sm text-neutral-500">No projects match.</p>
          ) : (
            <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-12 text-center">
              <p className="text-base font-semibold text-neutral-900">Start your first project</p>
              <p className="text-sm text-neutral-600">
                A project is what you write for: your business, a product, a campaign, or a client’s account. It gets its own
                sources, content types and team.
              </p>
              <Button onClick={() => setDialogOpen(true)}>
                <Plus className="mr-1.5 h-4 w-4" />
                New project
              </Button>
              <p className="text-xs text-neutral-500">Writing for clients? You can pick or add one when you create the project.</p>
            </div>
          )
        }
      />

      <NewProjectDialog open={dialogOpen} onOpenChange={setDialogOpen} clients={clients.filter((c) => c.active)} />
    </div>
  );
}
