/**
 * Active project for v2 (epic startsim-bj3zz). Lane 1 (startsim-bj3zz children p1-p5)
 * owns the real implementation; lanes 2 and 3 import this interface now so they can
 * build against it. Until lane 1 lands it returns null, meaning "no project filter".
 */
export function getActiveProjectId(): string | null {
  return null;
}
