/**
 * Design-review fixes on the draft Sources tab, the record forms and the
 * channel tabs (bd startsim-cxtgr: sa7vk / 1zaxc.1, 37a4x, dd9s6, t34ur, pmwfj,
 * umlou, nm6zj, hibhn, 44uah, m27hp, m7fdm.33).
 */
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EntityRecord, EntityTypeDef } from '@/lib/foundry-api';

const saveEntity = vi.fn(async () => ({}) as EntityRecord);
const createEntity = vi.fn(async () => ({}) as EntityRecord);

vi.mock('@/lib/entity-cache', () => ({
  saveEntity: (...args: unknown[]) => saveEntity(...(args as [])),
  primeEntity: vi.fn(),
  entityKey: (id: unknown) => ['entity', String(id)],
}));
vi.mock('@/infrastructure/auth', () => ({ getRegisteredToken: () => null }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/foundry-api', async (orig) => ({
  ...(await orig<typeof import('@/lib/foundry-api')>()),
  createEntity: (...args: unknown[]) => createEntity(...(args as [])),
  orgMembers: vi.fn(async () => []),
}));

import { SourcesTool } from '../draft-review/SourcesTool';
import { ContentChannels } from '../draft-review/ContentChannels';
import { RecordEditFields } from '../entity-detail-drawer';
import { RecordForm } from '../record-form';
import type { ParsedSource } from '@/lib/sources';

const TODAY = new Date('2026-10-18T00:00:00Z');

function src(url: string, date = '2026-10-10'): ParsedSource {
  return { id: url, url, publisher: 'AGBI', date, note: '', raw: url } as unknown as ParsedSource;
}

function tool(items: ParsedSource[], approvedHosts: string[] | null = null) {
  return render(
    <SourcesTool
      items={items}
      verified={{}}
      approvedHosts={approvedHosts}
      today={TODAY}
      onAdd={vi.fn()}
      onRemove={vi.fn()}
      onToggleVerify={vi.fn()}
    />,
  );
}

describe('Sources tab', () => {
  it('does not say one source backs the brief when there are none', () => {
    tool([]);
    expect(screen.getByText(/No sources recorded/)).toBeInTheDocument();
    expect(screen.queryByText(/One source backs/)).toBeNull();
  });

  it('still flags a single source', () => {
    tool([src('https://agbi.com/a')]);
    expect(screen.getByText(/One source backs the whole brief/)).toBeInTheDocument();
  });

  it('with no approved-source list: no "?" tile, no Tier chip, and the host once', () => {
    tool([src('https://agbi.com/a')], null);
    expect(screen.queryByText('?')).toBeNull();
    expect(screen.queryByText(/Tier/)).toBeNull();
    expect(screen.getAllByText('agbi.com')).toHaveLength(1);
  });

  it('the add-source label does not wait for a list that already answered', () => {
    tool([], null);
    expect(screen.getByText('Add a source')).toBeInTheDocument();
    expect(screen.queryByText(/until the approved-source list loads/)).toBeNull();
  });
});

describe('channel tab dot', () => {
  it('says why on hover', () => {
    render(<ContentChannels channels={[{ id: 'sources', label: 'Sources', warn: 'No sources', content: null }]} />);
    expect(screen.getByRole('img', { name: 'No sources' })).toHaveAttribute('title', 'No sources');
  });
});

const TOPIC_TYPE = {
  id: 'tt',
  key: 'topic',
  label: 'Topic',
  attributes: [
    { id: '1', name: 'title', dataType: 'text', required: false, config: {} },
    { id: '2', name: 'content_type', dataType: 'enum', required: false, config: { choices: ['weekly_brief', 'general'] } },
    { id: '3', name: 'ai_rank', dataType: 'number', required: false, config: {} },
    { id: '4', name: '_run_id', dataType: 'text', required: false, config: {} },
  ],
} as unknown as EntityTypeDef;

function withQc(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  saveEntity.mockClear();
  createEntity.mockClear();
});

describe('Edit fields', () => {
  it('shows one title field when title copies the name, and saves the name to both', async () => {
    const rec = { id: 't1', entityType: 'topic', name: 'Bahrain', data: { title: 'Bahrain' } } as unknown as EntityRecord;
    withQc(<RecordEditFields type={TOPIC_TYPE} record={rec} onSaved={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getAllByDisplayValue('Bahrain')).toHaveLength(1);
    fireEvent.change(screen.getByDisplayValue('Bahrain'), { target: { value: 'Bahrain filing' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(saveEntity).toHaveBeenCalled());
    const [, , input] = saveEntity.mock.calls[0] as unknown as [unknown, unknown, { name: string; data: Record<string, unknown> }];
    expect(input.name).toBe('Bahrain filing');
    expect(input.data.title).toBe('Bahrain filing');
  });

  it('keeps a separate Title field when it already differs from the name', () => {
    const rec = { id: 't1', entityType: 'topic', name: 'slug', data: { title: 'A real title' } } as unknown as EntityRecord;
    withQc(<RecordEditFields type={TOPIC_TYPE} record={rec} onSaved={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByDisplayValue('A real title')).toBeInTheDocument();
  });

  it('labels each field once, in words', () => {
    const rec = { id: 't1', entityType: 'topic', name: 'x', data: {} } as unknown as EntityRecord;
    withQc(<RecordEditFields type={TOPIC_TYPE} record={rec} onSaved={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getAllByText('AI rank')).toHaveLength(1);
    expect(screen.getAllByText('Kind')).toHaveLength(1);
    expect(screen.queryByText(/ai rank/)).toBeNull();
    expect(screen.queryByText(/run id/i)).toBeNull();
  });
});

describe('Add record form', () => {
  it('has no separate title or system fields, and readable labels', () => {
    withQc(<RecordForm type={TOPIC_TYPE} />);
    expect(screen.queryByLabelText(/^title$/i)).toBeNull();
    expect(screen.queryByText(/run id|_run_id/i)).toBeNull();
    expect(screen.getByText('Kind')).toBeInTheDocument();
    expect(screen.getByText('AI rank')).toBeInTheDocument();
  });

  it('says Name is required at the field', () => {
    withQc(<RecordForm type={TOPIC_TYPE} />);
    fireEvent.click(screen.getByRole('button', { name: /add topic/i }));
    expect(screen.getByText('Name is required.')).toBeInTheDocument();
    expect(createEntity).not.toHaveBeenCalled();
  });

  it('opens with the kind of the list it came from, and writes the name as the title', async () => {
    withQc(<RecordForm type={TOPIC_TYPE} defaults={{ content_type: 'weekly_brief' }} />);
    expect(screen.getAllByText('Weekly brief').length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'New one' } });
    fireEvent.click(screen.getByRole('button', { name: /add topic/i }));
    await waitFor(() => expect(createEntity).toHaveBeenCalled());
    const [input] = createEntity.mock.calls[0] as unknown as [{ name: string; data: Record<string, unknown> }];
    expect(input.data).toMatchObject({ content_type: 'weekly_brief', title: 'New one' });
  });
});
