/**
 * WHAT THE RECORD DRAWER'S "EDIT FIELDS" ACTUALLY SENDS.
 *
 * This file was `drawer-edit-stamp.test.tsx` and pinned the opposite behaviour
 * (bd startsim-m7fdm.3): the drawer stamped `data._edit_history` so an edit made
 * from the /t/<type> table reached the log the draft page rendered. bd
 * startsim-j19hf removed that log, so what has to be pinned now is its ABSENCE —
 * and for a reason worth stating, because "we deleted a feature" is not one:
 *
 *  - the log rode inside the `data` blob, which the tenant PATCH REPLACES
 *    wholesale, so two reviewers colliding lost log entries in exactly the
 *    collision the log existed to record; and
 *  - `_edit_history` itself appears in `human_edited` on the live rows that
 *    carry it, so `guard_machine_write` held a stale LOG against a machine
 *    write. A log that is also guarded content is a category error.
 *
 * The trail is server-side now (bd startsim-o1qib), one row per write.
 *
 * The third assertion here predates all of that and still earns its place: the
 * drawer's save is an ADDITION to the blob, never a rewrite of it, and the way
 * that breaks is a body that drops keys nothing on screen knew about.
 */
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EntityRecord, EntityTypeDef } from '@/lib/foundry-api';

const saveEntity = vi.fn(async () => ({}) as EntityRecord);

vi.mock('@/lib/entity-cache', () => ({
  saveEntity: (...args: unknown[]) => saveEntity(...(args as [])),
  primeEntity: vi.fn(),
  entityKey: (id: unknown) => ['entity', String(id)],
}));
vi.mock('@/infrastructure/auth', () => ({ getRegisteredToken: () => null }));

import { RecordEditFields } from '../entity-detail-drawer';

const DRAFT_TYPE = {
  id: 'dt',
  key: 'draft',
  label: 'Draft',
  attributes: [
    { id: '1', name: 'blog', label: 'Blog', dataType: 'longtext', required: false, config: {} },
    { id: '2', name: 'seo', label: 'SEO', dataType: 'text', required: false, config: {} },
  ],
} as unknown as EntityTypeDef;

/** A log a previous build of this app already wrote into a live row. bd
 *  startsim-j19hf measured two of these on the live tenant and chose to LEAVE
 *  them: clearing them is a whole-blob PATCH over customer records for no gain. */
const STORED_LOG = [
  { by: 'malin@ogmc.example', from: '2026-09-01T09:00:00.000Z', at: '2026-09-01T09:04:00.000Z', saves: 3 },
];

function record(data: Record<string, unknown>): EntityRecord {
  return { id: 'draft-1', entityType: 'draft', name: 'A draft', data } as unknown as EntityRecord;
}

function renderForm(rec: EntityRecord) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RecordEditFields type={DRAFT_TYPE} record={rec} onSaved={vi.fn()} onCancel={vi.fn()} />
    </QueryClientProvider>,
  );
}

async function saveWithEdit(rec: EntityRecord) {
  renderForm(rec);
  const seo = screen.getByDisplayValue('old title');
  fireEvent.change(seo, { target: { value: 'a new title' } });
  fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
  await waitFor(() => expect(saveEntity).toHaveBeenCalled());
  const [, , input] = saveEntity.mock.calls[0] as unknown as [
    unknown,
    unknown,
    { data: Record<string, unknown> },
  ];
  return input.data;
}

beforeEach(() => {
  saveEntity.mockClear();
});

describe('RecordEditFields save', () => {
  it('writes no edit log of its own — neither spelling', async () => {
    const data = await saveWithEdit(record({ blog: 'body', seo: 'old title' }));

    expect(Object.keys(data).filter((k) => /edit_?history/i.test(k))).toEqual([]);
    // and the edit itself still lands
    expect(data.seo).toBe('a new title');
  });

  it('leaves a log a previous build already stored exactly as it found it', async () => {
    const data = await saveWithEdit(
      record({ blog: 'body', seo: 'old title', EditHistory: STORED_LOG }),
    );

    // Not extended, not dropped, not re-spelled. It is somebody else's old data
    // now, and this write has no opinion about it.
    expect(data.EditHistory).toEqual(STORED_LOG);
  });

  it('leaves undeclared blob keys untouched — this is an addition, not a rewrite', async () => {
    const data = await saveWithEdit(
      record({ blog: 'body', seo: 'old title', _origin: 'n8n', review: { verdict: 'approve' } }),
    );

    expect(data).toMatchObject({ _origin: 'n8n', review: { verdict: 'approve' } });
  });
});
