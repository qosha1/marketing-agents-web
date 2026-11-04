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
 *   - Research group             — Overview, Topics, Sources, Settings (/research/*).
 *       The topic list, the pulled-in documents (news_item) and the source
 *       configuration (source) live here, so Data does not list them again.
 *       There is no Activity item; /activity still exists by URL.
 *   - Content group               — the content data tables:
 *       · one item PER content_type — the same table pre-filtered to that kind,
 *         derived from the DECLARED enum so a new kind needs no code change
 *       · Drafts (/t/draft)       — every written body, click → the draft editor
 *   - Data group                  — every OTHER declared type (board or table)
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
import {
  BarChart3,
  Building2,
  CalendarDays,
  FileText,
  FolderTree,
  Layers,
  LayoutDashboard,
  LayoutGrid,
  Leaf,
  Lightbulb,
  Newspaper,
  Search,
  Settings,
  ShieldCheck,
  Shapes,
  Table,
  type LucideIcon,
} from 'lucide-react';
import type { GroupedNavEntry } from '@startsimpli/ui';

import { CONTENT_TYPE_KEY, contentTabHref, declaredContentTypes } from '@/lib/content';
import { isBoardType, typeRoute } from '@/lib/board';
import type { EntityTypeDef } from '@/lib/foundry-api';

/**
 * Types the nav does NOT surface as a generic Data link because the Content group
 * already covers them: `topic` (CONTENT_TYPE_KEY) as the Topics table and `draft`
 * as the Drafts table.
 */
const DRAFT_TYPE_KEY = 'draft';

/**
 * Types the Research group already covers: documents (`news_item`) are Research
 * > Sources and `source` is Research > Settings, so Data must not repeat them.
 */
const RESEARCH_TYPE_KEYS = ['news_item', 'source'];

/** The sidebar's own words for the two content tables. */
const CONTENT_NAV_LABELS: Record<string, string> = {
  [CONTENT_TYPE_KEY]: 'Topics',
  [DRAFT_TYPE_KEY]: 'Drafts',
};

/**
 * What a records table is titled: the label of the nav item it highlights
 * (bd startsim-g7x59, startsim-x32vw). Topics and Drafts are named in the
 * plural in the sidebar while the schema's type label is singular; every other
 * type's nav item IS its type label, so it falls through unchanged.
 */
export function listTitle(type: Pick<EntityTypeDef, 'key' | 'label'>): string {
  return CONTENT_NAV_LABELS[type.key] ?? type.label;
}

/**
 * Neighbours in the sidebar get different icons (bd startsim-xs1a0). Keyed by
 * declared key; anything not listed keeps the generic icon for its group.
 */
const KIND_ICONS: Record<string, LucideIcon> = {
  weekly_brief: CalendarDays,
  lead_magnet: Leaf,
  general: Shapes,
};
const TYPE_ICONS: Record<string, LucideIcon> = {
  client: Building2,
  news_item: Newspaper,
  scope: FolderTree,
  source: ShieldCheck,
};

/**
 * Build the <GroupedNav/> `items` tree from the declared entity types.
 * `types` is the EntityTypeDef[] from the `schema-types` query (may be empty
 * before the schema loads — the Content group and static links still render).
 */
export function buildNav(types: EntityTypeDef[]): GroupedNavEntry[] {
  const dataTypes = types.filter(
    (t) => t.key !== CONTENT_TYPE_KEY && t.key !== DRAFT_TYPE_KEY && !RESEARCH_TYPE_KEYS.includes(t.key),
  );

  const items: GroupedNavEntry[] = [
    { href: '/', label: 'Dashboard', icon: createElement(LayoutDashboard) },
    {
      label: 'Research',
      icon: createElement(Search),
      items: [
        { href: '/research', label: 'Overview', icon: createElement(BarChart3) },
        { href: '/research/topics', label: 'Topics', icon: createElement(Lightbulb) },
        { href: '/research/sources', label: 'Sources', icon: createElement(Newspaper) },
        { href: '/research/settings', label: 'Settings', icon: createElement(Settings) },
      ],
    },
    {
      label: 'Content',
      items: [
        // One destination PER KIND, then the written bodies. The kinds used to
        // be reachable only as a "Kind:" filter chip inside the Topics table; a
        // weekly brief and a lead magnet are different jobs, so they get their
        // own places to stand. (The all-kinds topic list is Research > Topics.)
        ...declaredContentTypes(types.find((t) => t.key === CONTENT_TYPE_KEY)).map((c) => ({
          href: contentTabHref(c.key),
          label: c.label,
          icon: createElement(KIND_ICONS[c.key] ?? Layers),
        })),
        { href: `/t/${DRAFT_TYPE_KEY}`, label: CONTENT_NAV_LABELS[DRAFT_TYPE_KEY], icon: createElement(FileText) },
      ],
    },
  ];

  if (dataTypes.length > 0) {
    items.push({
      label: 'Data',
      items: dataTypes.map((t) => ({
        href: typeRoute(t),
        label: t.label,
        icon: createElement(TYPE_ICONS[t.key] ?? (isBoardType(t) ? LayoutGrid : Table)),
      })),
    });
  }

  return items;
}
