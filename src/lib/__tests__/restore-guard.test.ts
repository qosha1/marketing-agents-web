/**
 * RED for bd startsim-vehzd — after a restore, nothing the editor had queued may
 * land on top of it.
 *
 * The draft page autosaves on a 1,200 ms debounce (BlogSection/DocumentEditor)
 * and the scorecard on 800 ms, and every PATCH carries the WHOLE blob from the
 * editor's local copy. So without a guard, a reviewer who types, then restores
 * the blog to v2 inside the debounce window, gets the restore — and then, a
 * second later, the autosave PATCHes the OLD blog right back over it.
 *
 * `restoreHooks` is the page's whole answer, kept out of the 1,500-line page so
 * this can be tested with fake timers:
 *   before → block every write, cancel the page's own timers, wait out an
 *            in-flight save, then FLUSH what was typed (so nothing typed is
 *            lost; a byte-identical re-send records nothing server-side);
 *   after  → remember the restored version and remount the editor from the
 *            server's copy (which clears every editor timer on unmount).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createWriteGate, restoreHooks } from '../restore-guard';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** A stand-in for the page: a local blob, a debounced autosave, a PATCH log. */
function page() {
  const gate = createWriteGate();
  const patches: string[] = [];
  let text = 'v3 text';
  let timer: ReturnType<typeof setTimeout> | null = null;
  const patch = async (body: string) => {
    patches.push(body);
    return true;
  };
  const persist = () => gate.run(() => patch(text), false);
  const type = (next: string) => {
    text = next;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void persist(), 1200);
  };
  // The flush is the page calling the conditional save DIRECTLY — not through
  // the gate it has just closed.
  const flushNow = () => patch(text);
  return { gate, patches, persist, flushNow, type };
}

describe('restoreHooks — no queued autosave lands after a restore', () => {
  it('a debounce that fires after the restore started sends NOTHING', async () => {
    const p = page();
    p.type('typed just before restoring');
    const reload = vi.fn(async () => {});
    const hooks = restoreHooks({
      gate: p.gate,
      cancelTimers: () => {},
      flush: async () => {
        await p.flushNow();
        return 'saved';
      },
      reload,
      remember: () => {},
    });

    const release = await hooks.beforeRestore();
    // The flush landed what was typed — nothing typed is lost.
    expect(p.patches).toEqual(['typed just before restoring']);
    // Now the restore writes v2 server-side; the page's old copy still says the
    // typed text, and the debounce is still armed.
    await vi.advanceTimersByTimeAsync(2000);
    expect(p.patches).toEqual(['typed just before restoring']);
    await hooks.onRestored({ kind: 'restored', record: { id: 'd1', version: 5 }, version: 5, summary: { fields: ['blog'], revision: 5 } });
    expect(reload).toHaveBeenCalledTimes(1);
    if (typeof release === 'function') release();
  });

  it('the flush goes through even though the gate is closed to the autosave', async () => {
    const p = page();
    const flush = vi.fn(async () => 'saved' as const);
    const hooks = restoreHooks({ gate: p.gate, cancelTimers: () => {}, flush, reload: async () => {}, remember: () => {} });
    await hooks.beforeRestore();
    expect(flush).toHaveBeenCalledTimes(1);
    expect(p.gate.blocked).toBe(true);
  });

  it('waits out a save already in flight before flushing', async () => {
    const p = page();
    const order: string[] = [];
    let resolveSlow!: () => void;
    void p.gate.run(
      () =>
        new Promise<boolean>((r) => {
          resolveSlow = () => {
            order.push('slow save landed');
            r(true);
          };
        }),
      false,
    );
    const hooks = restoreHooks({
      gate: p.gate,
      cancelTimers: () => {},
      flush: async () => {
        order.push('flush');
        return 'saved';
      },
      reload: async () => {},
      remember: () => {},
    });
    const pending = hooks.beforeRestore();
    await vi.advanceTimersByTimeAsync(10);
    expect(order).toEqual([]);
    resolveSlow();
    await pending;
    expect(order).toEqual(['slow save landed', 'flush']);
  });

  it('does NOT flush when nothing unsaved was typed — the whole-blob PATCH would touch fields nobody edited', async () => {
    const p = page();
    const flush = vi.fn(async () => 'saved' as const);
    const hooks = restoreHooks({
      gate: p.gate,
      cancelTimers: () => {},
      flush,
      hasUnsaved: () => false,
      reload: async () => {},
      remember: () => {},
    });
    await hooks.beforeRestore();
    expect(flush).not.toHaveBeenCalled();
    expect(p.gate.blocked).toBe(true);
  });

  it('cancels the page’s own timers', async () => {
    const p = page();
    const cancelTimers = vi.fn();
    const hooks = restoreHooks({ gate: p.gate, cancelTimers, flush: async () => 'saved', reload: async () => {}, remember: () => {} });
    await hooks.beforeRestore();
    expect(cancelTimers).toHaveBeenCalled();
  });

  it('a REFUSED flush aborts the restore and reopens writes', async () => {
    const p = page();
    const hooks = restoreHooks({ gate: p.gate, cancelTimers: () => {}, flush: async () => 'refused', reload: async () => {}, remember: () => {} });
    await expect(hooks.beforeRestore()).rejects.toThrow(/nothing was restored/i);
    expect(p.gate.blocked).toBe(false);
  });

  it('the release reopens writes (a restore that was refused leaves the editor usable)', async () => {
    const p = page();
    const hooks = restoreHooks({ gate: p.gate, cancelTimers: () => {}, flush: async () => 'saved', reload: async () => {}, remember: () => {} });
    const release = await hooks.beforeRestore();
    expect(p.gate.blocked).toBe(true);
    if (typeof release === 'function') release();
    expect(p.gate.blocked).toBe(false);
    p.type('after');
    await vi.advanceTimersByTimeAsync(1300);
    expect(p.patches).toContain('after');
  });

  it('remembers the restored version BEFORE reloading', async () => {
    const order: string[] = [];
    const hooks = restoreHooks({
      gate: createWriteGate(),
      cancelTimers: () => {},
      flush: async () => 'saved',
      reload: async () => {
        order.push('reload');
      },
      remember: (record) => {
        order.push(`remember v${(record as { version: number }).version}`);
      },
    });
    await hooks.onRestored({ kind: 'restored', record: { id: 'd1', version: 7 }, version: 7, summary: { fields: [], revision: 7 } });
    expect(order).toEqual(['remember v7', 'reload']);
  });
});

describe('beforeAccept — an accepted suggestion is held like a restore (bd startsim-q8sgy)', () => {
  function hooksFor(p: ReturnType<typeof page>, typed: () => boolean, flushResult: 'saved' | 'refused' = 'saved') {
    return restoreHooks({
      gate: p.gate,
      cancelTimers: () => {},
      hasUnsaved: typed,
      flush: async () => {
        await p.flushNow();
        return flushResult;
      },
      reload: async () => {},
      remember: () => {},
    });
  }

  it('flushes nothing when nothing was typed (#96), and holds the autosave until released', async () => {
    const p = page();
    const hooks = hooksFor(p, () => false);
    const release = await hooks.beforeAccept();
    expect(p.patches).toEqual([]);
    expect(await p.persist()).toBe(false); // held
    release();
    expect(await p.persist()).toBe(true);
  });

  it('flushes real typing first, so the accept asserts the version that typing produced', async () => {
    const p = page();
    p.type('typed before accepting');
    const hooks = hooksFor(p, () => true);
    const release = await hooks.beforeAccept();
    expect(p.patches).toEqual(['typed before accepting']);
    release();
  });

  it('accepts nothing when the flush was refused, and says so in accept words', async () => {
    const p = page();
    const hooks = hooksFor(p, () => true, 'refused');
    await expect(hooks.beforeAccept()).rejects.toThrow(/nothing was accepted/);
    expect(p.gate.blocked).toBe(false);
  });
});
