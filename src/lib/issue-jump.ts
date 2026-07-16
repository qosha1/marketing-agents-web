/**
 * Jump-to-issue targets for the draft review (bd 768w.16.15.3).
 *
 * The Quality rail can say "Checks 7/8" — but a reviewer cannot act on a count: it
 * names neither WHAT failed nor WHERE. `runContentChecks` (@startsimpli/ui) stamps
 * every NON-PASSING check with the field(s) it implicates, plus the exact substrings
 * when the finding IS a span (hype words, unapproved source URLs). This module turns
 * those checks into an ordered, flat list of jump STOPS — the model behind both the
 * rail's per-issue buttons and the j/k shortcuts.
 *
 * One stop per (check, location) pair rather than per check, because `no-hype` can
 * implicate several fields at once and each of them is a separate place to go.
 *
 * Pure — no React, no DOM. Fork-local: the field→channel mapping is THIS app's
 * content-pane layout, which the shared checker has no business knowing about.
 */
import type { CheckStatus, ContentCheck, ContentFields } from '@startsimpli/ui';

/** The content pane's channel tabs — the ids ContentChannels is built with. */
export type ChannelId = 'brief' | 'linkedin' | 'seo' | 'sources';

export const CHANNEL_IDS: readonly ChannelId[] = ['brief', 'linkedin', 'seo', 'sources'];

/**
 * Which channel opens a given content field. Blog + headline share the Brief
 * channel; tags + meta description share SEO.
 */
export const FIELD_CHANNEL: Record<keyof ContentFields, ChannelId> = {
  blog: 'brief',
  headline: 'brief',
  linkedin: 'linkedin',
  metaDescription: 'seo',
  tags: 'seo',
  sources: 'sources',
};

export function isChannelId(value: unknown): value is ChannelId {
  return typeof value === 'string' && (CHANNEL_IDS as readonly string[]).includes(value);
}

/**
 * The channel that opens `field`, or undefined when the field has no home in the
 * content pane. Undefined is a real answer, not a bug: `ContentFields` is shared
 * across apps, so the checker may name a field before this fork grows a channel for
 * it. Callers drop those stops rather than render a control that goes nowhere.
 */
export function channelForField(field: string): ChannelId | undefined {
  return FIELD_CHANNEL[field as keyof ContentFields];
}

/** One place a reviewer can be sent to: a single location of a single check. */
export interface IssueStop {
  /** The check this stop belongs to — `no-hype` yields one stop per field. */
  checkId: string;
  label: string;
  detail?: string;
  status: CheckStatus;
  field: keyof ContentFields;
  channel: ChannelId;
  /**
   * Exact substrings to highlight in the field, or [] when the whole field IS the
   * finding (a word count is not a span) — then there is only a channel to open.
   */
  matches: string[];
}

/** Identifies a stop across recomputes — see {@link findStopIndex}. */
export interface StopKey {
  checkId: string;
  field: string;
}

/**
 * Flatten the non-passing checks into the ordered list of places to go. Passing
 * checks are skipped (a green check has nowhere to jump to), as are locations whose
 * field no channel shows.
 */
export function issueStops(checks: ContentCheck[]): IssueStop[] {
  const stops: IssueStop[] = [];
  for (const check of checks) {
    if (check.status === 'pass') continue;
    for (const location of check.locations ?? []) {
      const channel = channelForField(location.field);
      if (!channel) continue;
      stops.push({
        checkId: check.id,
        label: check.label,
        detail: check.detail,
        status: check.status,
        field: location.field,
        channel,
        matches: location.matches ?? [],
      });
    }
  }
  return stops;
}

/**
 * Locate a stop by identity rather than by position.
 *
 * The checks recompute on every keystroke, so a stored INDEX silently comes to
 * point at a different issue the moment the reviewer fixes one. Callers hold a
 * {@link StopKey} and re-resolve it here: once the issue is fixed it resolves to
 * -1 and the highlight clears itself instead of drifting onto an innocent check.
 */
export function findStopIndex(stops: IssueStop[], key: StopKey | null | undefined): number {
  if (!key) return -1;
  return stops.findIndex((s) => s.checkId === key.checkId && s.field === key.field);
}

/** The next stop, wrapping. From "nothing active" (-1) that's the first one. */
export function nextStopIndex(current: number, total: number): number {
  if (total <= 0) return -1;
  return current < 0 ? 0 : (current + 1) % total;
}

/** The previous stop, wrapping. From "nothing active" (-1) that's the last one. */
export function prevStopIndex(current: number, total: number): number {
  if (total <= 0) return -1;
  return current < 0 ? total - 1 : (current - 1 + total) % total;
}

/**
 * The stop to go to when the reviewer activates `checkId` in the rail.
 *
 * Normally the check's FIRST location. But a check can implicate several fields
 * (`no-hype` finds "revolutionary" in both the blog and the LinkedIn post) and one
 * button must reach all of them — so re-activating the check you are ALREADY on
 * advances to its next location and wraps back to its first. That makes the second
 * location discoverable by repeating the thing you just did, rather than hiding it
 * behind a control the reviewer has no reason to expect.
 *
 * -1 when the check has no jumpable location at all.
 */
export function stopIndexForCheck(stops: IssueStop[], checkId: string, current: number): number {
  const mine: number[] = [];
  stops.forEach((s, i) => {
    if (s.checkId === checkId) mine.push(i);
  });
  if (mine.length === 0) return -1;
  const at = mine.indexOf(current);
  return at === -1 ? mine[0] : mine[(at + 1) % mine.length];
}
