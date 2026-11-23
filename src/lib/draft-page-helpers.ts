/**
 * Pure helpers for the draft page (split out of the page, bd startsim-m7fdm.27,
 * to keep that file under 1,000 lines). No state, no I/O.
 */
import { wordCount } from '@startsimpli/ui';
import type { DocSection } from '@startsimpli/ui/document-editor';

import { readData } from '@/lib/board';
import type { EntityRecord } from '@/lib/foundry-api';

/** A source's reviewer-only metadata (kept OUT of the `sources` string). */
export interface SourceMetaEntry {
  id: string;
  verified: boolean;
}

/**
 * Status-pill tone per draft status, over the team's six (bd startsim-wn2p.2):
 * the two review states are neutral/amber, approved is green, and the three
 * terminal dispositions share a muted red-to-grey band because they all mean
 * "this is not going out as it stands".
 *
 * A status the tenant declares but this map does not name falls back to neutral
 * rather than rendering untoned — membership is the schema's, not this file's.
 */
export const STATUS_PILL_TONE: Record<string, string> = {
  ready_for_review: 'bg-neutral-100 text-neutral-600',
  under_review: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  // Published is the only state that is BOTH finished and still on the tracker,
  // so it gets its own tone rather than sharing approved's — a reviewer scanning
  // the list needs to see at a glance which approved pieces actually went out.
  published: 'bg-sky-100 text-sky-700',
  rejected: 'bg-red-100 text-red-700',
  not_for_publication: 'bg-neutral-200 text-neutral-700',
  for_repurpose: 'bg-violet-100 text-violet-700',
};

/** camelCase-aware read of a draft data value as a string. */
/** "Oct 18" — the sent date beside the status chip; the raw value when unparseable. */
export function formatSentDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function draftStr(data: EntityRecord['data'], name: string): string {
  const v = readData(data, name);
  return v == null ? '' : String(v);
}

/** The current value of a section by key, or undefined when absent. */
export function sectionValue(sections: DocSection[], key: string): unknown {
  return sections.find((s) => s.key === key)?.value;
}

/**
 * Editable document sections for a draft: blog/linkedin/seo. Sources are NOT a
 * DocumentEditor section anymore — they're the dedicated Sources channel tool
 * (parsed rows + format-preserving round-trip), so they're managed separately.
 */
export function draftSections(draft: EntityRecord): DocSection[] {
  const seo = readData(draft.data, 'seo');
  const seoObj =
    seo && typeof seo === 'object' && !Array.isArray(seo) ? (seo as Record<string, unknown>) : {};
  return [
    { key: 'blog', label: 'Blog post', kind: 'markdown', value: draftStr(draft.data, 'blog') },
    { key: 'linkedin', label: 'LinkedIn post', kind: 'text', value: draftStr(draft.data, 'linkedin') },
    { key: 'seo', label: 'SEO', kind: 'structured', value: seoObj },
  ];
}

/** The reviewer's stored per-source metadata array ([] when absent). */
export function readSourceMeta(data: EntityRecord['data'] | undefined): SourceMetaEntry[] {
  const m = readData(data, 'source_meta');
  return Array.isArray(m)
    ? (m as unknown[])
        .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
        .map((e) => ({ id: String(e.id ?? ''), verified: !!e.verified }))
        .filter((e) => e.id)
    : [];
}

/**
 * Small word count for the channel-tab badges — the SHARED counter, not a local
 * one (bd startsim-wn2p.28).
 *
 * This was its own `split(/\s+/)`, so on the Chinese drafts the tab read
 * "Brief 16w" while the validation rail beside it read 524 words. Whitespace
 * counting sees only the Latin fragments embedded in Chinese prose.
 */
export function words(s: string): number {
  return wordCount(s);
}
