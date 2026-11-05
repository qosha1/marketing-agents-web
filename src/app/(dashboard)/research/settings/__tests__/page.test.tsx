import { fireEvent, screen, waitFor } from '@testing-library/react';
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
  api.listTypes.mockReset().mockResolvedValue(page([{ id: 's', key: 'source', label: 'Source', attributes: [{ id: 'a', name: 'source_type', dataType: 'enum', required: false, config: { choices: ['state_wire', 'advisory'] } }] }] as never));
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
    expect(screen.getByRole('cell', { name: 'State wire' })).toBeInTheDocument();
    expect(screen.getByText('example.gov.local')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'On' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Off' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add source' })).toBeInTheDocument();
  });

  it('says whether documents are still arriving, and offers Type and Active filters', async () => {
    renderPage(<SettingsPage />);
    expect(await screen.findByText(/Articles are arriving\. Last one .* ago\./)).toBeInTheDocument();
    expect(screen.getByText('2 sources configured')).toBeInTheDocument();
    expect(screen.getByLabelText('Type')).toBeInTheDocument();
    expect(screen.getByLabelText('Active')).toBeInTheDocument();
  });

  it('narrows by type and active on the server', async () => {
    renderPage(<SettingsPage />);
    await screen.findByText('Example Wire');
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'advisory' } });
    fireEvent.change(screen.getByLabelText('Active'), { target: { value: 'on' } });
    await waitFor(() => {
      const last = api.listEntities.mock.calls.filter((c) => c[0] === 'source').at(-1)!;
      expect(last[2]['attr.source_type']).toBe('advisory');
      expect(last[2]['attr.active']).toBe('true');
    });
  });
});
