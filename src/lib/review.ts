/**
 * Draft revision lineage (bd 768w.16.10.4).
 *
 * The AI "Request revision" rewrite was removed (bd startsim-whwxd.6); drafts it
 * created keep their `revised_from` lineage, which this resolves into an ordered
 * chain for the "Revision history" affordance and the parent diff. The stored
 * review scorecard and notes readers went with the decision and Notes panel (bd
 * startsim-m7fdm.25); the data stays on the record.
 * Pure, so it unit-tests without a running tenant.
 */
import { readData } from '@/lib/board';
import type { EntityRecord } from '@/lib/foundry-api';

/** The parent draft id a draft was revised from ('' when this is an original). */
export function revisedFrom(d: EntityRecord): string {
  const v = readData(d.data, 'revised_from');
  return v == null ? '' : String(v);
}

/**
 * The revision lineage a draft belongs to, ordered oldest → newest, so the editor
 * can render "Revision history" (v1, v2, …) and pick the parent to diff against.
 * Walks up via `revised_from` to the root original, then down the `revised_from`
 * children. Assumes a linear chain (each draft revised at most once); cycles and
 * missing links terminate the walk safely. `all` is the full draft set; the focus
 * draft is always included even if `all` omits it.
 */
export function revisionChain(draft: EntityRecord, all: EntityRecord[]): EntityRecord[] {
  const byId = new Map<string, EntityRecord>(all.map((d) => [String(d.id), d]));
  byId.set(String(draft.id), byId.get(String(draft.id)) ?? draft);

  // Walk up to the root original.
  let root = byId.get(String(draft.id)) as EntityRecord;
  const seenUp = new Set<string>([String(root.id)]);
  for (;;) {
    const parentId = revisedFrom(root);
    if (!parentId || !byId.has(parentId) || seenUp.has(parentId)) break;
    seenUp.add(parentId);
    root = byId.get(parentId) as EntityRecord;
  }

  // Walk down the revised_from children from the root.
  const chain: EntityRecord[] = [root];
  const used = new Set<string>([String(root.id)]);
  let cur = root;
  for (;;) {
    const child = all.find((d) => revisedFrom(d) === String(cur.id) && !used.has(String(d.id)));
    if (!child) break;
    chain.push(child);
    used.add(String(child.id));
    cur = child;
  }
  return chain;
}
