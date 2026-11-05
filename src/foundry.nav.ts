/**
 * Sidebar navigation as data (wireframe C01, bd startsim-bj3zz).
 *
 * The wireframe's rail is short and fixed: Dashboard, Content, Projects, then
 * Research with its four pages. Nothing else is listed; the content kinds, Drafts
 * and the generic data tables are still reachable by URL (/t/<type>, /content/*)
 * but they are not nav items, and the nav no longer depends on the declared schema.
 *
 * Icons are built with `React.createElement` (not JSX) so this stays a plain
 * `.ts` module and the pure `buildNav` logic is unit-testable without a DOM.
 */
import { createElement, type ReactNode } from 'react';
import { FileText, FolderKanban, LayoutDashboard, Search } from 'lucide-react';

import { CONTENT_TYPE_KEY } from '@/lib/content';
import type { EntityTypeDef } from '@/lib/foundry-api';

export interface NavLeaf {
  href: string;
  label: string;
  icon?: ReactNode;
  /** Extra path prefixes that also mean "you are here" (e.g. the draft editor sits under Content). */
  alsoActiveOn?: string[];
}

export interface NavParent extends Omit<NavLeaf, 'href'> {
  href: string;
  items: NavLeaf[];
}

export type NavEntry = NavLeaf | NavParent;

export function isNavParent(entry: NavEntry): entry is NavParent {
  return Array.isArray((entry as NavParent).items);
}

const DRAFT_TYPE_KEY = 'draft';

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

export function buildNav(): NavEntry[] {
  return [
    { href: '/', label: 'Dashboard', icon: createElement(LayoutDashboard) },
    {
      href: '/content',
      label: 'Content',
      icon: createElement(FileText),
      alsoActiveOn: ['/draft', '/drafts', '/story', '/t/draft'],
    },
    { href: '/projects', label: 'Projects', icon: createElement(FolderKanban) },
    {
      href: '/research',
      label: 'Research',
      icon: createElement(Search),
      items: [
        { href: '/research', label: 'Overview' },
        { href: '/research/topics', label: 'Topics' },
        { href: '/research/sources', label: 'Sources' },
        { href: '/research/settings', label: 'Settings' },
      ],
    },
  ];
}
