/**
 * Per-foundry config. The Foundry orchestrator substitutes the __FOUNDRY_*__
 * markers when it forks this template into your repo — after that it's YOUR app,
 * edit it however you like.
 *
 * The heavy lifting (auth wall, UI kit, tenant API client) comes from the
 * @startsimpli/* packages, so this app works the moment it's forked.
 */
export const FOUNDRY = {
  /** App slug (== the tenant slug); also the ?app= tag for central auth. */
  slug: 'marketing-agents',
  /** Human name shown in the app chrome / <title>. */
  name: 'Marketing Agents',
  /** Short tagline for the app home. */
  tagline: 'AI marketing content engine',
} as const;
