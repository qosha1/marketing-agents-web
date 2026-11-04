'use client';

import { useCallback, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';

import { listEntities, type EntityFilters } from '@/lib/foundry-api';
import type { SortState } from './filters';

export const RESEARCH_PAGE_SIZE = 20; // the tenant's default page size

/** Page, search and sort state for a Research table, plus its server-paged query. */
export function useResearchList(type: string, build: (q: { search: string; sort: SortState }) => EntityFilters, extra: unknown[] = []) {
  const [page, setPage] = useState(1);
  const [search, setSearchRaw] = useState('');
  const [sort, setSortRaw] = useState<SortState>({});

  const filters = build({ search, sort });
  const query = useQuery({
    queryKey: ['research', type, page, filters, ...extra],
    queryFn: () => listEntities(type, page, filters),
    placeholderData: keepPreviousData,
  });

  const setSearch = useCallback((v: string) => {
    setSearchRaw(v);
    setPage(1);
  }, []);
  const setSort = useCallback((s: { sortBy: string | null; sortDirection: 'asc' | 'desc' }) => {
    setSortRaw({ by: s.sortBy, dir: s.sortDirection });
    setPage(1);
  }, []);

  return {
    page, setPage, search, setSearch, sort, setSort, query,
    rows: query.data?.results ?? [],
    total: query.data?.count ?? 0,
    loading: query.isLoading,
    filtersApplied: Boolean(search.trim()),
  };
}

export function tablePaging(l: { page: number; total: number; setPage: (p: number) => void }) {
  return {
    enabled: true,
    pageSize: RESEARCH_PAGE_SIZE,
    totalCount: l.total,
    currentPage: l.page,
    serverSide: true,
    onPageChange: l.setPage,
  };
}

export function tableSorting(l: { sort: SortState; setSort: (s: { sortBy: string | null; sortDirection: 'asc' | 'desc' }) => void }) {
  return {
    enabled: true,
    serverSide: true,
    value: { sortBy: l.sort.by ?? null, sortDirection: l.sort.dir ?? 'asc' },
    onChange: l.setSort,
  } as const;
}
