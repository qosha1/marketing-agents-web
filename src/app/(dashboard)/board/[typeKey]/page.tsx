'use client';

/**
 * Generic status-board page for any entity type (bd ogmc-9ms.1.7/.1.9). Groups
 * the type's records into lanes by its status enum and opens a detail/edit drawer
 * on click. Falls back to a pointer to the table view for types without a status
 * field. Reusable across tenants — the route is /board/<typeKey>.
 */
import { useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';

import { EntityBoard } from '@/components/entity-board';
import { EntityDetailDrawer } from '@/components/entity-detail-drawer';
import { pickStatusAttr, readData } from '@/lib/board';
import { CONTENT_TYPE_ATTR, contentCategoryLabel } from '@/lib/content';
import { listAllEntities, listTypes, type EntityRecord } from '@/lib/foundry-api';

export default function BoardPage() {
  const params = useParams<{ typeKey: string }>();
  const typeKey = String(params.typeKey);
  const searchParams = useSearchParams();

  const typesQuery = useQuery({ queryKey: ['schema-types'], queryFn: () => listTypes() });
  const type = typesQuery.data?.results.find((t) => t.key === typeKey);

  const recordsQuery = useQuery({
    queryKey: ['entities', typeKey, 'all'],
    queryFn: () => listAllEntities(typeKey),
  });

  // Content tab: when a `content_type` param is present AND this type carries the
  // content_type attribute, narrow the board to that one category (each tab is the
  // topic pipeline filtered to weekly_brief / lead_magnet / general). With no param
  // — or on a type without the attr — the board behaves exactly as before.
  const hasContentTypeAttr = useMemo(
    () => (type?.attributes ?? []).some((a) => a.name === CONTENT_TYPE_ATTR),
    [type?.attributes],
  );
  const contentTypeParam = searchParams.get(CONTENT_TYPE_ATTR);
  const activeContentType = contentTypeParam && hasContentTypeAttr ? contentTypeParam : null;

  const records = useMemo(() => {
    const all = recordsQuery.data ?? [];
    if (!activeContentType) return all;
    return all.filter((r) => readData(r.data, CONTENT_TYPE_ATTR) === activeContentType);
  }, [recordsQuery.data, activeContentType]);

  const [selected, setSelected] = useState<EntityRecord | null>(null);
  const statusAttr = useMemo(() => pickStatusAttr(type), [type]);
  const loading = typesQuery.isLoading || recordsQuery.isLoading;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">
            {activeContentType
              ? contentCategoryLabel(activeContentType)
              : `${type?.label ?? typeKey} — Board`}
          </h1>
          <p className="text-sm text-neutral-500">{records.length} records</p>
        </div>
        <Link
          href={`/t/${typeKey}`}
          className="rounded border px-3 py-1.5 text-sm hover:bg-neutral-50"
        >
          Table view
        </Link>
      </div>

      {loading ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : !type ? (
        <p className="text-sm text-neutral-500">Unknown type “{typeKey}”.</p>
      ) : !statusAttr ? (
        <div className="rounded border p-4 text-sm text-neutral-600">
          This type has no “status” (choice) field, so there is nothing to lay out as a board.{' '}
          <Link href={`/t/${typeKey}`} className="underline">
            Open the table view
          </Link>
          .
        </div>
      ) : (
        <EntityBoard type={type} records={records} onCardClick={setSelected} />
      )}

      {type ? (
        <EntityDetailDrawer
          type={type}
          record={selected}
          onClose={() => setSelected(null)}
          onSaved={() => recordsQuery.refetch()}
        />
      ) : null}
    </div>
  );
}
