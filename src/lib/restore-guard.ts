/**
 * After a restore, nothing the editor had queued may land on top of it
 * (bd startsim-vehzd).
 *
 * The draft page autosaves on a 1,200 ms debounce (the blog and document
 * editors) and the scorecard on 800 ms, and every PATCH carries the WHOLE blob
 * from the editor's local copy. A reviewer who types, then restores the blog to
 * v2 inside that window, would get the restore — and a second later the
 * autosave would PATCH the old blog straight back over it. (The version guard
 * would usually refuse that PATCH with a 412, which is better than an overwrite
 * and still wrong: a conflict dialog about a change the reviewer just chose.)
 *
 * So around the restore the page:
 *   1. BLOCKS every write through {@link WriteGate} and cancels its own timers;
 *   2. waits out a save already in flight;
 *   3. FLUSHES what was typed — only if something WAS typed and not yet saved —
 *      through the conditional save directly, so nothing typed is lost (it
 *      becomes its own revision) and the version the restore asserts is the one
 *      that flush produced. NOT unconditionally: the page's whole-blob PATCH
 *      also normalises fields nobody touched (sources, source_meta, review,
 *      notes), so a flush with nothing typed wrote a revision attributing four
 *      untouched fields to the reviewer — measured on the offline stack;
 *   4. on success, remembers the restored version and REMOUNTS the editor from
 *      the server's copy — the remount clears every editor debounce on unmount.
 *
 * Kept out of the page so the race can be tested with fake timers.
 */
import type { ParsedRestoreOutcome } from '@startsimpli/ui/history';

export interface WriteGate {
  /** Run a write unless the gate is closed; `whenBlocked` is returned instead. */
  run<T>(write: () => Promise<T>, whenBlocked: T): Promise<T>;
  /** Close the gate. The returned release reopens it (idempotent). */
  block(): () => void;
  /** Settle every write the gate let through. */
  drain(): Promise<void>;
  readonly blocked: boolean;
}

export function createWriteGate(): WriteGate {
  let holds = 0;
  const inFlight = new Set<Promise<unknown>>();
  return {
    async run<T>(write: () => Promise<T>, whenBlocked: T): Promise<T> {
      if (holds > 0) return whenBlocked;
      const p = write();
      inFlight.add(p);
      try {
        return await p;
      } finally {
        inFlight.delete(p);
      }
    },
    block() {
      holds += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holds -= 1;
      };
    },
    async drain() {
      await Promise.allSettled([...inFlight]);
    },
    get blocked() {
      return holds > 0;
    },
  };
}

export type FlushResult = 'saved' | 'refused' | 'failed' | 'paused';

export interface RestoreHookDeps {
  gate: WriteGate;
  /** Clear the page's own debounce timers. */
  cancelTimers: () => void;
  /** Save what the editor holds NOW, bypassing the gate. */
  flush: () => Promise<FlushResult>;
  /** Whether anything was typed that has not been saved. Absent = assume yes. */
  hasUnsaved?: () => boolean;
  /** Refetch the record and remount the editor from it. */
  reload: () => Promise<void>;
  /** Note the restored record's version (lib/record-version.ts). */
  remember: (record: Record<string, unknown>) => void;
}

export function restoreHooks({ gate, cancelTimers, flush, hasUnsaved, reload, remember }: RestoreHookDeps) {
  return {
    beforeRestore: async (): Promise<() => void> => {
      const release = gate.block();
      cancelTimers();
      await gate.drain();
      if (hasUnsaved && !hasUnsaved()) return release;
      const result = await flush();
      if (result !== 'saved') {
        release();
        throw new Error(
          result === 'refused' || result === 'paused'
            ? 'This draft changed while you were editing, so nothing was restored. Resolve that first, then restore.'
            : 'Your latest edits could not be saved first, so nothing was restored. Try again.',
        );
      }
      return release;
    },
    onRestored: async (outcome: Extract<ParsedRestoreOutcome, { kind: 'restored' }>) => {
      remember(outcome.record);
      await reload();
    },
  };
}
