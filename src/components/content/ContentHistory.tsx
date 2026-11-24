'use client';

/**
 * History card on the Content item (bd startsim-bj3zz.3): one line per change,
 * "who did what · when", newest first. Over the record's revision trail.
 */
import { useQuery } from '@tanstack/react-query';
import type { RevisionClient } from '@startsimpli/ui/history';

import { ago, describeRevision } from '@/lib/content-history';

export function ContentHistory({ client, recordId, version }: { client: RevisionClient; recordId: string; version: number | null }) {
  const q = useQuery({
    queryKey: ['entity', recordId, 'content-history', version],
    queryFn: () => client.list({ page: 1, pageSize: 50 }),
  });
  const rows = q.data?.results ?? [];
  return (
    <section className="space-y-2 rounded-lg border border-border p-4" aria-label="History">
      <h2 className="text-sm font-semibold">History</h2>
      {q.isError ? <p className="text-sm text-neutral-500">History is not available.</p> : null}
      <ul className="space-y-1.5">
        {rows.map((r) => {
          const d = describeRevision(r);
          return (
            <li key={r.id} className="text-sm">
              <b className="font-medium">{d.who}</b> {d.what} <span className="text-neutral-500">· {ago(d.at)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
