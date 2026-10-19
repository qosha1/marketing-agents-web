/**
 * The data pages (Scope, Source, Client, News item) read like a normal app:
 * reference data opens as a table, a choice reads the same everywhere, a
 * table opens with one Name and no paragraph columns, and the count line says
 * the same thing on the board and the table (bd startsim-cxtgr review,
 * SCOPE-004/008/016/017, SRC-003/007/011, CLI-002/004, NEWS-006/009/010/011).
 */
import { describe, expect, it } from 'vitest';

import { boardColumns, humanizeChoice, isBoardType, recordCountLabel, typeRoute } from '../board';
import { isInactive } from '../board-card';
import { NEWS_REVIEW_CONFIG } from '../review-vocabulary';
import { buildRecordColumns, defaultVisibleColumns } from '@/components/record-columns';
import type { AttributeDef, EntityRecord, EntityTypeDef } from '../foundry-api';

const a = (name: string, dataType: string, choices?: string[]): AttributeDef =>
  ({ id: name, name, dataType, required: false, config: choices ? { choices } : {} }) as AttributeDef;

const SCOPE_ATTRS = [
  a('name', 'text'),
  a('kind', 'enum', ['client', 'project']),
  a('path', 'text'),
  a('parent', 'text'),
  a('active', 'boolean'),
  a('brand_voice', 'longtext'),
  a('priority_framework', 'longtext'),
  a('guardrails', 'longtext'),
  a('services', 'longtext'),
];
const CLIENT_ATTRS = [
  a('name', 'text'),
  a('brand_voice', 'longtext'),
  a('priority_framework', 'longtext'),
  a('services', 'longtext'),
  a('guardrails', 'longtext'),
  a('active', 'boolean'),
];
const type = (key: string, attributes: AttributeDef[]) =>
  ({ id: key, key, label: key, config: {}, attributes }) as unknown as EntityTypeDef;

describe('which types open as a board', () => {
  it('opens a type with a status enum on its board', () => {
    const news = type('news_item', [a('status', 'enum', ['new', 'preview_only'])]);
    expect(isBoardType(news)).toBe(true);
    expect(typeRoute(news)).toBe('/board/news_item');
  });

  it('opens a type whose only enum is a category on its table', () => {
    expect(isBoardType(type('scope', SCOPE_ATTRS))).toBe(false);
    expect(typeRoute(type('scope', SCOPE_ATTRS))).toBe('/t/scope');
    const source = type('source', [a('domain', 'text'), a('source_type', 'enum', ['state_wire'])]);
    expect(typeRoute(source)).toBe('/t/source');
  });
});

describe('choice labels', () => {
  it('drops underscores and capitalises', () => {
    expect(humanizeChoice('preview_only')).toBe('Preview only');
    expect(humanizeChoice('state_wire')).toBe('State wire');
    expect(humanizeChoice('client')).toBe('Client');
  });

  it('labels board lanes that way, keeping the raw id', () => {
    const cols = boardColumns(a('status', 'enum', ['preview_only']));
    expect(cols[0]).toMatchObject({ id: 'preview_only', label: 'Preview only' });
  });

  it('prints a choice in a table cell the same way', () => {
    const kind = buildRecordColumns(SCOPE_ATTRS).find((c) => c.id === 'kind')!;
    const row = { id: 1, name: 'OGMC', data: { kind: 'client' } } as unknown as EntityRecord;
    expect(kind.cell!(row)).toBe('Client');
  });
});

describe('default columns on the data tables', () => {
  it('opens Scope with one Name, no paragraph fields, and Active', () => {
    expect(defaultVisibleColumns(SCOPE_ATTRS)).toEqual(['name', 'createdAt', 'kind', 'path', 'parent', 'active']);
  });

  it('opens Client with one Name and Active', () => {
    expect(defaultVisibleColumns(CLIENT_ATTRS)).toEqual(['name', 'createdAt', 'active']);
  });
});

describe('inactive records on the board', () => {
  const scopeType = type('scope', SCOPE_ATTRS);
  it('is inactive only when active is false', () => {
    expect(isInactive(scopeType, { data: { active: false } } as unknown as EntityRecord)).toBe(true);
    expect(isInactive(scopeType, { data: { active: true } } as unknown as EntityRecord)).toBe(false);
    expect(isInactive(scopeType, { data: {} } as unknown as EntityRecord)).toBe(false);
  });
});

describe('the count line', () => {
  it('says records on both views, singular for one', () => {
    expect(recordCountLabel(12)).toBe('12 records');
    expect(recordCountLabel(1)).toBe('1 record');
    expect(recordCountLabel(40, { matching: 1135 })).toBe('40 of 1,135 records');
  });

  it('names the window that narrowed it', () => {
    expect(recordCountLabel(0, { matching: 0, windowDays: 14 })).toBe('0 records in the last 14 days');
    expect(recordCountLabel(5, { windowDays: null })).toBe('5 records');
  });
});

describe('news curation wording', () => {
  it('says Accept, not Approve', () => {
    expect(NEWS_REVIEW_CONFIG.decisionLabels).toMatchObject({ approve: 'Accept article', reject: 'Reject article' });
  });
});
