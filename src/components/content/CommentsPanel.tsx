'use client';

/**
 * Comments on the whole item (bd startsim-nkvgn): a plain list and a box. Over
 * the same comment threads the tenant already stores (`comments/`), record-level
 * so no text span is involved. No mentions, no resolve, no show-changes.
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@startsimpli/ui';

import { readComments } from '@/lib/content-comments';
import { ago } from '@/lib/content-history';
import { trackChangesClient } from '@/lib/track-changes';

export function CommentsPanel({ recordId }: { recordId: string }) {
  const qc = useQueryClient();
  const client = useMemo(() => trackChangesClient(recordId), [recordId]);
  const key = ['entity', recordId, 'comments'];
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const comments = useQuery({
    queryKey: key,
    queryFn: async () => readComments(await client.listComments!({ field: undefined as unknown as string, status: 'all' })),
  });

  async function post() {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    setError('');
    try {
      await client.comment!({ body });
      setText('');
      await qc.invalidateQueries({ queryKey: key });
    } catch {
      setError('Could not post the comment.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-lg border border-border p-4" aria-label="Comments">
      <h2 className="text-sm font-semibold">Comments</h2>
      {comments.isError ? <p className="text-sm text-neutral-500">Could not load comments.</p> : null}
      <ul className="space-y-2">
        {(comments.data ?? []).map((c) => (
          <li key={c.id} className="text-sm">
            <span className="font-medium">{c.who}</span>{' '}
            <span className="text-xs text-neutral-500">{ago(c.when)}</span>
            <p className="text-neutral-700">{c.text}</p>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input
          aria-label="Comment"
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
          placeholder="Comment…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void post(); }}
        />
        <Button variant="secondary" disabled={busy || !text.trim()} onClick={() => void post()}>Post</Button>
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </section>
  );
}
