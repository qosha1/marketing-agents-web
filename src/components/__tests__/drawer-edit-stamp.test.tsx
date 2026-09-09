/**
 * AN EDIT MADE FROM THE RECORD DRAWER REACHES THE EDIT LOG (bd startsim-m7fdm.3).
 *
 * `data._edit_history` was stamped in ONE place — the draft review page's
 * `mergedData()`. A reviewer can change a headline or a status from the
 * /t/<type> table's "Edit fields" without ever opening /draft/<id>, and that edit
 * left no trace: the panel that exists to answer "who touched this draft" simply
 * did not know it had happened. It did not corrupt the log (the save spreads
 * `record.data`, so an existing log survived) — it just never extended it.
 *
 * A unit test over `withEditStamp` cannot see this. The defect was that the
 * drawer's save never CALLED anything of the kind, so the assertion has to be on
 * the body that actually leaves the component.
 */
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EntityRecord, EntityTypeDef } from '@/lib/foundry-api';
import { EDIT_HISTORY_PATCH_KEY, type EditEntry } from '@/lib/edit-history';

const saveEntity = vi.fn(async () => ({}) as EntityRecord);

vi.mock('@/lib/entity-cache', () => ({
  saveEntity: (...args: unknown[]) => saveEntity(...(args as [])),
  primeEntity: vi.fn(),
  entityKey: (id: unknown) => ['entity', String(id)],
}));
vi.mock('@startsimpli/auth', () => ({
  useAuth: () => ({ user: { email: 'jurga@ogmc.example' } }),
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

/** A draft that has been edited once already, by someone else, days ago. */
const EXISTING: EditEntry = {
  by: 'malin@ogmc.example',
  from: '2026-09-01T09:00:00.000Z',
  at: '2026-09-01T09:04:00.000Z',
  saves: 3,
};

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
  it('stamps who edited and when', async () => {
    const data = await saveWithEdit(record({ blog: 'body', seo: 'old title' }));

    const log = data[EDIT_HISTORY_PATCH_KEY] as EditEntry[];
    expect(log).toHaveLength(1);
    expect(log[0]!.by).toBe('jurga@ogmc.example');
    expect(log[0]!.saves).toBe(1);
    expect(Date.parse(log[0]!.at)).not.toBeNaN();
    // and the edit itself still lands
    expect(data.seo).toBe('a new title');
  });

  it('extends an existing log rather than replacing it', async () => {
    // The blob arrives camelised, which is the spelling the stamp writes back.
    const data = await saveWithEdit(
      record({ blog: 'body', seo: 'old title', [EDIT_HISTORY_PATCH_KEY]: [EXISTING] }),
    );

    const log = data[EDIT_HISTORY_PATCH_KEY] as EditEntry[];
    expect(log).toHaveLength(2);
    expect(log[0]).toEqual(EXISTING);
    expect(log[1]!.by).toBe('jurga@ogmc.example');
  });

  it('leaves undeclared blob keys untouched — this is an addition, not a rewrite', async () => {
    const data = await saveWithEdit(
      record({ blog: 'body', seo: 'old title', _origin: 'n8n', review: { verdict: 'approve' } }),
    );

    expect(data).toMatchObject({ _origin: 'n8n', review: { verdict: 'approve' } });
  });
});
