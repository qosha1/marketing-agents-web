import { describe, expect, it, vi } from 'vitest';

import { startContent } from '../start-content';
import { record, TOPIC_TYPE } from './fixtures';

function deps(over: Record<string, unknown> = {}) {
  return {
    fetchDrafts: vi.fn().mockResolvedValue([]),
    saveTopic: vi.fn().mockResolvedValue(undefined),
    dispatch: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

describe('Start content', () => {
  const ready = record('t1', 'topic', { title: 'A', status: 'ready' });
  const suggested = record('t2', 'topic', { title: 'B', status: 'suggested' });

  it('starts the existing writer for a ready topic and opens the story page', async () => {
    const d = deps();
    const r = await startContent(ready, TOPIC_TYPE, d);
    expect(d.saveTopic).not.toHaveBeenCalled();
    expect(d.dispatch).toHaveBeenCalledWith(ready);
    expect(r).toEqual({ href: '/story/t1', started: true });
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

  it('a second click opens the draft that exists and makes no other', async () => {
    const d = deps({ fetchDrafts: vi.fn().mockResolvedValue([record('d9', 'draft', {})]) });
    const r = await startContent(ready, TOPIC_TYPE, d);
    expect(d.dispatch).not.toHaveBeenCalled();
    expect(d.saveTopic).not.toHaveBeenCalled();
    expect(r).toEqual({ href: '/draft/d9', started: false });
  });

  it('several drafts open the story page, which lists them', async () => {
    const d = deps({ fetchDrafts: vi.fn().mockResolvedValue([record('d1', 'draft', {}), record('d2', 'draft', {})]) });
    expect((await startContent(ready, TOPIC_TYPE, d)).href).toBe('/story/t1');
    expect(d.dispatch).not.toHaveBeenCalled();
  });
});
