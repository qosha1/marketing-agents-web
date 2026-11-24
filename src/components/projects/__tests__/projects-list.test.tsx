/**
 * Projects list (bd startsim-kqwmm / startsim-frfk8): Name, Client, Sources;
 * search, sort, filters, server-side pagination.
 */
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/projects',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push, replace: vi.fn() }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href as string} {...rest}>{children}</a>
  ),
}));

const push = vi.fn();
const listEntities = vi.fn();
const listAllEntities = vi.fn();
vi.mock('@/lib/foundry-api', () => ({
  listEntities: (...a: unknown[]) => listEntities(...a),
  listAllEntities: (...a: unknown[]) => listAllEntities(...a),
  listTypes: async () => ({ results: [] }),
  createEntity: vi.fn(),
}));

import { ProjectsList } from '../projects-list';

function rec(id: number, data: Record<string, unknown>) {
  return { id, entityType: 'scope', externalId: `scope:${data.path}`, name: String(data.name), data, createdAt: '2026-11-04T00:00:00Z' };
}
const CLIENT = rec(1, { name: 'OGMC', kind: 'client', path: '/ogmc', parent: '' });
const GCC = rec(2, { name: 'GCC Weekly', kind: 'project', path: '/ogmc/gcc-weekly', parent: '/ogmc' });
const BLOG = rec(3, { name: 'My Blog', kind: 'project', path: '/my-blog', parent: '' });

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ProjectsList />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  push.mockReset();
  listEntities.mockReset();
  listAllEntities.mockReset();
  listAllEntities.mockResolvedValue([CLIENT]);
  listEntities.mockResolvedValue({ count: 2, next: null, previous: null, results: [GCC, BLOG] });
});

describe('ProjectsList', () => {
  it('renders a row per project with Name and Client columns, client blank when there is none', async () => {
    renderList();
    expect(await screen.findByText('GCC Weekly')).toBeInTheDocument();
    expect(screen.getByText('My Blog')).toBeInTheDocument();
    for (const h of ['Name', 'Client', 'Sources']) {
      expect(screen.getAllByText(h).length).toBeGreaterThan(0);
    }
    const rows = screen.getAllByRole('row');
    const gccRow = rows.find((r) => r.textContent?.includes('GCC Weekly'))!;
    const blogRow = rows.find((r) => r.textContent?.includes('My Blog'))!;
    expect(gccRow.textContent).toContain('OGMC');
    expect(blogRow.textContent).not.toContain('OGMC');
  });

  it('opens a project when its row is clicked', async () => {
    renderList();
    fireEvent.click(await screen.findByText('GCC Weekly'));
    expect(push).toHaveBeenCalledWith('/projects/2');
  });

  it('hides the Client column and filter when there is no client at all', async () => {
    listAllEntities.mockResolvedValue([]);
    listEntities.mockResolvedValue({ count: 1, next: null, previous: null, results: [BLOG] });
    renderList();
    await screen.findByText('My Blog');
    expect(screen.queryByText('Client')).toBeNull();
    expect(screen.queryByLabelText('Client')).toBeNull();
  });

  it('filters by client on the server', async () => {
    renderList();
    await screen.findByText('GCC Weekly');
    fireEvent.change(await screen.findByLabelText('Client'), { target: { value: '/ogmc' } });
    await waitFor(() =>
      expect(listEntities).toHaveBeenLastCalledWith('scope', 1, expect.objectContaining({ 'attr.parent': '/ogmc' })),
    );
  });

  it('counts the projects under the title', async () => {
    renderList();
    expect(await screen.findByText('2 projects')).toBeInTheDocument();
  });

  it('asks the server for page 1 of projects only, sorted by name', async () => {
    renderList();
    await screen.findByText('GCC Weekly');
    expect(listEntities).toHaveBeenCalledWith('scope', 1, expect.objectContaining({ 'attr.kind': 'project', order: 'attr.name' }));
  });

  it('searches by name on the server', async () => {
    renderList();
    await screen.findByText('GCC Weekly');
    fireEvent.change(screen.getByPlaceholderText(/search projects/i), { target: { value: 'gcc' } });
    await waitFor(() =>
      expect(listEntities).toHaveBeenLastCalledWith('scope', 1, expect.objectContaining({ 'attr.name__icontains': 'gcc' })),
    );
  });

  it('sorts server-side when a header is clicked', async () => {
    renderList();
    await screen.findByText('GCC Weekly');
    fireEvent.click(within(screen.getByRole('columnheader', { name: /client/i })).getByRole('button'));
    await waitFor(() =>
      expect(listEntities).toHaveBeenLastCalledWith('scope', 1, expect.objectContaining({ order: 'attr.parent' })),
    );
  });

  it('pages server-side: more than one page of projects asks the server for page 2', async () => {
    listEntities.mockResolvedValue({ count: 60, next: 'x', previous: null, results: [GCC, BLOG] });
    renderList();
    await screen.findByText('GCC Weekly');
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(listEntities).toHaveBeenLastCalledWith('scope', 2, expect.anything()));
  });

  it('first run: "Start your first project" with the New project action and the client hint', async () => {
    listAllEntities.mockResolvedValue([]);
    listEntities.mockResolvedValue({ count: 0, next: null, previous: null, results: [] });
    renderList();
    expect(await screen.findByText('Start your first project')).toBeInTheDocument();
    expect(screen.getByText(/writing for clients\? you can pick or add one/i)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /new project/i }).length).toBeGreaterThan(0);
  });

  it('marks the active project as Current', async () => {
    Object.defineProperty(window, 'localStorage', {
      value: { getItem: () => '/my-blog', setItem: vi.fn(), removeItem: vi.fn() },
      configurable: true,
    });
    renderList();
    await screen.findByText('My Blog');
    const blogRow = screen.getAllByRole('row').find((r) => r.textContent?.includes('My Blog'))!;
    expect(blogRow.textContent).toContain('Current');
  });
});
