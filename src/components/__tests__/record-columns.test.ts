import { describe, it, expect } from 'vitest';
import { buildRecordColumns, defaultVisibleColumns } from '../record-columns';
import type { AttributeDef, EntityRecord } from '@/lib/foundry-api';

const attrs: AttributeDef[] = [
  { id: '1', name: 'country_code', dataType: 'text', required: false, config: {} },
  { id: '2', name: 'sc_score', dataType: 'integer', required: false, config: {} },
  { id: '3', name: 'uuid', dataType: 'text', required: false, config: {} },
  { id: '4', name: 'judge_verdict', dataType: 'json', required: false, config: {} },
];

function cellFor(cols: ReturnType<typeof buildRecordColumns>, id: string, row: EntityRecord) {
  const col = cols.find((c) => c.id === id);
  if (!col?.cell) throw new Error(`no cell for ${id}`);
  return col.cell(row);
}

describe('buildRecordColumns', () => {
  it('reads multi-word attrs from the camelCased data blob (startsim-e8zu.3)', () => {
    const cols = buildRecordColumns(attrs);
    // the @startsimpli/api client camelCases response keys incl. the data blob
    const row = {
      id: 1, entityType: 'sc_artist', externalId: null, name: 'Billie',
      data: { countryCode: 'US', scScore: 91309, uuid: 'abc' }, createdAt: '2026-06-01',
    } as EntityRecord;
    expect(cellFor(cols, 'country_code', row)).toBe('US');
    expect(cellFor(cols, 'sc_score', row)).toBe('91309');
    expect(cellFor(cols, 'uuid', row)).toBe('abc');
  });

  it('falls back to the raw snake_case key + renders an em dash for missing values', () => {
    const cols = buildRecordColumns(attrs);
    const raw = { data: { country_code: 'MX' } } as unknown as EntityRecord;
    expect(cellFor(cols, 'country_code', raw)).toBe('MX');
    const empty = { data: {} } as unknown as EntityRecord;
    expect(cellFor(cols, 'country_code', empty)).toBe('—');
  });

  it('renders an object cell compactly (surfaces `verdict`, never the whole blob)', () => {
    const cols = buildRecordColumns(attrs);
    const row = {
      data: {
        judgeVerdict: {
          verdict: 'accept',
          summary: 'x'.repeat(500),
          issues: [{ problem: 'y'.repeat(500) }],
        },
      },
    } as unknown as EntityRecord;
    // The Content-Judge object surfaces as its verdict, not a 1000-char JSON dump.
    expect(cellFor(cols, 'judge_verdict', row)).toBe('accept');
  });

  it('clamps a verdict-less object blob so it cannot explode the row', () => {
    const cols = buildRecordColumns(attrs);
    const row = { data: { judgeVerdict: { notes: 'z'.repeat(500) } } } as unknown as EntityRecord;
    const cell = cellFor(cols, 'judge_verdict', row) as string;
    expect(cell.length).toBeLessThanOrEqual(91); // 90 + the ellipsis
    expect(cell.endsWith('…')).toBe(true);
  });

  it('clamps a long PLAIN-text cell to a one-line preview (no 500-word body in a table cell)', () => {
    const cols = buildRecordColumns([
      { id: '9', name: 'blog', dataType: 'longtext', required: false, config: {} },
    ]);
    const row = { data: { blog: 'The quick brown fox. '.repeat(80) } } as unknown as EntityRecord;
    const cell = cellFor(cols, 'blog', row) as string;
    expect(cell.length).toBeLessThanOrEqual(91);
    expect(cell.endsWith('…')).toBe(true);
    expect(cell).not.toContain('\n');
  });
});

/**
 * The live marketing-agents schemas, in the order the tenant API returns them
 * (read off the tenant DB 2026-09-07 — `AttributeDef.Meta.ordering` is empty, so
 * this natural order is what the app receives). The ORDER is load-bearing: it
 * decides which attributes the default-visible cap lets through, so a made-up
 * order would test nothing.
 */
function defs(names: string[]): AttributeDef[] {
  return names.map((name, i) => ({
    id: String(i + 1), name, dataType: 'text', required: false, config: {},
  }));
}

const TOPIC_ATTRS = defs([
  'title', 'angle', 'market', 'content_type', 'status', 'ai_rank', 'team_verdict',
  'team_notes', 'source_1', 'source_2', 'source_3', 'delivered_at', 'scheduled_for',
  'subtitle', 'assignee_sub', 'assignee_name', 'scope_path',
]);
const DRAFT_ATTRS = defs([
  'content_type', 'candidate_index', 'blog', 'linkedin', 'seo', 'sources',
  'judge_verdict', 'auto_checks', 'chosen', 'sent_at', 'assignee_sub',
  'assignee_name', 'lang', 'status', 'scope_path',
]);
/** What the content (topic) table passes as both `hide` and the folded-in set. */
const CONTENT_HIDE = ['title', 'subtitle', 'angle'];

describe('Created sits next to Title (startsim-b008b)', () => {
  it('renders Created as the SECOND column, immediately after the title column', () => {
    const ids = buildRecordColumns(attrs).map((c) => c.id);
    expect(ids.slice(0, 2)).toEqual(['name', 'createdAt']);
  });

  it('keeps Created second on the content spine, ahead of every attribute', () => {
    const cols = buildRecordColumns(TOPIC_ATTRS, {
      subtitleAttrs: ['subtitle', 'angle'],
      hide: CONTENT_HIDE,
      actionsCell: () => null,
    });
    const ids = cols.map((c) => c.id);
    expect(ids.slice(0, 2)).toEqual(['name', 'createdAt']);
    // The inline decision cluster stays last — Created moving up must not
    // displace the actions column.
    expect(ids[ids.length - 1]).toBe('__actions');
  });

  it('lists Created right after the title in the default-visible set too', () => {
    const visible = defaultVisibleColumns(TOPIC_ATTRS, {
      hide: CONTENT_HIDE,
      withActions: true,
    });
    expect(visible.slice(0, 2)).toEqual(['name', 'createdAt']);
  });
});

describe('columns with no added value are never default-visible (startsim-b008b)', () => {
  it('leaves AI rank, Scope path and Team verdict out of the topic default', () => {
    const visible = defaultVisibleColumns(TOPIC_ATTRS, {
      hide: CONTENT_HIDE,
      withActions: true,
    });
    for (const name of ['ai_rank', 'scope_path', 'team_verdict']) {
      expect(visible).not.toContain(name);
    }
    // …while the columns that DO carry the review are still there.
    expect(visible).toEqual(
      expect.arrayContaining(['name', 'createdAt', 'content_type', 'status', 'market', 'assignee_name']),
    );
  });

  it('leaves Scope path out of the draft default without touching the Judge column', () => {
    const visible = defaultVisibleColumns(DRAFT_ATTRS);
    expect(visible).not.toContain('scope_path');
    // judge_verdict renders as "Judge" — a DIFFERENT column, and one the
    // reviewer did not ask to lose.
    expect(visible).toContain('judge_verdict');
  });

  it('still OFFERS them in the Columns menu — the default goes away, not the column', () => {
    const ids = buildRecordColumns(TOPIC_ATTRS, {
      subtitleAttrs: ['subtitle', 'angle'],
      hide: CONTENT_HIDE,
    }).map((c) => c.id);
    for (const name of ['ai_rank', 'scope_path', 'team_verdict']) {
      expect(ids).toContain(name);
    }
  });

  it('does not backfill the freed slots with a notes blob or a raw source URL', () => {
    const visible = defaultVisibleColumns(TOPIC_ATTRS, {
      hide: CONTENT_HIDE,
      withActions: true,
    });
    // Dropping three columns must make the row NARROWER. Filtering before the
    // cap would promote team_notes (longtext) and source_1 into the row and
    // re-widen the table the reviewer already can't scroll.
    expect(visible).not.toContain('team_notes');
    expect(visible).not.toContain('source_1');
  });
});
