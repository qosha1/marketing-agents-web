/**
 * A view-only reader is not shown controls they cannot use (bd startsim-whwxd.22,
 * epic startsim-768w.71).
 *
 * #102 hid most of the draft page's write controls from someone whose share on
 * the draft is "Can view". Two were left: the "+ AR / + ZH" translate buttons,
 * which create a new draft in the same space, and the Approve draft / Reject
 * draft decision, which rendered DISABLED with a tooltip. Quinn's rule is that a
 * control the person cannot use is hidden, not greyed out. The decision itself
 * has since been removed for everyone (bd startsim-m7fdm.25).
 */
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { EntityRecord } from '@/lib/foundry-api';

vi.mock('@/lib/topic-drafts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/topic-drafts')>()),
  fetchDraftTranslations: vi.fn(async () => []),
}));
vi.mock('@/lib/foundry-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/foundry-api')>()),
  listTypes: vi.fn(async () => ({
    results: [
      {
        key: 'draft',
        attributes: [{ name: 'lang', dataType: 'enum', config: { choices: ['en', 'ar', 'zh'] } }],
      },
    ],
  })),
}));

import { LanguageSwitcher } from '../LanguageSwitcher';

function withQuery(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

const draft = { id: 'd1', name: 'A brief', data: { lang: 'en' } } as unknown as EntityRecord;

describe('the translate buttons', () => {
  it('are hidden from a view-only reader', async () => {
    withQuery(<LanguageSwitcher draft={draft} canEdit={false} />);
    await waitFor(() => expect(screen.getByText(/No translations yet/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /\+ ar|\+ zh/i })).toBeNull();
    expect(screen.queryAllByRole('button')).toEqual([]);
  });

  it('are offered to someone who can edit', async () => {
    withQuery(<LanguageSwitcher draft={draft} canEdit />);
    await waitFor(() => expect(screen.getByRole('button', { name: '+ ar' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: '+ zh' })).toBeInTheDocument();
  });
});
