'use client';

/**
 * The one write path for a v2 Content item (bd startsim-nkvgn).
 *
 * Every write sends the WHOLE data blob (the backend PATCH replaces it) merged
 * over the freshest copy of the record, asserting the version it loaded through
 * `useConditionalSave`, so a stale save is refused instead of overwriting the
 * other reviewer. Writes are queued one at a time: an autosave and an Approve
 * pressed together each merge over the other's result instead of racing.
 */
import { useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { notify } from '@startsimpli/ui';
import { useConditionalSave, type ConditionalSaveResult } from '@startsimpli/ui/history';

import { primeEntity } from '@/lib/entity-cache';
import { entityWriteClient, type EntityRecord } from '@/lib/foundry-api';
import { revisionClient } from '@/lib/revisions';

type Data = Record<string, unknown>;

export function useContentWrite(initial: EntityRecord) {
  const qc = useQueryClient();
  const [record, setRecord] = useState(initial);
  const recordRef = useRef(initial);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const writeClient = useMemo(() => entityWriteClient(initial.id), [initial.id]);
  const revisions = useMemo(() => revisionClient(initial.id), [initial.id]);
  const save = useConditionalSave({ client: writeClient, version: initial.version ?? undefined, revisions });

  function report(result: ConditionalSaveResult, whatFailed: string): boolean {
    if (result.status === 'saved') {
      const saved = result.outcome.body as EntityRecord | undefined;
      if (saved?.id !== undefined) {
        recordRef.current = saved;
        setRecord(saved);
        primeEntity(qc, initial.id, saved);
      }
      return true;
    }
    if (result.status === 'failed') {
      notify.error(result.error instanceof Error ? result.error.message : whatFailed);
    }
    // A pause means a stale-save dialog was dismissed; put it back rather than
    // let every later write be refused in silence.
    if (result.status === 'paused') save.reopenConflict();
    return false;
  }

  /**
   * `change` receives the freshest data blob and returns the next one. Resolves
   * true only when it is on the server.
   */
  function write(change: (data: Data) => Data, whatFailed = 'Could not save.'): Promise<boolean> {
    const run = async () => {
      const next = change({ ...recordRef.current.data });
      return report(await save.save({ data: next }), whatFailed);
    };
    const result = queue.current.then(run, run);
    queue.current = result.catch(() => false);
    return result;
  }

  /** The freshest record the server has confirmed (not the render snapshot). */
  const latest = () => recordRef.current;

  return { record, write, save, latest };
}
