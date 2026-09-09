/**
 * A DECLARED ATTRIBUTE MUST COME BACK SPELLED THE WAY IT WENT OUT (bd
 * startsim-8hgmq.18).
 *
 * The shared API client transforms keys in both directions, recursively, and the
 * `data` blob is not exempt:
 *
 *   snake -> camel: /_([a-z0-9])/ -> uppercase   so  source_1 -> source1
 *   camel -> snake: /[A-Z]/       -> _lowercase  so  source1  -> source1
 *
 * Uppercasing a DIGIT is a no-op, so the underscore is destroyed on the way in
 * and there is no hump to split on on the way out. Every surface in this app
 * PATCHes the WHOLE blob back (the backend REPLACES `data`), so every one of
 * them renames the declared topic attribute `source_1` to the undeclared
 * `source1`. Nothing looks broken — `readData` finds either spelling — but
 * `attr.source_1=` filtering, `redenormalize_attributes`, and every reader
 * outside this app see an attribute that is gone.
 *
 * WHY THE ASSERTIONS RUN ON THE WIRE. The body handed to the client is camelCase
 * by construction; a test that stops there passes while the wire is still wrong,
 * and it cannot see the other failure mode — two keys in one body that
 * camelToSnake collapses onto the same wire key, where only insertion order picks
 * the survivor. So each case runs
 *
 *   stored (wire) -> snakeToCamel -> surface -> updateEntity -> camelToSnake
 *
 * with the REAL transforms imported from @startsimpli/api.
 *
 * WHY THE NET LIVES IN `updateEntity` AND NOT IN EACH SURFACE. The corrupting
 * surface TODAY is @startsimpli/ui's ReviewDrawer, which this app consumes as a
 * PUBLISHED package — a fix there is not consumable here until it is published
 * and the dependency bumped. `updateEntity` is the one seam every write in this
 * app passes through, including the ones inside @startsimpli/ui, so netting it
 * here stops the corruption on this app's next deploy at whatever version of the
 * shared package is installed. The type-aware fix ships in the package as well;
 * this is not a duplicate of it but the layer below it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { snakeToCamel, camelToSnake } from '@startsimpli/api';

const sent = vi.hoisted(() => ({ patch: [] as { path: string; body: unknown }[], gets: 0 }));

/** The tenant's real declared schema, fetched 2026-09-09 from the live tenant. */
const TYPES = vi.hoisted(() => [
  {
    id: 'b0615cb3-4242-4148-8a83-e426e8128307',
    key: 'topic',
    label: 'Topic',
    attributes: [
      'title',
      'angle',
      'market',
      'content_type',
      'status',
      'ai_rank',
      'team_verdict',
      'team_notes',
      'source_1',
      'source_2',
      'source_3',
      'delivered_at',
      'scheduled_for',
      'subtitle',
      'assignee_sub',
      'assignee_name',
      'scope_path',
    ].map((name, i) => ({ id: String(i), name, dataType: 'text', required: false, config: {} })),
  },
  {
    id: 'dt',
    key: 'draft',
    label: 'Draft',
    attributes: ['blog', 'linkedin', 'seo', 'sources', 'status', 'topic_ref'].map((name, i) => ({
      id: `d${i}`,
      name,
      dataType: 'text',
      required: false,
      config: {},
    })),
  },
]);

vi.mock('../api', () => ({
  api: {
    client: {
      get: async (path: string) => {
        if (path.startsWith('api/v1/schema/types')) {
          sent.gets += 1;
          return { count: TYPES.length, next: null, previous: null, results: TYPES };
        }
        throw new Error(`unexpected GET ${path}`);
      },
      patch: async (path: string, body: unknown) => {
        sent.patch.push({ path, body });
        return { id: 'x', entityType: 'topic', name: 'n', data: {} };
      },
      post: async (path: string, body: unknown) => {
        sent.patch.push({ path, body });
        return { id: 'x', entityType: 'topic', name: 'n', data: {} };
      },
    },
  },
}));

import { createEntity, resetDeclaredAliasIndex, updateEntity } from '../foundry-api';

/** The blob as the tenant stores it — the n8n writer's spelling. */
const STORED: Record<string, unknown> = {
  title: 'Gulf Conflict Risk Checklist',
  status: 'suggested',
  team_verdict: '',
  source_1: 'https://example.com/a',
  source_2: 'https://example.com/b',
  source_3: 'https://example.com/c',
  _origin: 'n8n',
  source_meta: { verified: true },
  _edit_history: [{ by: 'a@b.c', from: 't', at: 't', saves: 1 }],
};

const asRead = (o: Record<string, unknown>) => snakeToCamel(o) as Record<string, unknown>;
const lastWire = () =>
  camelToSnake((sent.patch.at(-1)!.body as { data: unknown }).data) as Record<string, unknown>;

beforeEach(() => {
  sent.patch.length = 0;
  sent.gets = 0;
  resetDeclaredAliasIndex();
});

describe('updateEntity keeps declared attribute names on the wire', () => {
  it('restores source_1/2/3 from the camel spelling the client handed the surface', async () => {
    // What EVERY whole-blob surface does: spread the camelised blob, change one
    // field, send the lot. (ReviewDrawer.patch, laneMoveData, mergedData.)
    const outgoing = { ...asRead(STORED), status: 'ready', teamVerdict: 'approve' };

    await updateEntity('topic-1', { data: outgoing });

    const wire = lastWire();
    expect(wire).toMatchObject({
      source_1: 'https://example.com/a',
      source_2: 'https://example.com/b',
      source_3: 'https://example.com/c',
      status: 'ready',
      team_verdict: 'approve',
    });
    expect(wire).not.toHaveProperty('source1');
    expect(wire).not.toHaveProperty('source2');
    expect(wire).not.toHaveProperty('source3');
  });

  it('repairs a row that was already renamed, rather than re-minting the bad key', async () => {
    const corrupted = asRead({ title: 't', status: 'written', source1: 'https://example.com/a' });

    await updateEntity('topic-2', { data: corrupted });

    expect(lastWire()).toEqual({
      title: 't',
      status: 'written',
      source_1: 'https://example.com/a',
    });
  });

  it('leaves every key that already round-trips exactly alone', async () => {
    await updateEntity('topic-3', { data: asRead(STORED) });

    const wire = lastWire();
    expect(wire).toMatchObject({
      title: 'Gulf Conflict Risk Checklist',
      _origin: 'n8n',
      source_meta: { verified: true },
      _edit_history: [{ by: 'a@b.c', from: 't', at: 't', saves: 1 }],
    });
  });

  it('never leaves both spellings in one body — they collide on the wire', async () => {
    await updateEntity('topic-4', { data: { source1: 'camel', source_1: 'snake' } });

    const body = (sent.patch.at(-1)!.body as { data: Record<string, unknown> }).data;
    expect(Object.keys(body).filter((k) => k.toLowerCase().startsWith('source'))).toEqual([
      'source_1',
    ]);
    expect(lastWire()).toEqual({ source_1: 'snake' });
  });

  it('applies to a create as well as a patch', async () => {
    await createEntity({ entityType: 'topic', name: 'n', data: { source1: 'x' } });

    expect(lastWire()).toEqual({ source_1: 'x' });
  });

  it('fetches the schema once and reuses it', async () => {
    await updateEntity('a', { data: { source1: '1' } });
    await updateEntity('b', { data: { source1: '2' } });
    expect(sent.gets).toBe(1);
  });

  it('passes a name-only patch straight through', async () => {
    await updateEntity('topic-5', { name: 'renamed' });
    expect(sent.patch.at(-1)!.body).toEqual({ name: 'renamed' });
  });
});

describe('the guard rails on the alias index', () => {
  it('is derived from declared names, so it only ever renames a declared attribute', async () => {
    // `widget1` is nobody's declared attribute — leave it exactly as it is,
    // even though it has the same shape as the alias being repaired next to it.
    await updateEntity('topic-6', { data: { widget1: 'x', source1: 'y' } });
    expect(lastWire()).toEqual({ widget1: 'x', source_1: 'y' });
  });

  it('does not stall a write when the schema cannot be fetched', async () => {
    resetDeclaredAliasIndex();
    const api = (await import('../api')).api as unknown as {
      client: { get: (p: string) => Promise<unknown> };
    };
    const real = api.client.get;
    api.client.get = async () => {
      throw new Error('offline');
    };
    try {
      await updateEntity('topic-7', { data: { source1: 'x' } });
      // Unchanged rather than blocked — no worse than the behaviour it replaces.
      expect(lastWire()).toEqual({ source1: 'x' });
    } finally {
      api.client.get = real;
      resetDeclaredAliasIndex();
    }
  });
});
