/**
 * New project dialog (bd startsim-s9v64 / startsim-gabli): Name, and
 * "Is it for a client? Optional" with "No, it's my own".
 */
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => '/projects',
  useSearchParams: () => new URLSearchParams(),
}));

const createEntity = vi.fn();
const listAllEntities = vi.fn();
vi.mock('@/lib/foundry-api', () => ({
  createEntity: (...a: unknown[]) => createEntity(...a),
  listAllEntities: (...a: unknown[]) => listAllEntities(...a),
  listEntities: vi.fn(),
}));

import { NewProjectDialog } from '../new-project-dialog';

const CLIENTS = [{ path: '/ogmc', name: 'OGMC', active: true }];

function renderDialog() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NewProjectDialog open onOpenChange={vi.fn()} clients={CLIENTS} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  push.mockReset();
  createEntity.mockReset();
  listAllEntities.mockReset();
  listAllEntities.mockResolvedValue([]);
  createEntity.mockResolvedValue({ id: 42 });
});

describe('NewProjectDialog', () => {
  it('asks "Is it for a client?" as optional, defaulting to "No, it\'s my own"', () => {
    renderDialog();
    expect(screen.getByLabelText(/^name/i)).toBeInTheDocument();
    expect(screen.getByText(/is it for a client\?/i)).toBeInTheDocument();
    expect(screen.getAllByText(/optional/i).length).toBeGreaterThan(0);
    const select = screen.getByLabelText(/is it for a client/i) as HTMLSelectElement;
    expect(select.selectedOptions[0].textContent).toBe("No, it's my own");
  });

  it('submit with no client creates a solo project and opens its page', async () => {
    renderDialog();
    await userEvent.type(screen.getByLabelText(/^name/i), 'My Blog');
    fireEvent.click(screen.getByRole('button', { name: /create project/i }));
    await waitFor(() => expect(createEntity).toHaveBeenCalledTimes(1));
    expect(createEntity.mock.calls[0][0]).toMatchObject({
      entityType: 'scope',
      name: 'My Blog',
      data: { kind: 'project', path: '/my-blog', parent: '' },
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith('/projects/42'));
  });

  it('submit with a client links it, and starts with no sources of its own', async () => {
    renderDialog();
    await userEvent.type(screen.getByLabelText(/^name/i), 'GCC Weekly');
    await userEvent.selectOptions(screen.getByLabelText(/is it for a client/i), '/ogmc');
    fireEvent.click(screen.getByRole('button', { name: /create project/i }));
    await waitFor(() => expect(createEntity).toHaveBeenCalledTimes(1));
    const sent = createEntity.mock.calls[0][0];
    expect(sent.data).toMatchObject({ kind: 'project', path: '/ogmc/gcc-weekly', parent: '/ogmc' });
    // A project is born as a scope row only: nothing is copied or linked in.
    expect(createEntity).toHaveBeenCalledTimes(1);
    expect(Object.keys(sent.data).sort()).toEqual(['active', 'kind', 'name', 'parent', 'path']);
  });

  it('requires a name: nothing is created and the field says so', async () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /create project/i }));
    expect(await screen.findByText(/name is required/i)).toBeInTheDocument();
    expect(createEntity).not.toHaveBeenCalled();
  });

  it('does not collide with an existing scope path', async () => {
    listAllEntities.mockResolvedValue([{ id: 9, data: { path: '/my-blog' } }]);
    renderDialog();
    await userEvent.type(screen.getByLabelText(/^name/i), 'My Blog');
    fireEvent.click(screen.getByRole('button', { name: /create project/i }));
    await waitFor(() => expect(createEntity).toHaveBeenCalled());
    expect(createEntity.mock.calls[0][0].data.path).toBe('/my-blog-2');
  });

  it('"New client…" makes the client first, then the project under it', async () => {
    createEntity.mockResolvedValueOnce({ id: 7, data: { path: '/acme', kind: 'client' } }).mockResolvedValueOnce({ id: 8 });
    renderDialog();
    await userEvent.type(screen.getByLabelText(/^name/i), 'Launch');
    await userEvent.selectOptions(screen.getByLabelText(/is it for a client/i), '__new__');
    await userEvent.type(screen.getByLabelText(/client name/i), 'Acme');
    fireEvent.click(screen.getByRole('button', { name: /create project/i }));
    await waitFor(() => expect(createEntity).toHaveBeenCalledTimes(2));
    expect(createEntity.mock.calls[0][0].data).toMatchObject({ kind: 'client', path: '/acme', parent: '' });
    expect(createEntity.mock.calls[1][0].data).toMatchObject({ kind: 'project', path: '/acme/launch', parent: '/acme' });
    await waitFor(() => expect(push).toHaveBeenCalledWith('/projects/8'));
  });

  it('"New client…" with no client name creates nothing and says so', async () => {
    renderDialog();
    await userEvent.type(screen.getByLabelText(/^name/i), 'Launch');
    await userEvent.selectOptions(screen.getByLabelText(/is it for a client/i), '__new__');
    fireEvent.click(screen.getByRole('button', { name: /create project/i }));
    expect(await screen.findByText(/client name is required/i)).toBeInTheDocument();
    expect(createEntity).not.toHaveBeenCalled();
  });

  it('says a client is optional and a new project starts empty', () => {
    renderDialog();
    expect(screen.getByText(/a client is optional\. you can set it later/i)).toBeInTheDocument();
    expect(screen.getByText(/a new project starts empty\. add sources next/i)).toBeInTheDocument();
  });
});
