/** The Schedule control must exist on an Approved item even when the tenant's type read says nothing about it (bd startsim-bj3zz.12). */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
const writeMock = vi.fn(async (..._a: unknown[]) => true);
let latestData: Record<string, unknown> = {};
vi.mock('@/components/content/useContentWrite', () => ({
  useContentWrite: (r: EntityRecord) => ({
    record: r,
    write: writeMock,
    latest: () => ({ data: latestData }),
    save: { version: null, conflict: null, dialogOpen: false },
  }),
}));
vi.mock('@startsimpli/ui', async (orig) => ({ ...(await orig<object>()), notify: { success: vi.fn(), error: vi.fn() } }));
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

  async function openPicker() {
    const draft = { id: 1, name: 'X', entityType: 'draft', data: { status: 'approved' } } as unknown as EntityRecord;
    render(<QueryClientProvider client={new QueryClient()}><ContentItem draft={draft} /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole('button', { name: /^Schedule/ }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Schedule' }).at(-1)!);
  }

  it('shows an error and keeps the picker open when the schedule write is refused', async () => {
    writeMock.mockResolvedValueOnce(false);
    await openPicker();
    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not schedule/);
  });

  it('shows an error when the server accepts the write but does not keep the status', async () => {
    writeMock.mockResolvedValueOnce(true);
    latestData = { status: 'approved' };
    await openPicker();
    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not schedule/);
  });

  it('closes the picker when the status really became scheduled', async () => {
    writeMock.mockResolvedValueOnce(true);
    latestData = { status: 'scheduled' };
    await openPicker();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
