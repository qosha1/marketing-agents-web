/**
 * "Did that save APPROVE the topic?" (bd startsim-z384k).
 *
 * THE CASE THAT MAKES THIS A MODULE rather than an inline `status === 'ready'`:
 * ReviewDrawer's Add-note box and its manual state Select go through the SAME
 * patch -> onSaved path as a decision does. A value test would yank a reviewer
 * who typed a note on an already-approved topic off the table and onto a draft
 * page they did not ask for. So the rule is the TRANSITION, and the note case
 * below is the one that would have shipped that bug.
 *
 * THE OTHER REAL CASE is the drawer deciding twice on one record without the
 * list refetching in between — "needs work", then "approve". The row object the
 * drawer holds is the one the list handed over and it is stale by the second
 * decision, so the watch remembers what it last SAVED and compares against that.
 */
import { describe, expect, it, vi } from 'vitest';

import type { CollectionClient, EntityRecord } from '@startsimpli/ui/collection';

import { approvedInto, createApproveWatch } from '../approve-watch';

const APPROVE = 'ready';

function record(id: string, data: Record<string, unknown>): EntityRecord {
  return { id: id as unknown as number, entityType: 'topic', externalId: null, name: id, data, createdAt: '' };
}

/** A client that echoes the blob back as the server would. */
function fakeClient(): CollectionClient {
  return {
    listTypes: vi.fn(),
    listAllEntities: vi.fn(),
    updateEntity: vi.fn(async (id, input) => record(String(id), input.data ?? {})),
  } as unknown as CollectionClient;
}

describe('approvedInto', () => {
  it('is true only for a move INTO the approve status', () => {
    expect(approvedInto('suggested', 'ready', APPROVE)).toBe(true);
  });

  it('is false when the record was already there — a note is not an approval', () => {
    expect(approvedInto('ready', 'ready', APPROVE)).toBe(false);
  });

  it('is false for every other destination', () => {
    expect(approvedInto('suggested', 'rejected', APPROVE)).toBe(false);
    expect(approvedInto('ready', 'written', APPROVE)).toBe(false);
    expect(approvedInto('ready', 'suggested', APPROVE)).toBe(false);
  });

  it('is false when the type declares no approve target at all', () => {
    expect(approvedInto('a', 'b', null)).toBe(false);
    expect(approvedInto('a', 'b', '')).toBe(false);
  });
});

describe('createApproveWatch', () => {
  it('reports an approve, and reports it exactly once', async () => {
    const watch = createApproveWatch(fakeClient(), 'status');
    const row = record('t1', { status: 'suggested' });

    await watch.client.updateEntity('t1', { data: { status: 'ready', teamVerdict: 'good' } });

    expect(watch.tookApproval(row, APPROVE)).toBe(true);
    // Consumed: two onSaved handlers on one save must not navigate twice.
    expect(watch.tookApproval(row, APPROVE)).toBe(false);
  });

  it('does not report a reject or a needs-work', async () => {
    const watch = createApproveWatch(fakeClient(), 'status');
    const row = record('t1', { status: 'suggested' });

    await watch.client.updateEntity('t1', { data: { status: 'rejected', teamVerdict: 'bad' } });
    expect(watch.tookApproval(row, APPROVE)).toBe(false);

    await watch.client.updateEntity('t1', { data: { status: 'suggested', teamVerdict: 'edit' } });
    expect(watch.tookApproval(row, APPROVE)).toBe(false);
  });

  it('does not report a NOTE saved on a topic that is already approved', async () => {
    const watch = createApproveWatch(fakeClient(), 'status');
    const row = record('t1', { status: 'ready' });

    await watch.client.updateEntity('t1', { data: { status: 'ready', teamNotes: 'tighten the angle' } });

    expect(watch.tookApproval(row, APPROVE)).toBe(false);
  });

  it('reads the second decision against the FIRST save, not against a stale row', async () => {
    // The drawer keeps the record the list handed it. After "needs work" that
    // object still says `suggested`; the approve that follows is still an
    // approve, and a watch that trusted the row would agree by accident. Prove
    // it the other way round: a needs-work BACK to the approve status is not a
    // second approval.
    const watch = createApproveWatch(fakeClient(), 'status');
    const row = record('t1', { status: 'suggested' });

    await watch.client.updateEntity('t1', { data: { status: 'ready' } });
    expect(watch.tookApproval(row, APPROVE)).toBe(true);

    // Re-pressing Approve on the same open drawer changes nothing.
    await watch.client.updateEntity('t1', { data: { status: 'ready' } });
    expect(watch.tookApproval(row, APPROVE)).toBe(false);
  });

  it('ignores a save made to a DIFFERENT record', async () => {
    const watch = createApproveWatch(fakeClient(), 'status');
    await watch.client.updateEntity('t2', { data: { status: 'ready' } });

    expect(watch.tookApproval(record('t1', { status: 'suggested' }), APPROVE)).toBe(false);
  });

  it('reports nothing before anything has been saved', () => {
    const watch = createApproveWatch(fakeClient(), 'status');
    expect(watch.tookApproval(record('t1', { status: 'suggested' }), APPROVE)).toBe(false);
  });

  it('reads the status under the camelised key the blob actually carries', async () => {
    const watch = createApproveWatch(fakeClient(), 'team_verdict');
    const row = record('t1', { teamVerdict: 'edit' });

    await watch.client.updateEntity('t1', { data: { teamVerdict: 'good' } });

    expect(watch.tookApproval(row, 'good')).toBe(true);
  });

  it('hands the saved record to the host so its cache can be primed', async () => {
    const seen: EntityRecord[] = [];
    const watch = createApproveWatch(fakeClient(), 'status', (r) => seen.push(r));

    await watch.client.updateEntity('t1', { data: { status: 'ready' } });

    expect(seen).toHaveLength(1);
    expect(String(seen[0].id)).toBe('t1');
  });
});
