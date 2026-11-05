/**
 * Project page (bd startsim-472u9 / startsim-85tss): one Brief and a Sources
 * card linking to Research settings. Nothing else.
 */
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href as string} {...rest}>{children}</a>
  ),
}));

const getEntity = vi.fn();
const updateEntity = vi.fn();
const listTypes = vi.fn();
const countEntities = vi.fn();
const listAllEntities = vi.fn();
vi.mock('@/lib/foundry-api', () => ({
  listAllEntities: (...a: unknown[]) => listAllEntities(...a),
  getEntity: (...a: unknown[]) => getEntity(...a),
  updateEntity: (...a: unknown[]) => updateEntity(...a),
  listTypes: (...a: unknown[]) => listTypes(...a),
  countEntities: (...a: unknown[]) => countEntities(...a),
}));

import { ApiException } from '@startsimpli/api';
import { ProjectPage } from '../project-page';

const RECORD = {
  id: 2, entityType: 'scope', externalId: 'scope:/ogmc/gcc-weekly', name: 'GCC Weekly',
  data: { name: 'GCC Weekly', kind: 'project', path: '/ogmc/gcc-weekly', parent: '/ogmc', brandVoice: 'Weekly GCC news' },
  createdAt: '2026-11-04T00:00:00Z',
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ProjectPage id="2" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getEntity.mockReset().mockResolvedValue(RECORD);
  updateEntity.mockReset().mockResolvedValue({ ...RECORD });
  countEntities.mockReset().mockResolvedValue(3);
  listAllEntities.mockReset().mockResolvedValue([{ id: 1, name: 'OGMC', data: { name: 'OGMC', path: '/ogmc', kind: 'client' } }]);
  // `source` is not scoped yet.
  listTypes.mockReset().mockResolvedValue({ results: [{ id: 's', key: 'source', label: 'Source', config: { scope: { pathAttribute: null } }, attributes: [] }] });
});

describe('ProjectPage', () => {
  it('shows the project name and a Brief that reloads what was saved', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'GCC Weekly' })).toBeInTheDocument();
    expect((screen.getByLabelText(/brief/i) as HTMLTextAreaElement).value).toBe('Weekly GCC news');
    expect(screen.getByText('OGMC')).toBeInTheDocument();
    expect(screen.getByText(/\/ogmc\/gcc-weekly · created/)).toBeInTheDocument();
  });

  it('saves the brief to the project record', async () => {
    renderPage();
    const box = await screen.findByLabelText(/brief/i);
    await userEvent.clear(box);
    await userEvent.type(box, 'New brief');
    fireEvent.click(screen.getByRole('button', { name: /save brief/i }));
    await waitFor(() => expect(updateEntity).toHaveBeenCalledTimes(1));
    const [id, body] = updateEntity.mock.calls[0];
    expect(id).toBe(2);
    expect(JSON.stringify(body)).toContain('New brief');
    // The rest of the record survives the write (the PATCH replaces `data`).
    expect(JSON.stringify(body)).toContain('/ogmc/gcc-weekly');
  });

  it('has a Sources card whose Manage link goes to Research settings for this project', async () => {
    renderPage();
    const link = await screen.findByRole('link', { name: /manage sources/i });
    expect(link.getAttribute('href')).toBe('/research/settings?project=%2Fogmc%2Fgcc-weekly');
  });

  it('shows the shared source count while sources are not scoped to a project', async () => {
    renderPage();
    expect(await screen.findByText('3 configured')).toBeInTheDocument();
    expect(countEntities).toHaveBeenCalledWith('source');
  });

  it('has a Change client button, and no Save until the brief changes', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'GCC Weekly' });
    expect(screen.getByRole('button', { name: /change client/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save brief/i })).toBeNull();
  });

  it('counts the project\'s sources once the source type declares a scope path', async () => {
    listTypes.mockResolvedValue({ results: [{ id: 's', key: 'source', label: 'Source', config: { scope: { pathAttribute: 'scope_path' } }, attributes: [] }] });
    renderPage();
    expect(await screen.findByText('3 configured')).toBeInTheDocument();
    expect(countEntities).toHaveBeenCalledWith('source', expect.objectContaining({ scope: '/ogmc/gcc-weekly' }));
  });

  it('an id that names nothing says so at once, with a way back', async () => {
    const gone = new ApiException('Not found');
    gone.status = 404;
    getEntity.mockRejectedValue(gone);
    renderPage();
    expect(await screen.findByText(/this project does not exist/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to projects/i })).toHaveAttribute('href', '/projects');
    expect(getEntity).toHaveBeenCalledTimes(1);
  });
});
