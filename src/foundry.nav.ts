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
 *   - Drafts (/drafts)            — the bespoke candidate-compare review
 *   - Content group               — the 3 content_type categories of `topic`
 *   - Data group                  — every OTHER declared type (board or table)
 *   - About (/about)
 *
 * Icons are built with `React.createElement` (not JSX) so this stays a plain
 * `.ts` module and the pure `buildNav` logic is unit-testable without a DOM.
 */
import { createElement } from 'react';
import { LayoutDashboard, FileText, LayoutGrid, Table } from 'lucide-react';
import type { GroupedNavEntry } from '@startsimpli/ui';

import { CONTENT_CATEGORIES, CONTENT_TYPE_KEY, contentTabHref } from '@/lib/content';
import { isBoardType, typeRoute } from '@/lib/board';
import type { EntityTypeDef } from '@/lib/foundry-api';

/**
 * Types the nav does NOT surface as a generic Data link because a bespoke
 * destination already covers them:
 *   - `topic` (CONTENT_TYPE_KEY) — the Content group's 3 content_type tabs.
 *   - `draft`                    — the top-level Drafts item (candidate compare).
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
    { href: '/drafts', label: 'Drafts', icon: createElement(FileText) },
    {
      label: 'Content',
      items: CONTENT_CATEGORIES.map((c) => ({
        href: contentTabHref(c.key),
        label: c.label,
      })),
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
