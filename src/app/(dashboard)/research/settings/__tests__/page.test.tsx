import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { page, renderPage } from '@/lib/research/__tests__/page-harness';
import { record } from '@/lib/research/__tests__/fixtures';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/research/settings',
  useSearchParams: () => new URLSearchParams(),
}));
const api = vi.hoisted(() => ({ listEntities: vi.fn(), listTypes: vi.fn(), updateEntity: vi.fn(), createEntity: vi.fn() }));
vi.mock('@/lib/foundry-api', () => api);

import SettingsPage from '../page';

beforeEach(() => {
  api.listTypes.mockReset().mockResolvedValue(page([{ id: 's', key: 'source', label: 'Source', attributes: [] }] as never));
  api.listEntities.mockReset().mockResolvedValue(
    page([
      record('s1', 'source', { domain: 'example.gov.local', tier: 1, source_type: 'state_wire', active: true }, { name: 'Example Wire' }),
      record('s2', 'source', { domain: 'x.local', tier: 2, source_type: 'independent_press', active: false }, { name: 'X Press' }),
    ]),
  );
});

describe('Research > Settings (source configuration)', () => {
  it('lists Name, Type, Domain, Tier, Active', async () => {
    renderPage(<SettingsPage />);
    await screen.findByText('Example Wire');
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent?.replace(/\s+/g, ''))).toEqual([
      'Name', 'Type', 'Domain', 'Tier', 'Active',
    ]);
    expect(screen.getByText('State wire')).toBeInTheDocument();
    expect(screen.getByText('example.gov.local')).toBeInTheDocument();
    expect(screen.getByText('On')).toBeInTheDocument();
    expect(screen.getByText('Off')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add source' })).toBeInTheDocument();
  });
});
