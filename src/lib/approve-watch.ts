/**
 * "Did that save APPROVE the topic?" — the one question three surfaces need and
 * none of them can answer (bd startsim-z384k).
 *
 * THE PROBLEM. Approving a topic now navigates to its story. Three surfaces can
 * approve — the table's inline cluster, the review drawer's decision bar (and
 * its bare-letter `a`), and the board card's cluster — and all three are the
 * SHARED @startsimpli/ui components, whose only callback is
 * `onSaved?: () => void`. It fires after every save and says nothing about which
 * decision made it. So "navigate on approve" cannot be read off the button.
 *
 * THE ANSWER IS THE RECORD, NOT THE BUTTON. `CollectionClient.updateEntity`
 * returns what the server saved, so this wraps the client, keeps the status the
 * last save landed on, and lets the host compare it against the status that row
 * held before. That works identically for every surface, including the keyboard
 * shortcut and any surface added later, and it keys off persisted state rather
 * than a label — so it cannot drift from what was actually written.
 *
 * IT GATES ON THE TRANSITION, NOT THE VALUE, and that distinction is the whole
 * reason this is a module and not an inline `=== 'ready'`. ReviewDrawer's "Add
 * note" and its manual state Select go through the SAME patch -> onSaved path as
 * a decision. A reviewer jotting a note on a topic that is already `ready` would
 * be yanked off the table by a value test. Only a save that MOVES the record
 * into the approve status counts.
 *
 * WIDENING `onSaved` TO CARRY THE DECISION was the alternative. It is the
 * tidier API and it is the wrong trade here: it is a @startsimpli/ui change, so
 * it costs a meta-repo PR, a merge, a publish, a verification that the publish
 * actually published, and a version bump in this fork before one line of this
 * bead's behaviour could ship. Filed as the follow-up instead — see the bead.
 */

import type { CollectionClient, EntityRecord } from '@startsimpli/ui/collection';

import { readData } from './board';

/** String read of an attribute off a (camel-or-snake keyed) data blob. */
function fieldStr(data: Record<string, unknown> | undefined, name: string): string {
  const v = readData(data, name);
  return v == null ? '' : String(v);
}

/** What the last save through the watch did, or null when nothing has saved. */
export interface LastSave {
  /** The saved record's id, stringified (ids arrive as UUID strings and as numbers). */
  id: string;
  /**
   * The status this watch last saw for that id, when it has seen one. Undefined
   * on the first save of a record — the caller then falls back to the row it is
   * holding, which is the pre-save copy on a first save and stale on a second.
   */
  before?: string;
  /** The status the server confirmed. */
  after: string;
}

export interface ApproveWatch {
  /** The wrapped client to hand to the shared review components. */
  client: CollectionClient;
  /**
   * True when the most recent save through this watch moved `row` INTO
   * `approveStatus`. Consumes the reading: a second call returns false, so one
   * save can navigate at most once even when two `onSaved` handlers fire.
   */
  tookApproval(row: { id: number | string; data?: Record<string, unknown> }, approveStatus: string | null): boolean;
}

/**
 * True when a save moved a record into the approve status. Pure, so the four
 * shapes that matter (approve / needs work / reject / a note on an already
 * approved record) are decided in the node test lane, not in a browser.
 */
export function approvedInto(
  before: string,
  after: string,
  approveStatus: string | null | undefined,
): boolean {
  if (!approveStatus) return false;
  if (after !== approveStatus) return false;
  return before !== approveStatus;
}

/**
 * Wrap a CollectionClient so the host can ask what the last save did.
 *
 * `onSaved` is the hook the host uses to keep its own caches honest —
 * `updateEntity` hands back the server's answer and the fork's single-entity
 * cache wants it (see lib/entity-cache.ts: invalidation alone leaves the stale
 * blob in place for the very first render the draft page seeds its state from).
 */
export function createApproveWatch(
  base: CollectionClient,
  statusName: string,
  onSaved?: (record: EntityRecord) => void,
): ApproveWatch {
  // The status each record was last SAVED at, by this watch. It exists for the
  // drawer: `record` there is the object the list handed over and it is not
  // re-read between two decisions on the same topic, so "needs work" then
  // "approve" would otherwise compare the second save against the original blob.
  const seen = new Map<string, string>();
  let last: LastSave | null = null;

  const client: CollectionClient = {
    ...base,
    async updateEntity(id, input) {
      const key = String(id);
      const before = seen.get(key);
      const saved = await base.updateEntity(id, input);
      const after = fieldStr(saved?.data, statusName);
      last = { id: key, before, after };
      seen.set(key, after);
      onSaved?.(saved);
      return saved;
    },
  };

  return {
    client,
    tookApproval(row, approveStatus) {
      const reading = last;
      last = null;
      if (!reading || reading.id !== String(row.id)) return false;
      const before = reading.before ?? fieldStr(row.data, statusName);
      return approvedInto(before, reading.after, approveStatus);
    },
  };
}
