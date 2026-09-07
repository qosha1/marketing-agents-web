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

  it('opens the topic table on exactly these seven columns', () => {
    // Pinned, not descriptive: this is the set that was rendered against the
    // deployed table to measure the row width (2026-09-07 — 1288px -> 1134px,
    // i.e. no horizontal overflow at 1440 or 1366). If the set changes, the
    // measurement behind bd startsim-5pq7h stops being about this table.
    expect(defaultVisibleColumns(TOPIC_ATTRS, { hide: CONTENT_HIDE, withActions: true })).toEqual([
      'name', 'createdAt', 'content_type', 'status', 'market', 'assignee_name', '__actions',
    ]);
  });

  it('keeps Judge in the draft type\'s review columns (before the view\'s sparse list)', () => {
    expect(defaultVisibleColumns(DRAFT_ATTRS)).toEqual([
      'name', 'createdAt', 'content_type', 'status', 'judge_verdict',
      'candidate_index', 'sent_at', 'assignee_name',
    ]);
  });

  // `afterCreated` is how the Drafts table gets its "Created by" column beside
  // Created (bd startsim-4gw21). It sits OUTSIDE the attribute cap on purpose:
  // a computed column must not evict a declared attribute the reviewer reads.
  it('places an afterCreated column beside Created without spending a cap slot', () => {
    expect(defaultVisibleColumns(DRAFT_ATTRS, { afterCreated: ['__origin'] })).toEqual([
      'name', 'createdAt', '__origin', 'content_type', 'status', 'judge_verdict',
      'candidate_index', 'sent_at', 'assignee_name',
    ]);
  });
});

/**
 * News Item, in the order the tenant API returns it (read off
 * `GET /api/v1/schema/types` on the live tenant 2026-09-07, same as the two
 * fixtures above — both of which were re-verified against that response and
 * match it exactly, 17 and 15 attributes in the same order).
 */
const NEWS_ATTRS = defs([
  'url', 'title', 'snippet', 'domain', 'source_name', 'tier', 'approved',
  'adapter', 'query', 'market', 'lang', 'published_at', 'first_seen',
  'last_seen', 'times_seen', 'used_in', 'notes', 'content', 'status',
]);

describe('the News Item table opens narrow (startsim-8hgmq.1)', () => {
  it('opens on exactly these six columns', () => {
    // It used to open on name, createdAt, url, title, snippet, domain, market,
    // status, __actions — measured 1134 clientWidth vs 1628 scrollWidth at a
    // 1440 viewport, 494px of overflow and the worst of the three content
    // views. Three of its six attribute columns were long text and one was a
    // duplicate, purely because the type's attribute order is DB-natural.
    expect(defaultVisibleColumns(NEWS_ATTRS, { withActions: true })).toEqual([
      'name', 'createdAt', 'status', 'market', 'domain', '__actions',
    ]);
  });

  it('renders that as the header row Name | Created | Domain | Market | State | Curation', () => {
    // defaultVisibleColumns answers WHICH columns open (preferred ones first);
    // the header the reviewer actually reads is buildRecordColumns' order,
    // which follows the type's attribute order. Pin the row itself, because
    // the row is what was measured.
    const visible = new Set(defaultVisibleColumns(NEWS_ATTRS, { withActions: true }));
    const headerRow = buildRecordColumns(NEWS_ATTRS, {
      actionsHeader: 'Curation',
      actionsCell: () => null,
    })
      .filter((c) => visible.has(c.id))
      .map((c) => c.header);
    expect(headerRow).toEqual(['Name', 'Created', 'Domain', 'Market', 'State', 'Curation']);
  });

  it('drops the three wide columns without backfilling three empty ones', () => {
    const visible = defaultVisibleColumns(NEWS_ATTRS, { withActions: true });
    // The wide ones go…
    for (const name of ['url', 'title', 'snippet']) {
      expect(visible).not.toContain(name);
    }
    // …and the cap must NOT hand their slots to whatever comes next in the
    // type's attribute order. On the live tenant (150 rows sampled 2026-09-07)
    // those next three carry no information at all:
    //   source_name → identical to domain in 150/150 rows
    //   tier        → null in 150/150 rows, so the cell renders "—"
    //   approved    → true in 150/150 rows, so the cell renders "Yes"
    // Swapping three long columns for three worthless ones leaves the table
    // just as unreadable and still wider than the screen.
    for (const name of ['source_name', 'tier', 'approved']) {
      expect(visible).not.toContain(name);
    }
  });

  it('still OFFERS Url, Title and Snippet in the Columns menu', () => {
    // The default goes away, not the column — a reader who wants the link or
    // the snippet is one toggle away, exactly like blog/linkedin on drafts.
    const ids = buildRecordColumns(NEWS_ATTRS).map((c) => c.id);
    for (const name of ['url', 'title', 'snippet']) {
      expect(ids).toContain(name);
    }
  });
});

/** What /t/draft passes as its measured-empty set — see DRAFT_SPARSE_ATTRS. */
const DRAFT_SPARSE = ['sent_at', 'assignee_name'];

describe('the Drafts table drops columns nothing has filled in (startsim-8hgmq.10)', () => {
  it('opens on exactly these seven columns', () => {
    // It opened on nine and overflowed at EVERY viewport, 1440 included
    // (1134 clientWidth vs 1211 scrollWidth = 77px), once "Created by" made it
    // a nine-column table.
    expect(defaultVisibleColumns(DRAFT_ATTRS, {
      afterCreated: ['__origin'],
      sparse: DRAFT_SPARSE,
    })).toEqual([
      'name', 'createdAt', '__origin', 'content_type', 'status',
      'judge_verdict', 'candidate_index',
    ]);
  });

  it('renders that as the header row Name | Created | Kind | # | Judge | State | Created by', () => {
    const visible = new Set(defaultVisibleColumns(DRAFT_ATTRS, {
      afterCreated: ['__origin'],
      sparse: DRAFT_SPARSE,
    }));
    const headerRow = buildRecordColumns(DRAFT_ATTRS)
      .filter((c) => visible.has(c.id))
      .map((c) => c.header);
    // __origin is appended by the page, not by buildRecordColumns, so it is not
    // in this row — the six declared ones are.
    expect(headerRow).toEqual(['Name', 'Created', 'Kind', '#', 'Judge', 'State']);
  });

  it('drops Sent at and Assignee without backfilling', () => {
    const visible = defaultVisibleColumns(DRAFT_ATTRS, {
      afterCreated: ['__origin'],
      sparse: DRAFT_SPARSE,
    });
    // Counted across all 153 live drafts, 2026-09-07:
    //   sent_at        filled in   1/153
    //   assignee_name  filled in   1/153
    // …against content_type 153/153, status 153/153, judge_verdict 150/153 and
    // candidate_index 150/153. Two of the nine default columns rendered an em
    // dash in 152 of 153 rows.
    //
    // These are LIFECYCLE fields, not junk: sent_at fills as drafts get sent and
    // assignee_name as they get assigned. The claim is only that neither is
    // worth a DEFAULT column while 152 of 153 rows are blank — both stay one
    // toggle away in the Columns menu, and a team that starts assigning drafts
    // switches Assignee back on.
    for (const name of ['sent_at', 'assignee_name']) {
      expect(visible).not.toContain(name);
    }
    // The freed slots must not be handed to the next attributes in declaration
    // order — chosen (a boolean) and lang (69/153) are what sits there.
    for (const name of ['chosen', 'lang', 'assignee_sub']) {
      expect(visible).not.toContain(name);
    }
  });

  it('still OFFERS Sent at and Assignee in the Columns menu', () => {
    const ids = buildRecordColumns(DRAFT_ATTRS).map((c) => c.id);
    for (const name of ['sent_at', 'assignee_name']) {
      expect(ids).toContain(name);
    }
  });

  it('is per-view: the topic table KEEPS its Assignee column', () => {
    // assignee_name is just as empty on topic (2 of 84 live records), but the
    // reviewers asked for that column and startsim-71z6 built its initials chip
    // for it. `sparse` is passed by the view that measured itself, so dropping
    // it from drafts must not reach across to the content spine.
    const topic = defaultVisibleColumns(TOPIC_ATTRS, {
      hide: CONTENT_HIDE,
      withActions: true,
    });
    expect(topic).toContain('assignee_name');
  });
});
