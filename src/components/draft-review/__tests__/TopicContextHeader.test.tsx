/**
 * The topic, at the top of its draft (bd startsim-z384k).
 *
 * THE REAL DECIDER RUNS HERE. `resolveReviewConfig` is imported for real, not
 * stubbed: the whole claim this component makes is that it shows the same fields
 * the modal shows because it resolves the same field map from the same schema. A
 * mocked resolver would test a hand-written list of attribute names, which is
 * exactly the thing this component exists not to be.
 *
 * The fixture is the live marketing-agents `topic` schema, read from
 * `GET /api/v1/schema/types/` on 2026-09-22.
 *
 * EDITING (bd startsim-m7fdm.7) IS ASSERTED ON THE BODY THAT LEAVES THE
 * COMPONENT, not on the form. lib/__tests__/topic-edit.test.ts already proves
 * the body's SHAPE down to the wire; what only a render can show is that the
 * panel calls that path at all, with the blob it re-read, and that the one
 * control the panel already had gets out of the way while a form is open.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { EntityRecord, EntityTypeDef } from '@/lib/foundry-api';

vi.mock('next/link', async () => {
  const React = await import('react');
  return {
    default: ({ children, href }: { children?: ReactNode; href?: string }) =>
      React.createElement('a', { href }, children),
  };
});

const saveEntity = vi.fn(async () => ({}) as EntityRecord);
const getEntity = vi.fn(async (id: unknown) => ({ id, data: {} }) as unknown as EntityRecord);

vi.mock('@/lib/entity-cache', () => ({
  saveEntity: (...args: unknown[]) => saveEntity(...(args as [])),
  primeEntity: vi.fn(),
  entityKey: (id: unknown) => ['entity', String(id)],
}));
vi.mock('@/lib/foundry-api', () => ({
  getEntity: (...args: unknown[]) => getEntity(...(args as [unknown])),
}));
vi.mock('@startsimpli/auth', () => ({
  useAuth: () => ({ user: { email: 'jurga@ogmc.example' } }),
}));

const { TopicContextHeader } = await import('../TopicContextHeader');

const TOPIC_TYPE = {
  id: 1,
  key: 'topic',
  label: 'Topic',
  attributes: [
    { id: 1, name: 'title', dataType: 'text', required: false, config: {} },
    { id: 2, name: 'angle', dataType: 'longtext', required: false, config: {} },
    { id: 3, name: 'market', dataType: 'text', required: false, config: {} },
    {
      id: 4,
      name: 'content_type',
      dataType: 'enum',
      required: false,
      config: { choices: ['weekly_brief', 'lead_magnet', 'general'] },
    },
    {
      id: 5,
      name: 'status',
      dataType: 'enum',
      required: false,
      config: { choices: ['suggested', 'ready', 'rejected', 'written'] },
    },
    { id: 6, name: 'ai_rank', dataType: 'number', required: false, config: {} },
    { id: 7, name: 'team_notes', dataType: 'longtext', required: false, config: {} },
    { id: 8, name: 'source_1', dataType: 'text', required: false, config: {} },
    { id: 9, name: 'subtitle', dataType: 'text', required: false, config: {} },
  ],
} as unknown as EntityTypeDef;

function topic(data: Record<string, unknown>): EntityRecord {
  return {
    id: 't1',
    entityType: 'topic',
    externalId: null,
    name: 'fallback name',
    data,
    createdAt: '',
  } as unknown as EntityRecord;
}

const FULL = topic({
  title: 'Qatar Market Entry Guide 2026',
  subtitle: 'What the new licence actually changes',
  angle: 'Lead with the $137 fee and what it replaces.',
  market: 'Qatar',
  content_type: 'lead_magnet',
  status: 'ready',
  ai_rank: 3,
  team_notes: 'angle too broad; needs a 2026 source',
  source_1: 'https://example.gov.qa/licence',
  scope_path: '/ogmc-agent-test',
});

function Providers({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}
const renderHeader = (ui: React.ReactElement) => render(ui, { wrapper: Providers });

beforeEach(() => {
  saveEntity.mockClear();
  getEntity.mockClear();
  // By default the record has not changed under the reviewer.
  getEntity.mockImplementation(async () => FULL);
});

describe('TopicContextHeader', () => {
  it('carries the topic context a reviewer needs while judging the draft', () => {
    renderHeader(<TopicContextHeader topic={FULL} type={TOPIC_TYPE} />);

    expect(screen.getByText('Qatar Market Entry Guide 2026')).toBeInTheDocument();
    expect(screen.getByText('What the new licence actually changes')).toBeInTheDocument();
    expect(screen.getByText(/Lead with the \$137 fee/)).toBeInTheDocument();
    expect(screen.getByText('Qatar')).toBeInTheDocument();
    // content_type reads as the team's own word, not as the stored enum value.
    expect(screen.getByText('Evergreen')).toBeInTheDocument();
    expect(screen.getByText('ready')).toBeInTheDocument();
  });

  it('shows the note that asked for the draft — the thing it was meant to satisfy', () => {
    renderHeader(<TopicContextHeader topic={FULL} type={TOPIC_TYPE} />);
    expect(screen.getByText('What the reviewer asked for')).toBeInTheDocument();
    expect(screen.getByText('angle too broad; needs a 2026 source')).toBeInTheDocument();
  });

  it('leaves out ai_rank and the topic sources, deliberately', () => {
    renderHeader(<TopicContextHeader topic={FULL} type={TOPIC_TYPE} />);
    // ai_rank ranks nothing once the topic is approved and a draft exists.
    expect(screen.queryByText('3')).toBeNull();
    // The draft page owns sources, with tier checks the topic's bare urls have
    // no part in. Two source lists on one page would disagree.
    expect(screen.queryByText(/example\.gov\.qa/)).toBeNull();
  });

  it('says plainly when a draft has no topic, rather than rendering an empty card', () => {
    renderHeader(<TopicContextHeader topic={null} type={TOPIC_TYPE} />);
    expect(screen.getByText(/not linked to a topic/i)).toBeInTheDocument();
  });

  it('renders every field it can from a sparse topic without inventing any', () => {
    renderHeader(<TopicContextHeader topic={topic({ title: 'Bare' })} type={TOPIC_TYPE} />);
    expect(screen.getByText('Bare')).toBeInTheDocument();
    expect(screen.queryByText('What the reviewer asked for')).toBeNull();
  });

  it('falls back to the record name when the title attribute is empty', () => {
    renderHeader(<TopicContextHeader topic={topic({ status: 'suggested' })} type={TOPIC_TYPE} />);
    expect(screen.getByText('fallback name')).toBeInTheDocument();
  });

  it('collapses on request, and has no collapse control when the page IS the topic', () => {
    const { rerender } = renderHeader(<TopicContextHeader topic={FULL} type={TOPIC_TYPE} />);
    expect(screen.getByRole('button', { name: /hide topic/i })).toBeInTheDocument();

    rerender(<TopicContextHeader topic={FULL} type={TOPIC_TYPE} alwaysOpen />);
    expect(screen.queryByRole('button', { name: /(hide|show) topic/i })).toBeNull();
    expect(screen.getByText(/Lead with the \$137 fee/)).toBeInTheDocument();
    // The story page IS the topic, so it keeps the edit affordance it has no
    // collapse for — editing and collapsing are different controls.
    expect(screen.getByRole('button', { name: /edit topic/i })).toBeInTheDocument();
  });

  it('still renders the back link and the heading before the schema has loaded', () => {
    renderHeader(
      <TopicContextHeader
        topic={FULL}
        type={null}
        backLink={<span data-testid="back-link">Back to topics</span>}
      />,
    );
    expect(screen.getByText('Qatar Market Entry Guide 2026')).toBeInTheDocument();
    expect(screen.getByTestId('back-link')).toBeInTheDocument();
  });
});

/**
 * The fix for bd startsim-m7fdm.7. Quinn: "for the draft detail view even if we
 * 'approve' the topic whatever we need to be able to edit the text and
 * description should we want to change it right now we cant."
 */
describe('TopicContextHeader editing', () => {
  function openEditor(record: EntityRecord = FULL, type: EntityTypeDef | null = TOPIC_TYPE) {
    renderHeader(<TopicContextHeader topic={record} type={type} />);
    fireEvent.click(screen.getByRole('button', { name: /edit topic/i }));
  }

  async function saveAfter(change: () => void, record: EntityRecord = FULL) {
    openEditor(record);
    change();
    fireEvent.click(screen.getByRole('button', { name: /save topic/i }));
    await waitFor(() => expect(saveEntity).toHaveBeenCalled());
    const [, id, input] = saveEntity.mock.calls[0] as unknown as [
      unknown,
      unknown,
      { data: Record<string, unknown> },
    ];
    return { id, data: input.data };
  }

  it('turns the topic’s text into a form, seeded from the record', () => {
    openEditor();
    expect(screen.getByDisplayValue('Qatar Market Entry Guide 2026')).toBeInTheDocument();
    expect(screen.getByDisplayValue('What the new licence actually changes')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Lead with the $137 fee and what it replaces.')).toBeInTheDocument();
    expect(screen.getByDisplayValue('angle too broad; needs a 2026 source')).toBeInTheDocument();
  });

  it('offers no editor at all before the schema has loaded', () => {
    renderHeader(<TopicContextHeader topic={FULL} type={null} />);
    expect(screen.queryByRole('button', { name: /edit topic/i })).toBeNull();
  });

  it('offers no editor when the draft has no topic', () => {
    renderHeader(<TopicContextHeader topic={null} type={TOPIC_TYPE} />);
    expect(screen.queryByRole('button', { name: /edit topic/i })).toBeNull();
  });

  it('steps the collapse control aside while a form is open — hiding it would strand the typing', () => {
    openEditor();
    expect(screen.queryByRole('button', { name: /(hide|show) topic/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.getByRole('button', { name: /hide topic/i })).toBeInTheDocument();
  });

  it('will not save a form nobody has changed', () => {
    openEditor();
    expect(screen.getByRole('button', { name: /save topic/i })).toBeDisabled();
  });

  it('cancels back to the read view without writing anything', () => {
    openEditor();
    fireEvent.change(screen.getByDisplayValue('Qatar Market Entry Guide 2026'), {
      target: { value: 'Discarded' },
    });
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(saveEntity).not.toHaveBeenCalled();
    expect(screen.getByText('Qatar Market Entry Guide 2026')).toBeInTheDocument();
  });

  it('saves the edited title against the topic’s own id', async () => {
    const { id, data } = await saveAfter(() =>
      fireEvent.change(screen.getByDisplayValue('Qatar Market Entry Guide 2026'), {
        target: { value: 'Qatar’s $137 licence, and who it locks out' },
      }),
    );
    expect(id).toBe('t1');
    expect(data.title).toBe('Qatar’s $137 licence, and who it locks out');
  });

  it('sends the WHOLE blob — scope_path and the sources ride along untouched', async () => {
    // The tenant REPLACES `data`, and `perform_update` never re-checks the scope
    // stamp, so a body that dropped scope_path would 200 and take the row out of
    // its scope. lib/__tests__/topic-edit.test.ts asserts this down to the wire;
    // here the point is that the PANEL sends the whole blob at all.
    const { data } = await saveAfter(() =>
      fireEvent.change(screen.getByDisplayValue('Qatar Market Entry Guide 2026'), {
        target: { value: 'A new title' },
      }),
    );
    expect(data).toMatchObject({
      scope_path: '/ogmc-agent-test',
      source_1: 'https://example.gov.qa/licence',
      market: 'Qatar',
      content_type: 'lead_magnet',
      status: 'ready',
      ai_rank: 3,
      subtitle: 'What the new licence actually changes',
      team_notes: 'angle too broad; needs a 2026 source',
    });
  });

  it('merges onto the record it RE-READ, not the one on screen (bd startsim-m7fdm.2)', async () => {
    // Somebody else moved the angle while this form was open, and the reviewer
    // did not touch the angle box. Merging onto the loaded blob — or writing
    // every form field rather than the ones she changed — would put their
    // sentence back to what it was.
    getEntity.mockImplementation(async () =>
      topic({ ...FULL.data, angle: 'Malin’s newer angle' }),
    );
    const { data } = await saveAfter(() =>
      fireEvent.change(screen.getByDisplayValue('Qatar Market Entry Guide 2026'), {
        target: { value: 'A new title' },
      }),
    );
    expect(getEntity).toHaveBeenCalledWith('t1');
    expect(data.angle).toBe('Malin’s newer angle');
    expect(data.title).toBe('A new title');
  });

  it('stamps the edit log so the draft page can say who touched the topic', async () => {
    const { data } = await saveAfter(() =>
      fireEvent.change(screen.getByDisplayValue('Qatar Market Entry Guide 2026'), {
        target: { value: 'A new title' },
      }),
    );
    expect(data.EditHistory).toMatchObject([{ by: 'jurga@ogmc.example', saves: 1 }]);
  });

  it('refuses an empty title instead of deleting the attribute', async () => {
    openEditor();
    fireEvent.change(screen.getByDisplayValue('Qatar Market Entry Guide 2026'), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save topic/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /save topic/i })).toBeEnabled());
    expect(saveEntity).not.toHaveBeenCalled();
  });

  it('returns to the read view showing what was saved', async () => {
    await saveAfter(() =>
      fireEvent.change(screen.getByDisplayValue('angle too broad; needs a 2026 source'), {
        target: { value: 'Lede is fine now; tighten the close.' },
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /save topic/i })).toBeNull(),
    );
    expect(screen.getByRole('button', { name: /edit topic/i })).toBeInTheDocument();
  });
});
