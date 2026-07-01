'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { UnifiedTable, Button } from '@startsimpli/ui';
import { listTypes, listEntities, type EntityRecord } from '@/lib/foundry-api';
import { RecordForm } from '@/components/record-form';
import { buildRecordColumns } from '@/components/record-columns';
import { pickStatusAttr } from '@/lib/board';

const PAGE_SIZE = 20; // matches DRF PageNumberPagination's default page size

export default function TypeRecordsPage() {
  const params = useParams<{ typeKey: string }>();
  const typeKey = params.typeKey;
  const [page, setPage] = useState(1);

  // The schema/types endpoint returns every declared type with nested
  // attributes; pick out the one this route is for.
  const typesQuery = useQuery({
    queryKey: ['schema-types'],
    queryFn: () => listTypes(),
  });
  const type = typesQuery.data?.results.find((t) => t.key === typeKey);

  const recordsQuery = useQuery({
    queryKey: ['entities', typeKey, page],
    queryFn: () => listEntities(typeKey, page),
  });

  const columns = useMemo(
    () => buildRecordColumns(type?.attributes ?? []),
    [type?.attributes],
  );

  const hasStatusBoard = useMemo(() => !!pickStatusAttr(type), [type]);

  const records = recordsQuery.data?.results ?? [];
  const totalCount = recordsQuery.data?.count ?? 0;

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

  return (
    <div className="grid gap-8 lg:grid-cols-[360px_1fr]">
      <div>
        <RecordForm type={type} />
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">{type.label}</h1>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">{totalCount} total</span>
            {hasStatusBoard ? (
              <Link href={`/board/${encodeURIComponent(typeKey)}`}>
                <Button variant="outline" size="sm">
                  Board view
                </Button>
              </Link>
            ) : null}
          </div>
        </div>

        <UnifiedTable<EntityRecord>
          tableId={`records-${typeKey}`}
          data={records}
          columns={columns}
          getRowId={(row) => String(row.id)}
          loading={recordsQuery.isLoading}
          pagination={{
            enabled: true,
            serverSide: true,
            pageSize: PAGE_SIZE,
            totalCount,
            currentPage: page,
            onPageChange: setPage,
          }}
        />
      </div>
    </div>
  );
}
