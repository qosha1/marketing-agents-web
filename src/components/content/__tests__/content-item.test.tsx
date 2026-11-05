/** The Schedule control must exist on an Approved item even when the tenant's type read says nothing about it (bd startsim-bj3zz.12). */
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ContentItem } from '@/components/content/ContentItem';
import type { EntityRecord } from '@/lib/foundry-api';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/foundry-api', () => ({
  getEntity: vi.fn(async () => ({})),
  listTypes: vi.fn(async () => ({ results: [{ key: 'draft', attributes: [{ name: 'status', config: { choices: ['approved'] } }] }] })),
  whoami: vi.fn(async () => ({ role: 'admin' })),
  entityWriteClient: vi.fn(() => ({})),
}));
vi.mock('@/components/content/useContentWrite', () => ({
  useContentWrite: (r: EntityRecord) => ({ record: r, write: vi.fn(), save: { version: null, conflict: null, dialogOpen: false } }),
}));
vi.mock('@/components/content/ContentEditor', () => ({ ContentEditor: () => null }));
vi.mock('@/components/content/CommentsPanel', () => ({ CommentsPanel: () => null }));
vi.mock('@/components/content/ContentHistory', () => ({ ContentHistory: () => null }));
vi.mock('@/lib/revisions', () => ({ revisionClient: () => ({}) }));
vi.mock('@/lib/track-changes', () => ({ canEditRecord: () => true }));
vi.mock('@startsimpli/ui/history', () => ({ StaleSaveDialog: () => null }));

afterEach(cleanup);

describe('Content item scheduling', () => {
  it('shows Schedule on an Approved item', async () => {
    const draft = { id: 1, name: 'X', entityType: 'draft', data: { status: 'approved' } } as unknown as EntityRecord;
    render(<QueryClientProvider client={new QueryClient()}><ContentItem draft={draft} /></QueryClientProvider>);
    expect(await screen.findByRole('button', { name: /Schedule/ })).toBeTruthy();
  });
});
