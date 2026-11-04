'use client';

/**
 * Projects (bd startsim-frfk8): Name, Client, Sources. Search, sort, a Client
 * filter and paging are all asked of the server.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Button, UnifiedTable, type ColumnConfig, type FiltersConfig } from '@startsimpli/ui';

import { NewProjectDialog } from '@/components/projects/new-project-dialog';
import { SourcesCount } from '@/components/projects/sources-count';
import { PROJECTS_PAGE_SIZE, SOLO_CLIENT, type ProjectRow } from '@/lib/projects';
import { listClients, listProjectsPage } from '@/lib/projects-api';

const COLUMNS: ColumnConfig<ProjectRow>[] = [
  {
    id: 'name',
    header: 'Name',
    sortable: true,
    cell: (row) => (
      <Link href={`/projects/${row.id}`} className="font-medium text-primary-700 hover:underline">
        {row.name}
      </Link>
    ),
  },
  { id: 'client', header: 'Client', sortable: true, cell: (row) => row.client ?? '' },
  { id: 'sources', header: 'Sources', cell: (row) => <SourcesCount path={row.path} /> },
];

export function ProjectsList() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ sortBy: string | null; sortDirection: 'asc' | 'desc' }>({
    sortBy: null,
    sortDirection: 'asc',
  });
  const [clientPath, setClientPath] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const clientsQuery = useQuery({ queryKey: ['projects', 'clients'], queryFn: listClients });
  const clients = clientsQuery.data ?? [];

  const query = { search, ...sort, clientPath };
  const listQuery = useQuery({
    queryKey: ['projects', 'list', page, query, clients],
    queryFn: () => listProjectsPage(page, query, clients),
    enabled: clientsQuery.isSuccess || clientsQuery.isError,
  });

  const filters: FiltersConfig | undefined =
    clients.length > 0
      ? {
          enabled: true,
          position: 'top',
          collapsible: false,
          defaultExpanded: true,
          config: {
            sections: [
              {
                id: 'client',
                type: 'chips',
                filters: [
                  {
                    id: 'client',
                    label: 'Client',
                    options: [...clients.map((c) => c.path), SOLO_CLIENT],
                    optionLabels: {
                      ...Object.fromEntries(clients.map((c) => [c.path, c.name])),
                      [SOLO_CLIENT]: 'No client',
                    },
                  },
                ],
              },
            ],
          },
          value: clientPath ? { client: clientPath } : {},
          onChange: (fs) => {
            setClientPath((fs.client as string | undefined) || null);
            setPage(1);
          },
        }
      : undefined;

  const count = listQuery.data?.count ?? 0;
  const filtered = !!search.trim() || !!clientPath;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-gray-900">Projects</h1>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          New project
        </Button>
      </div>

      <UnifiedTable<ProjectRow>
        tableId="projects"
        data={listQuery.data?.rows ?? []}
        columns={COLUMNS}
        getRowId={(row) => String(row.id)}
        loading={listQuery.isLoading}
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
        filters={filters}
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
          <div className="space-y-2 py-8 text-center text-sm text-gray-600">
            <p>{filtered ? 'No matches.' : 'No projects yet.'}</p>
            {filtered ? null : <p>Create one to start collecting sources and writing.</p>}
          </div>
        }
      />

      <NewProjectDialog open={dialogOpen} onOpenChange={setDialogOpen} clients={clients} />
    </div>
  );
}
