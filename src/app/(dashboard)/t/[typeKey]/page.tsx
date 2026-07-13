'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { UnifiedTable, Button, BaseDialog } from '@startsimpli/ui';
import { listTypes, listEntities, listAllEntities, type EntityRecord } from '@/lib/foundry-api';
import { RecordForm } from '@/components/record-form';
import { buildRecordColumns } from '@/components/record-columns';
import { pickStatusAttr, readData } from '@/lib/board';
import { CONTENT_TYPE_ATTR, contentCategoryLabel } from '@/lib/content';

const PAGE_SIZE = 20; // matches DRF PageNumberPagination's default page size

export default function TypeRecordsPage() {
  const params = useParams<{ typeKey: string }>();
  const typeKey = params.typeKey;
  const searchParams = useSearchParams();
  const [page, setPage] = useState(1);
  const [addOpen, setAddOpen] = useState(false);

  // The schema/types endpoint returns every declared type with nested
  // attributes; pick out the one this route is for.
  const typesQuery = useQuery({
    queryKey: ['schema-types'],
    queryFn: () => listTypes(),
  });
  const type = typesQuery.data?.results.find((t) => t.key === typeKey);

  // Content tab (parity with the board): when a `content_type` param is present
  // AND this type carries the content_type attribute, show only that category.
  // The backend can't filter entities by a data-blob field, so a filtered view
  // fetches the (bounded) full set and narrows client-side; with no param it's
  // the unchanged server-paginated table.
  const hasContentTypeAttr = useMemo(
    () => (type?.attributes ?? []).some((a) => a.name === CONTENT_TYPE_ATTR),
    [type?.attributes],
  );
  const contentTypeParam = searchParams.get(CONTENT_TYPE_ATTR);
  const contentFilter = contentTypeParam && hasContentTypeAttr ? contentTypeParam : null;

  const pagedQuery = useQuery({
    queryKey: ['entities', typeKey, page],
    queryFn: () => listEntities(typeKey, page),
    enabled: !contentFilter,
  });

  const filteredQuery = useQuery({
    queryKey: ['entities', typeKey, 'all', contentFilter],
    queryFn: () => listAllEntities(typeKey),
    enabled: !!contentFilter,
    select: (rows: EntityRecord[]) =>
      rows.filter((r) => readData(r.data, CONTENT_TYPE_ATTR) === contentFilter),
  });

  const columns = useMemo(
    () => buildRecordColumns(type?.attributes ?? []),
    [type?.attributes],
  );

  const hasStatusBoard = useMemo(() => !!pickStatusAttr(type), [type]);

  // Column picker (built into UnifiedTable): a type with many attributes would
  // otherwise overflow the page, so show a compact default (Name + the first few
  // fields) and let the user reveal/hide the rest from the "Columns" menu. Choice
  // persists per type. Name always stays.
  const columnVisibility = useMemo(() => {
    const DEFAULT_FIELDS = 4;
    const attrIds = (type?.attributes ?? []).map((a) => a.name);
    return {
      enabled: true,
      alwaysVisible: ['name'],
      defaultVisible: ['name', ...attrIds.slice(0, DEFAULT_FIELDS)],
      persistKey: `records-${typeKey}`,
    };
  }, [type?.attributes, typeKey]);

  const records = contentFilter
    ? (filteredQuery.data ?? [])
    : (pagedQuery.data?.results ?? []);
  const totalCount = contentFilter ? records.length : (pagedQuery.data?.count ?? 0);
  const recordsLoading = contentFilter ? filteredQuery.isLoading : pagedQuery.isLoading;

  if (typesQuery.isLoading) {
    return <p className="text-sm text-gray-500">Loading…</p>;
  }

  if (!type) {
    return (
      <div className="space-y-4">
        <p className="text-gray-600">
          No type called <span className="font-mono">{typeKey}</span> yet.
        </p>
        <p className="text-sm text-gray-500">
          Types are defined in the Foundry console, then appear here automatically.
        </p>
      </div>
    );
  }

  // Full-width table; the create form lives behind the "Add" button (a dialog)
  // instead of permanently occupying half the screen.
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900">
          {contentFilter ? contentCategoryLabel(contentFilter) : type.label}
        </h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">{totalCount} total</span>
          {hasStatusBoard ? (
            <Link href={`/board/${encodeURIComponent(typeKey)}`}>
              <Button variant="outline" size="sm">
                Board view
              </Button>
            </Link>
          ) : null}
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Add {type.label.toLowerCase()}
          </Button>
        </div>
      </div>

      <UnifiedTable<EntityRecord>
        tableId={`records-${typeKey}`}
        data={records}
        columns={columns}
        getRowId={(row) => String(row.id)}
        loading={recordsLoading}
        columnVisibility={columnVisibility}
        pagination={{
          // A filtered content-tab view holds the whole (bounded) category set,
          // so the table paginates it client-side; the default view stays
          // server-paginated.
          enabled: true,
          serverSide: !contentFilter,
          pageSize: PAGE_SIZE,
          totalCount,
          currentPage: page,
          onPageChange: setPage,
        }}
      />

      <BaseDialog open={addOpen} onOpenChange={setAddOpen} size="lg">
        <RecordForm
          type={type}
          onSuccess={() => setAddOpen(false)}
          onCancel={() => setAddOpen(false)}
        />
      </BaseDialog>
    </div>
  );
}
