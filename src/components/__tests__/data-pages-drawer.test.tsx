/**
 * The generic record drawer on the data pages (Scope, Source, News item):
 * one name, readable choice values, no internal key, and no "Good example"
 * star on a record nothing reads as an example (bd startsim-0hivf,
 * startsim-unj2l, startsim-t6v06, startsim-wn2fp).
 */
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { EntityRecord, EntityTypeDef } from '@/lib/foundry-api';

vi.mock('@/infrastructure/auth', () => ({ getRegisteredToken: () => null }));
vi.mock('@/lib/api', () => ({ api: { client: { post: vi.fn(), get: vi.fn() } } }));
vi.mock('../record-history-section', () => ({ RecordHistorySection: () => null }));
vi.mock('@/lib/foundry-api', async (orig) => ({
  ...(await orig<typeof import('@/lib/foundry-api')>()),
  listAllTags: vi.fn(async () => []),
  listAllEntities: vi.fn(async () => []),
}));

import { EntityDetailDrawer, readFields } from '../entity-detail-drawer';

const SCOPE_TYPE = {
  id: 'st',
  key: 'scope',
  label: 'Scope',
  config: {},
  attributes: [
    { id: '1', name: 'name', dataType: 'text', required: true, config: {} },
    { id: '2', name: 'kind', dataType: 'enum', required: false, config: { choices: ['client', 'project'] } },
    { id: '3', name: 'path', dataType: 'text', required: true, config: {} },
  ],
} as unknown as EntityTypeDef;

const TOPIC_TYPE = {
  id: 'tt',
  key: 'topic',
  label: 'Topic',
  config: {},
  attributes: [{ id: '1', name: 'title', dataType: 'text', required: false, config: {} }],
} as unknown as EntityTypeDef;

function scope(name: string, dataName: string): EntityRecord {
  return {
    id: 'scope-1',
    entityType: 'scope',
    externalId: 'scope:/ogmc',
    name,
    data: { name: dataName, kind: 'client', path: '/ogmc' },
  } as unknown as EntityRecord;
}

function renderDrawer(type: EntityTypeDef, record: EntityRecord) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <EntityDetailDrawer type={type} record={record} onClose={vi.fn()} onSaved={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe('readFields', () => {
  it('drops a name attribute that only repeats the record name', () => {
    const labels = readFields(SCOPE_TYPE, scope('OGMC', 'OGMC')).map((f) => f.label);
    expect(labels).toEqual(['kind', 'path']);
  });

  it('keeps a name attribute that says something different', () => {
    const labels = readFields(SCOPE_TYPE, scope('Agent test (isolated)', 'Agent test — isolated sandbox')).map(
      (f) => f.label,
    );
    expect(labels).toContain('name');
  });

  it('shows a choice the way the board lane does', () => {
    const kind = readFields(SCOPE_TYPE, scope('OGMC', 'OGMC')).find((f) => f.label === 'kind');
    expect(kind?.value).toBe('Client');
  });
});

describe('the drawer on a scope', () => {
  it('prints no external_id line', () => {
    renderDrawer(SCOPE_TYPE, scope('OGMC', 'OGMC'));
    expect(screen.queryByText(/external_id/)).toBeNull();
  });

  it('offers no Good example star on a scope', () => {
    renderDrawer(SCOPE_TYPE, scope('OGMC', 'OGMC'));
    expect(screen.queryByRole('button', { name: /good example/i })).toBeNull();
  });

  it('still offers it on a topic', async () => {
    renderDrawer(TOPIC_TYPE, { id: 't1', entityType: 'topic', name: 'A topic', data: {} } as unknown as EntityRecord);
    expect(await screen.findByRole('button', { name: /good example/i })).toBeTruthy();
  });
});
