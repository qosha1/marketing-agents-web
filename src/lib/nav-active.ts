/**
 * Which sidebar item is "here".
 *
 * GroupedNav's default matcher compares pathnames, which is right until two nav
 * items SHARE a pathname and differ only by query — which is exactly what the
 * content types are: `/t/topic` (all kinds) sits alongside
 * `/t/topic?content_type=lead_magnet` and its siblings.
 *
 * TWO RULES, and the second is the one that was missing:
 *
 *  1. An href WITH a query matches when the pathname is the same AND every
 *     param the href names is present with that value. Extra params (paging,
 *     sort) do not unmatch it, so only the one matching kind lights up.
 *
 *  2. An href WITHOUT a query matches on pathname (exact, or a child route) —
 *     BUT NOT while a FACET param is applied. A facet is a param that has its
 *     own nav destination, so the unfiltered view must yield to it. Without
 *     this, "Topics" stayed lit on every category page and two items were
 *     highlighted at once.
 *
 * Paging and sorting are deliberately NOT facets: they are state, not a place,
 * and blanking the sidebar while someone pages through a table would be worse
 * than the bug this fixes.
 */
import { CONTENT_TYPE_ATTR } from '@/lib/content';

/**
 * Params that own a nav item of their own. Derived from the taxonomy contract
 * rather than spelled here, so this cannot drift from what the sidebar builds.
 */
const FACET_PARAMS: readonly string[] = [CONTENT_TYPE_ATTR];

export function navIsActive(href: string, activeHref?: string): boolean {
  if (!activeHref) return false;

  const [curPath, curQuery = ''] = activeHref.split('?');
  const [hrefPath, hrefQuery] = href.split('?');
  const current = new URLSearchParams(curQuery);

  if (hrefQuery !== undefined) {
    if (curPath !== hrefPath) return false;
    for (const [key, value] of new URLSearchParams(hrefQuery)) {
      if (current.get(key) !== value) return false;
    }
    return true;
  }

  // A facet is applied — the item that names it owns the highlight, not this one.
  if (FACET_PARAMS.some((param) => current.get(param))) return false;

  if (hrefPath === '/') return curPath === '/';
  return curPath === hrefPath || curPath.startsWith(`${hrefPath}/`);
}
