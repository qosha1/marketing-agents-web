/**
 * Sidebar switcher (wireframe C01): a button naming the project, a menu of
 * projects (own first, then by client), All projects, Manage projects.
 */
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listAllEntities = vi.fn();
vi.mock('@/lib/foundry-api', () => ({ listAllEntities: (...a: unknown[]) => listAllEntities(...a) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href as string} {...rest}>{children}</a>
  ),
}));

import { ProjectSwitcher } from '../project-switcher';
import { getActiveProjectId, setActiveProjectId } from '@/lib/project-scope';

const row = (id: number, name: string, path: string, kind: string, parent = '') => ({
  id, entityType: 'scope', externalId: null, name, createdAt: '', data: { name, path, kind, parent, active: true },
});
const SCOPES = [
  row(1, 'Acme', '/acme', 'client'),
  row(2, 'Launch', '/acme/launch', 'project', '/acme'),
  row(3, 'Field Notes', '/field-notes', 'project'),
];

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ProjectSwitcher /></QueryClientProvider>);
}

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', { value: memoryStorage(), configurable: true });
  listAllEntities.mockReset();
});

describe('ProjectSwitcher', () => {
  it('opens a menu: own projects, each client with its projects, All projects, Manage projects', async () => {
    listAllEntities.mockResolvedValue(SCOPES);
    renderIt();
    await userEvent.click(await screen.findByRole('button', { name: /all projects/i }));
    const items = screen
      .getAllByRole('menuitem')
      // The round avatar letter is decoration (aria-hidden), so it is not part of the name.
      .map((i) => (i.textContent ?? '').replace(/^[A-Z](?=[A-Z])/, ''));
    expect(items).toEqual(['Field Notes', 'Launch', 'All projects', 'Manage projects']);
    expect(screen.getByText('Acme')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Manage projects' })).toHaveAttribute('href', '/projects');
  });

  it('picking a project stores its path; All projects clears it', async () => {
    listAllEntities.mockResolvedValue(SCOPES);
    renderIt();
    await userEvent.click(await screen.findByRole('button', { name: /all projects/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Launch' }));
    expect(getActiveProjectId()).toBe('/acme/launch');
    // The button now names the project with its client above it.
    const button = await screen.findByRole('button', { name: /launch/i });
    expect(button.textContent).toContain('Acme');
    await userEvent.click(button);
    await userEvent.click(screen.getByRole('menuitem', { name: /all projects/i }));
    expect(getActiveProjectId()).toBeNull();
  });

  it('shows the stored choice after a reload', async () => {
    setActiveProjectId('/field-notes');
    listAllEntities.mockResolvedValue(SCOPES);
    renderIt();
    const button = await screen.findByRole('button', { name: /field notes/i });
    expect(button.textContent).toContain('Project');
  });

  it('a stored path that names nothing is dropped, not left to empty every list', async () => {
    setActiveProjectId('/deleted');
    listAllEntities.mockResolvedValue(SCOPES);
    renderIt();
    await waitFor(() => expect(getActiveProjectId()).toBeNull());
  });

  it('a tenant with no projects reads "No client yet" and creates nothing', async () => {
    listAllEntities.mockResolvedValue([]);
    renderIt();
    expect(await screen.findByRole('button', { name: /no client yet/i })).toBeInTheDocument();
    expect(listAllEntities).toHaveBeenCalledTimes(1);
  });

  it('Escape closes the menu', async () => {
    listAllEntities.mockResolvedValue(SCOPES);
    renderIt();
    await userEvent.click(await screen.findByRole('button', { name: /all projects/i }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
