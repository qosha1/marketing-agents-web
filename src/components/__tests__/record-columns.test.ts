import { describe, it, expect } from 'vitest';
import { buildRecordColumns } from '../record-columns';
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
});
