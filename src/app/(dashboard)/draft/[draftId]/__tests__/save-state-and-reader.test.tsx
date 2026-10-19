/**
 * The draft page's save pill tells the truth, and a view-only reader cannot
 * write through SEO or Sources (bd startsim-m7fdm.30, startsim-m7fdm.31;
 * review beads startsim-7ds2n, startsim-vzdz9, startsim-7nrqy).
 *
 * THE PILL. The editors show "Save failed" only when their `onSave` rejects. The
 * page's writer resolved `false` for a 500, a 412 refusal and a pause alike, so
 * after a failed save the pill read "Saved" beside the error toast or the
 * "changed while you were editing" dialog — and a reviewer closed the tab.
 *
 * THE READER. The bottom bar told a reader "read, suggest and comment", while
 * the SEO inputs autosaved and + Add / Verify / Remove were live on Sources.
 *
 * The page runs for real here: its save hook, its report(), its editors. Only
 * the network and the rail around them are stubbed.
 */
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReactNode } from 'react';
import type { EntityRecord } from '@/lib/foundry-api';

const search = { channel: 'seo' };
vi.mock('next/navigation', () => ({
  useParams: () => ({ draftId: 'd1' }),
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/draft/d1',
}));
vi.mock('next/link', async () => {
  const R = await import('react');
  return {
    default: ({ children, href }: { children?: ReactNode; href?: string }) => R.createElement('a', { href }, children),
  };
});

const write = vi.fn();
let draft: EntityRecord;
vi.mock('@/lib/foundry-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/foundry-api')>()),
  getEntity: vi.fn(async () => draft),
  listAllEntities: vi.fn(async () => []),
  listTypes: vi.fn(async () => ({ results: [] })),
  whoami: vi.fn(async () => ({ sub: 'u1', role: 'member' })),
  entityWriteClient: () => ({ write }),
}));
vi.mock('@/lib/topic-drafts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/topic-drafts')>()),
  fetchDraftTranslations: vi.fn(async () => []),
}));
// The rail and the per-field "edited by" line read the trail over the network;
// neither is what these tests are about.
vi.mock('@/components/draft-review/HistoryRail', () => ({ HistoryRail: () => null }));
vi.mock('@/components/draft-review/LanguageSwitcher', () => ({ LanguageSwitcher: () => null }));
vi.mock('@startsimpli/ui/history', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@startsimpli/ui/history')>()),
  FieldAttribution: () => null,
  useFieldAuthors: () => ({ data: undefined }),
}));

import DraftPage from '../page';

function makeDraft(canEdit: boolean): EntityRecord {
  return {
    id: 'd1',
    name: 'A brief',
    version: 3,
    permissions: { canEdit },
    data: {
      content_type: 'general',
      blog: 'Body',
      linkedin: 'Post',
      seo: { meta_description: 'Old description' },
      sources: ['Gulf News — https://gulfnews.com/a'],
    },
  } as unknown as EntityRecord;
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DraftPage />
    </QueryClientProvider>,
  );
}

async function seoInput(): Promise<HTMLInputElement | HTMLTextAreaElement> {
  return (await screen.findByDisplayValue('Old description')) as HTMLInputElement;
}

beforeEach(() => {
  write.mockReset();
  search.channel = 'seo';
});

describe('the save pill after a save that did not land', () => {
  it('reads "Save failed" when the server errors, not "Saved"', async () => {
    draft = makeDraft(true);
    write.mockRejectedValue(new Error('tenant is down'));
    renderPage();

    fireEvent.change(await seoInput(), { target: { value: 'New description' } });

    await waitFor(() => expect(write).toHaveBeenCalled(), { timeout: 3000 });
    expect(await screen.findByText('Save failed', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('reads "Save failed" behind the changed-while-editing dialog, not "Saved"', async () => {
    draft = makeDraft(true);
    write.mockResolvedValue({ status: 412, body: { detail: 'Stale', current_version: 4 } });
    renderPage();

    fireEvent.change(await seoInput(), { target: { value: 'New description' } });

    await waitFor(() => expect(write).toHaveBeenCalled(), { timeout: 3000 });
    expect(await screen.findByText('Save failed', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('still reads "Saved" when the save lands', async () => {
    draft = makeDraft(true);
    write.mockImplementation(async ({ body }: { body: { data: Record<string, unknown> } }) => ({
      status: 200,
      body: { ...draft, version: 4, data: body.data },
    }));
    renderPage();

    fireEvent.change(await seoInput(), { target: { value: 'New description' } });

    expect(await screen.findByText('Saved', {}, { timeout: 3000 })).toBeInTheDocument();
  });
});

describe('a view-only reader', () => {
  it('sees the SEO fields as text, with nothing to type into and nothing autosaving', async () => {
    draft = makeDraft(false);
    renderPage();

    expect(await screen.findByText('Old description')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Old description')).toBeNull();
    expect(write).not.toHaveBeenCalled();
  });

  it('gets no Add, Verify or Remove on Sources', async () => {
    draft = makeDraft(false);
    search.channel = 'sources';
    renderPage();

    const panel = (await screen.findByText(/Sources · evidence behind the brief/)).closest('div')!.parentElement!;
    expect(within(panel).getByText(/Gulf News/)).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: /^verify$/i })).toBeNull();
    expect(within(panel).queryByRole('button', { name: /remove/i })).toBeNull();
    expect(within(panel).queryByRole('button', { name: /add/i })).toBeNull();
    expect(within(panel).queryByRole('textbox')).toBeNull();
  });

  it('an editor still gets them', async () => {
    draft = makeDraft(true);
    search.channel = 'sources';
    renderPage();

    const panel = (await screen.findByText(/Sources · evidence behind the brief/)).closest('div')!.parentElement!;
    expect(within(panel).getByRole('button', { name: /^verify$/i })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: /remove/i })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: /add/i })).toBeInTheDocument();
  });
});
