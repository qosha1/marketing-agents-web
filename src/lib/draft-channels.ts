/**
 * The draft page's content channels (the tabs of the content pane).
 *
 * Fork-local: the channel ids are THIS app's content-pane layout. They seed and
 * validate `?channel=` so a shared link opens the right tab.
 *
 * This used to be lib/issue-jump.ts, which also turned failing checks into j/k
 * jump stops. That jump went with the Checks section (bd startsim-m7fdm.25);
 * only the channel ids are left.
 */

/** The content pane's channel tabs — the ids ContentChannels is built with. */
export type ChannelId = 'brief' | 'linkedin' | 'seo' | 'sources';

export const CHANNEL_IDS: readonly ChannelId[] = ['brief', 'linkedin', 'seo', 'sources'];

export function isChannelId(value: unknown): value is ChannelId {
  return typeof value === 'string' && (CHANNEL_IDS as readonly string[]).includes(value);
}
