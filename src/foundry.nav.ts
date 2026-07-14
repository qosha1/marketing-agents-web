/**
 * Sidebar navigation as data (bd 768w.16.8.4).
 *
 * `buildNav` turns the tenant's declared schema into the shared @startsimpli/ui
 * <GroupedNav/> item tree. One contract, three consumers stay in sync: this nav,
 * the content tabs, and the dashboard all read the SAME taxonomy from
 * `@/lib/content` + `@/lib/board`. Change the shape here, not in the component.
 *
 * The tree:
 *   - Dashboard (/)               — the review/system-health home
 *   - Content group               — the two content data tables:
 *       · Topics (/t/topic)       — every idea (all kinds), click → review/edit
 *       · Drafts (/t/draft)       — every written body, click → the draft editor
 *   - Data group                  — every OTHER declared type (board or table)
 *   - About (/about)
 *
 * Content is table-first now: flat, filterable, clickable data lists rather than
 * three per-kind kanban boards (Kind is a filter inside the Topics table; the
 * board is still one click away via each table's Board-view toggle). The
 * candidate-compare workspace still lives at /drafts (reachable by URL) but is no
 * longer a primary nav item.
 *
 * Icons are built with `React.createElement` (not JSX) so this stays a plain
 * `.ts` module and the pure `buildNav` logic is unit-testable without a DOM.
 */
import { createElement } from 'react';
import { LayoutDashboard, FileText, Lightbulb, LayoutGrid, Table } from 'lucide-react';
import type { GroupedNavEntry } from '@startsimpli/ui';

import { CONTENT_TYPE_KEY } from '@/lib/content';
import { isBoardType, typeRoute } from '@/lib/board';
import type { EntityTypeDef } from '@/lib/foundry-api';

/**
 * Types the nav does NOT surface as a generic Data link because the Content group
 * already covers them: `topic` (CONTENT_TYPE_KEY) as the Topics table and `draft`
 * as the Drafts table.
 */
const DRAFT_TYPE_KEY = 'draft';

/**
 * Build the <GroupedNav/> `items` tree from the declared entity types.
 * `types` is the EntityTypeDef[] from the `schema-types` query (may be empty
 * before the schema loads — the Content group and static links still render).
 */
export function buildNav(types: EntityTypeDef[]): GroupedNavEntry[] {
  const dataTypes = types.filter(
    (t) => t.key !== CONTENT_TYPE_KEY && t.key !== DRAFT_TYPE_KEY,
  );

  const items: GroupedNavEntry[] = [
    { href: '/', label: 'Dashboard', icon: createElement(LayoutDashboard) },
    {
      label: 'Content',
      items: [
        { href: `/t/${CONTENT_TYPE_KEY}`, label: 'Topics', icon: createElement(Lightbulb) },
        { href: `/t/${DRAFT_TYPE_KEY}`, label: 'Drafts', icon: createElement(FileText) },
      ],
    },
  ];

  if (dataTypes.length > 0) {
    items.push({
      label: 'Data',
      items: dataTypes.map((t) => ({
        href: typeRoute(t),
        label: t.label,
        icon: createElement(isBoardType(t) ? LayoutGrid : Table),
      })),
    });
  }

  items.push({ href: '/about', label: 'About' });

  return items;
}
