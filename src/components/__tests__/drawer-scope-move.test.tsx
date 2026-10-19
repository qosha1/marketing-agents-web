/**
 * A scope's path and parent are not plain fields (bd startsim-kprfu, SCOPE-002).
 *
 * The drawer's Edit form drew them as free text inputs and PATCHed them with
 * everything else, so renaming a scope changed one row and orphaned every
 * topic, draft and child scope under the old path. They are read-only in the
 * form now, and a separate Move action goes through the tenant's move-scope
 * endpoint, which rewrites the whole subtree in one transaction.
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

const post = vi.fn();
vi.mock('@/lib/api', () => ({ api: { client: { post: (...a: unknown[]) => post(...a) } } }));

import { RecordEditFields } from '../entity-detail-drawer';

// The scope type as the tenant serves it — config camelCased by the shared
// client, which is how the browser actually receives it.
const SCOPE_TYPE = {
  id: 'st',
  key: 'scope',
  label: 'Scope',
  config: { access: {}, scope: { pathAttribute: 'path', parentAttribute: 'parent' } },
  attributes: [
    { id: '1', name: 'name', dataType: 'text', required: true, config: {} },
    { id: '2', name: 'path', dataType: 'text', required: true, config: {} },
    { id: '3', name: 'parent', dataType: 'text', required: false, config: {} },
    { id: '4', name: 'brand_voice', dataType: 'longtext', required: false, config: {} },
  ],
} as unknown as EntityTypeDef;

// A scoped RECORD: declares a path attribute but no parent — not a container.
const TOPIC_TYPE = {
  id: 'tt',
  key: 'topic',
  label: 'Topic',
  config: { scope: { pathAttribute: 'scope_path', edge: 'topic_in_scope' } },
  attributes: [
    { id: '1', name: 'title', dataType: 'text', required: false, config: {} },
    { id: '2', name: 'scope_path', dataType: 'text', required: false, config: {} },
  ],
} as unknown as EntityTypeDef;

const SCOPE = {
  id: 'scope-1',
  entityType: 'scope',
  name: 'GCC Weekly',
  data: { name: 'GCC Weekly', path: '/ogmc/gcc', parent: '/ogmc', brandVoice: 'plain' },
} as unknown as EntityRecord;

function renderForm(type: EntityTypeDef, rec: EntityRecord, onSaved = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <RecordEditFields type={type} record={rec} onSaved={onSaved} onCancel={vi.fn()} />
    </QueryClientProvider>,
  );
  return { onSaved };
}

beforeEach(() => {
  saveEntity.mockClear();
  post.mockReset();
});

describe('the scope Edit form', () => {
  it('shows path and parent but offers no input that edits them', () => {
    renderForm(SCOPE_TYPE, SCOPE);
    expect(screen.getByTestId('scope-current-path')).toHaveTextContent('/ogmc/gcc');
    expect(screen.getByTestId('scope-current-parent')).toHaveTextContent('/ogmc');
    // The only input holding the path is the Move action's own target box.
    const holders = screen.queryAllByDisplayValue('/ogmc/gcc');
    expect(holders.map((el) => el.getAttribute('data-testid'))).toEqual(['scope-move-to']);
    expect(screen.queryByDisplayValue('/ogmc')).toBeNull();
  });

  it('Save keeps the stored path and parent', async () => {
    renderForm(SCOPE_TYPE, SCOPE);
    fireEvent.change(screen.getByDisplayValue('plain'), { target: { value: 'warmer' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(saveEntity).toHaveBeenCalled());
    const [, , input] = saveEntity.mock.calls[0] as unknown as [unknown, unknown, { data: Record<string, unknown> }];
    expect(input.data).toMatchObject({ path: '/ogmc/gcc', parent: '/ogmc', brandVoice: 'warmer' });
  });

  it('Move posts the new path to move-scope and hands back the moved scope', async () => {
    const moved = { ...SCOPE, data: { ...SCOPE.data, path: '/gulf', parent: '' } };
    post.mockResolvedValue({
      moved: { from: '/ogmc/gcc', to: '/gulf', scopes: 2, records: 41 },
      entity: moved,
    });
    const { onSaved } = renderForm(SCOPE_TYPE, SCOPE);
    fireEvent.change(screen.getByTestId('scope-move-to'), { target: { value: '/gulf' } });
    fireEvent.click(screen.getByRole('button', { name: /move scope/i }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(moved));
    expect(post).toHaveBeenCalledWith('api/v1/entities/scope-1/move-scope', { to: '/gulf' });
    expect(saveEntity).not.toHaveBeenCalled();
  });

  it('a scoped record (no parent attribute) keeps its path as an ordinary field', () => {
    renderForm(TOPIC_TYPE, {
      id: 't1',
      entityType: 'topic',
      name: 'T',
      data: { title: 'T', scopePath: '/ogmc' },
    } as unknown as EntityRecord);
    expect(screen.getByDisplayValue('/ogmc')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /move scope/i })).toBeNull();
  });
});
