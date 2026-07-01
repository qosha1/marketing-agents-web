'use client';

/**
 * App home for a Foundry-templated tenant app. A product overview, not a data
 * console: one card per declared type — status types show a live breakdown
 * ("2 ready") that links to their board; others show a count. Fully data-driven
 * from the tenant's own schema, so it adapts to whatever this app models. Yours
 * to redesign.
 */
import Link from 'next/link';
import { useQuery, useQueries } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@startsimpli/ui';
import { ArrowRight } from 'lucide-react';

import { listTypes, listEntities, type EntityRecord, type EntityTypeDef } from '@/lib/foundry-api';
import {
  boardColumns,
  choicesOf,
  groupByStatus,
  pickStatusAttr,
  typeRoute,
  UNSET_COLUMN,
} from '@/lib/board';
import { FOUNDRY } from '@/foundry.config';

export default function HomePage() {
  const typesQuery = useQuery({ queryKey: ['schema-types'], queryFn: () => listTypes() });
  const types = typesQuery.data?.results ?? [];

  // One page-1 query per type: enough for the count + a status breakdown of the
  // most recent records. Types are few, so this is cheap.
  const recordQueries = useQueries({
    queries: types.map((t) => ({
      queryKey: ['entities', t.key, 1],
      queryFn: () => listEntities(t.key, 1),
    })),
  });

  const brand = FOUNDRY.name && !FOUNDRY.name.startsWith('__') ? FOUNDRY.name : FOUNDRY.slug;
  const tagline = FOUNDRY.tagline && !FOUNDRY.tagline.startsWith('__') ? FOUNDRY.tagline : 'Your workspace';

  // status types (actionable) first, then the rest
  const ordered = [...types.keys()].sort((a, b) => {
    const sa = pickStatusAttr(types[a]) ? 0 : 1;
    const sb = pickStatusAttr(types[b]) ? 0 : 1;
    return sa - sb;
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{brand}</h1>
        <p className="text-sm text-gray-500">{tagline}</p>
      </div>

      {typesQuery.isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : types.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-gray-600">
            Nothing here yet — model your first type in the Foundry console, and it will show up
            as a section here.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ordered.map((i) => (
            <TypeCard key={String(types[i].id)} type={types[i]} records={recordQueries[i]?.data?.results ?? []} total={recordQueries[i]?.data?.count ?? 0} loading={recordQueries[i]?.isLoading ?? true} />
          ))}
        </div>
      )}
    </div>
  );
}

function TypeCard({
  type,
  records,
  total,
  loading,
}: {
  type: EntityTypeDef;
  records: EntityRecord[];
  total: number;
  loading: boolean;
}) {
  const href = typeRoute(type);
  const statusAttr = pickStatusAttr(type);
  const cols = boardColumns(statusAttr);
  const grouped = statusAttr ? groupByStatus(records, statusAttr.name, cols) : null;
  const choices = choicesOf(statusAttr);

  return (
    <Link href={href} className="block">
      <Card className="h-full transition hover:border-primary-400 hover:shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-base">
            {type.label}
            <span className="text-sm font-normal text-gray-400">{loading ? '—' : total}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {statusAttr && grouped ? (
            <div className="flex flex-wrap gap-1.5">
              {choices.map((c) => {
                const n = grouped[c]?.length ?? 0;
                if (!n) return null;
                return (
                  <span key={c} className="rounded-full bg-primary-50 px-2 py-0.5 text-xs text-primary-700">
                    {n} {c}
                  </span>
                );
              })}
              {(grouped[UNSET_COLUMN.id]?.length ?? 0) > 0 && (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                  {grouped[UNSET_COLUMN.id].length} unset
                </span>
              )}
              {total === 0 && <span className="text-xs text-gray-400">No records yet</span>}
            </div>
          ) : (
            <p className="flex items-center gap-1 text-sm text-primary-600">
              Open <ArrowRight className="h-4 w-4" />
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
