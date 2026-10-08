/**
 * Track changes on the draft page (bd startsim-q8sgy; design startsim-xyn25).
 *
 * The client is the shared `createHttpTrackChangesClient` from
 * `@startsimpli/ui/track-changes`, bound here to this app's bearer and URL
 * shape. Plain fetch, for the reason lib/revisions.ts gives: the shared API
 * client camelCases tenant-declared field names. No trailing slash on the
 * path, because next.config's rewrite appends one.
 *
 * `foldAccepted` is the half of an accept the page must not forget. An accept
 * is a SERVER-SIDE write that moves the record's version and its text. The
 * page holds its own copy of the sections and PATCHes the whole blob from it,
 * so if that copy still held the pre-accept text, the next scorecard autosave
 * would put the old text straight back over the accept, and the save hook,
 * still holding the old version, would 412 against the reviewer's own accept.
 */
import { createHttpTrackChangesClient, type AcceptResponseWire, type TrackChangesClient } from '@startsimpli/ui/track-changes';

import { getRegisteredToken } from '@/infrastructure/auth';
import { formatBearer } from '@/lib/bearer';
import { readData } from '@/lib/board';

/** The draft fields under track changes. */
export const TRACKED_FIELDS = ['blog', 'linkedin'] as const;
export type TrackedFieldKey = (typeof TRACKED_FIELDS)[number];

export function trackChangesClient(id: number | string): TrackChangesClient {
  return createHttpTrackChangesClient(id, {
    headers: async () => ({ authorization: formatBearer(await getRegisteredToken()) }),
    url: (path) => path,
  });
}

/** The stored text of each tracked field on a record body. */
export function trackedText(data: Record<string, unknown> | undefined | null): Record<TrackedFieldKey, string> {
  const out = {} as Record<TrackedFieldKey, string>;
  for (const f of TRACKED_FIELDS) {
    const v = readData(data ?? {}, f);
    out[f] = v == null ? '' : String(v);
  }
  return out;
}

export interface FoldedAccept {
  text: Record<TrackedFieldKey, string>;
  version: number | undefined;
}

/** What an accept answer says the record now is. */
export function foldAccepted(res: AcceptResponseWire): FoldedAccept {
  return {
    text: trackedText(res.data as Record<string, unknown> | undefined),
    version: typeof res.version === 'number' ? res.version : undefined,
  };
}

/** Sections with the tracked fields replaced by `text`; others untouched. */
export function withTrackedText<S extends { key: string; value: unknown }>(
  sections: S[],
  text: Partial<Record<TrackedFieldKey, string>>,
): S[] {
  return sections.map((s) => (s.key in text ? { ...s, value: text[s.key as TrackedFieldKey] } : s));
}

/** Viewer-role members suggest and comment but do not edit (Quinn). */
export function canEditRecords(role: string | null | undefined): boolean {
  return !!role && role !== 'viewer';
}
