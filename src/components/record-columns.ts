import type { ColumnConfig } from '@startsimpli/ui';
import type { AttributeDef, EntityRecord } from '@/lib/foundry-api';

/**
 * Build UnifiedTable columns from a type's declared attributes. Each attribute
 * becomes a column reading out of the record's `data` blob; a leading Name
 * column and a trailing Created column frame them.
 */
export function buildRecordColumns(
  attributes: AttributeDef[],
): ColumnConfig<EntityRecord>[] {
  const attrColumns: ColumnConfig<EntityRecord>[] = attributes.map((attr) => ({
    id: attr.name,
    header: attr.name,
    cell: (row) => formatCell(readAttrValue(row.data, attr.name), attr),
  }));

  return [
    {
      id: 'name',
      header: 'Name',
      accessorKey: 'name',
      sortable: true,
    },
    ...attrColumns,
    {
      id: 'createdAt',
      header: 'Created',
      cell: (row) =>
        row.createdAt ? new Date(row.createdAt).toLocaleDateString() : '—',
    },
  ];
}

/**
 * Read a declared attribute's value out of the record's `data` blob.
 *
 * The shared @startsimpli/api client camelCases ALL response keys, INCLUDING the
 * Entity `data` blob (see foundry-api.ts wire-format note). So a snake_case
 * attribute like `country_code` lands in `data` as `countryCode`, while
 * `attr.name` stays snake_case — a direct `data[attr.name]` lookup misses every
 * multi-word attribute (only single-word names like `uuid`/`slug` matched). Read
 * the camelCased key first, falling back to the raw name for odd/digit keys the
 * transform leaves alone (startsim-e8zu.3).
 */
function readAttrValue(
  data: EntityRecord['data'] | undefined,
  name: string,
): unknown {
  if (!data) return undefined;
  const camel = name.replace(/_+([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
  return data[camel] ?? data[name];
}

function formatCell(value: unknown, attr: AttributeDef): string {
  if (value == null || value === '') return '—';
  if (attr.dataType === 'boolean') return value ? 'Yes' : 'No';
  if (attr.dataType === 'json') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  if (attr.dataType === 'date') {
    const d = new Date(String(value));
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString();
  }
  return String(value);
}
