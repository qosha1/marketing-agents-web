import { describe, expect, it, vi } from 'vitest';

import { startContent, waitForDraft } from '../start-content';
import { record, TOPIC_TYPE } from './fixtures';

function deps(over: Record<string, unknown> = {}) {
  return {
    fetchDrafts: vi.fn().mockResolvedValue([]),
    saveTopic: vi.fn().mockResolvedValue(undefined),
    dispatch: vi.fn().mockResolvedValue(undefined),
    running: vi.fn().mockReturnValue(true),
    ...over,
  };
}

describe('Start content', () => {
  const ready = record('t1', 'topic', { title: 'A', status: 'ready' });
  const suggested = record('t2', 'topic', { title: 'B', status: 'suggested' });

  it('starts the existing writer for a ready topic and then waits for its draft', async () => {
    const d = deps();
    const r = await startContent(ready, TOPIC_TYPE, d);
    expect(d.saveTopic).not.toHaveBeenCalled();
    expect(d.dispatch).toHaveBeenCalledWith(ready);
    expect(r).toEqual({ state: 'writing' });
  });

  it('approves a topic that is not ready first, then dispatches', async () => {
    const d = deps();
    await startContent(suggested, TOPIC_TYPE, d);
    expect(d.saveTopic).toHaveBeenCalledTimes(1);
    const [id, data] = d.saveTopic.mock.calls[0];
    expect(id).toBe('t2');
    expect(data).toMatchObject({ title: 'B', status: 'ready' });
    expect(d.saveTopic.mock.invocationCallOrder[0]).toBeLessThan(d.dispatch.mock.invocationCallOrder[0]);
  });

  it('a second click opens the content item that exists and makes no other', async () => {
    const d = deps({ fetchDrafts: vi.fn().mockResolvedValue([record('d9', 'draft', {})]) });
    const r = await startContent(ready, TOPIC_TYPE, d);
    expect(d.dispatch).not.toHaveBeenCalled();
    expect(d.saveTopic).not.toHaveBeenCalled();
    expect(r).toEqual({ state: 'open', href: '/content/d9' });
  });

  it('several drafts open the newest one', async () => {
    const older = record('d1', 'draft', {}, { createdAt: '2026-10-01T10:00:00Z' });
    const newer = record('d2', 'draft', {}, { createdAt: '2026-10-05T10:00:00Z' });
    const d = deps({ fetchDrafts: vi.fn().mockResolvedValue([older, newer]) });
    expect(await startContent(ready, TOPIC_TYPE, d)).toEqual({ state: 'open', href: '/content/d2' });
    expect(d.dispatch).not.toHaveBeenCalled();
  });

  it('a relay that refused (run ended) is reported, not waited for', async () => {
    const d = deps({ running: vi.fn().mockReturnValue(false) });
    expect(await startContent(ready, TOPIC_TYPE, d)).toEqual({ state: 'refused' });
  });

  it('a non-UUID id still opens its content item, escaped', async () => {
    const d = deps({ fetchDrafts: vi.fn().mockResolvedValue([record('draft seed/9', 'draft', {})]) });
    expect(await startContent(ready, TOPIC_TYPE, d)).toEqual({ state: 'open', href: '/content/draft%20seed%2F9' });
  });
});

describe('waitForDraft', () => {
  const topic = record('t1', 'topic', { title: 'A', status: 'ready' });

  it('polls until the writer’s draft lands', async () => {
    const fetchDrafts = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValueOnce([record('d1', 'draft', {})]);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const got = await waitForDraft(topic, fetchDrafts, { sleep, intervalMs: 1 });
    expect(got?.id).toBe('d1');
    expect(fetchDrafts).toHaveBeenCalledTimes(3);
  });

  it('gives up with null when the window passes with nothing', async () => {
    let t = 0;
    const got = await waitForDraft(topic, vi.fn().mockResolvedValue([]), {
      sleep: async () => {
        t += 10;
      },
      now: () => t,
      windowMs: 25,
      intervalMs: 10,
    });
    expect(got).toBeNull();
  });
});
