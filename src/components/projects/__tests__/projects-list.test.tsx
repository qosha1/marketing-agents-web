/**
 * Projects list (bd startsim-kqwmm / startsim-frfk8): Name, Client, Sources;
 * search, sort, filters, server-side pagination.
 */
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/projects',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href as string} {...rest}>{children}</a>
  ),
}));

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

  it('links each project name to its page', async () => {
    renderList();
    const link = await screen.findByRole('link', { name: 'GCC Weekly' });
    expect(link).toHaveAttribute('href', '/projects/2');
  });

  it('asks the server for page 1 of projects only, sorted by name', async () => {
    renderList();
    await screen.findByText('GCC Weekly');
    expect(listEntities).toHaveBeenCalledWith('scope', 1, expect.objectContaining({ 'attr.kind': 'project', ordering: 'attr.name' }));
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
    fireEvent.click(screen.getByText('Client'));
    await waitFor(() =>
      expect(listEntities).toHaveBeenLastCalledWith('scope', 1, expect.objectContaining({ ordering: 'attr.parent' })),
    );
  });

  it('pages server-side: more than one page of projects asks the server for page 2', async () => {
    listEntities.mockResolvedValue({ count: 60, next: 'x', previous: null, results: [GCC, BLOG] });
    renderList();
    await screen.findByText('GCC Weekly');
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(listEntities).toHaveBeenLastCalledWith('scope', 2, expect.anything()));
  });

  it('says what to do when there are no projects', async () => {
    listEntities.mockResolvedValue({ count: 0, next: null, previous: null, results: [] });
    renderList();
    expect(await screen.findByText(/no projects yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new project/i })).toBeInTheDocument();
  });

  it('shows a dash in Sources while sources are not scoped to a project', async () => {
    renderList();
    await screen.findByText('GCC Weekly');
    const gccRow = screen.getAllByRole('row').find((r) => r.textContent?.includes('GCC Weekly'))!;
    expect(gccRow.textContent).toMatch(/—|-/);
  });
});
