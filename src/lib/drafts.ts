/**
 * Pure, schema-driven grouping logic for the Draft review workspace
 * (bd startsim-768w.18.5).
 *
 * The n8n writer emits N candidate drafts per ready topic ("3 candidates, pick 1"
 * from the June 24 call), but the tenant draft records carry NO stored parent
 * topic id — each candidate only knows its own headline. The reliable shared
 * signal across a candidate set is its SOURCE: all candidates for one story are
 * grounded on the same primary source URL. So we cluster by normalized primary
 * source URL, with the shared "— <story>" name-suffix and story_title as
 * fallbacks. Pure + framework-free so it's unit-tested in isolation; the React
 * <DraftReviewWorkspace/> composes over it.
 *
 * DURABLE FIX (out of scope here, tracked on the n8n loop bead 768w.18.9): have
 * the writer stamp a `topic_ref` on each draft so grouping is exact, not derived.
 */
import type { EntityRecord } from '@/lib/foundry-api';
import { readData } from '@/lib/board';

export interface DraftSource {
  url: string;
  outlet?: string;
  date?: string;
}

/** First non-empty string among camel/snake variants. */
function str(v: unknown): string {
  return v == null ? '' : String(v);
}

/**
 * Sources arrive in two shapes from the pipeline: a pipe-delimited string
 * ("Outlet (2024-08-04) https://url | note without a url") or a JSON array of
 * { url, outlet, date }. Normalize both to a list of sources that actually carry
 * a URL (note-only segments are dropped).
 */
export function parseSources(raw: unknown): DraftSource[] {
  if (Array.isArray(raw)) {
    return raw
      .map((s): DraftSource | null => {
        if (typeof s === 'string') return s ? { url: s } : null;
        if (s && typeof s === 'object') {
          const o = s as Record<string, unknown>;
          const url = str(o.url);
          return url ? { url, outlet: str(o.outlet) || undefined, date: str(o.date) || undefined } : null;
        }
        return null;
      })
      .filter((s): s is DraftSource => s !== null);
  }
  if (typeof raw === 'string') {
    return raw
      .split('|')
      .map((part): DraftSource | null => {
        const m = part.match(/https?:\/\/\S+/);
        if (!m) return null;
        const outlet = part.slice(0, part.indexOf('(') === -1 ? part.indexOf('http') : part.indexOf('(')).trim();
        const dm = part.match(/\((\d{4}-\d{2}-\d{2})\)/);
        return { url: m[0].replace(/[.,)]+$/, ''), outlet: outlet || undefined, date: dm ? dm[1] : undefined };
      })
      .filter((s): s is DraftSource => s !== null);
  }
  return [];
}

/** host + path (no scheme/www/trailing slash), lowercased — a stable dedupe key. */
export function normUrl(u: string): string {
  try {
    const x = new URL(/^https?:\/\//.test(u) ? u : `https://${u}`);
    return (x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/+$/, '')).toLowerCase();
  } catch {
    return u.trim().toLowerCase();
  }
}

/**
 * The clustering key for a draft: normalized primary source URL if present, else
 * the shared "Candidate N — <story>" suffix, else story_title/name, else id.
 */
export function groupKeyOf(r: EntityRecord): string {
  const sources = parseSources(readData(r.data, 'sources'));
  if (sources.length > 0) return `src:${normUrl(sources[0].url)}`;
  const name = str(r.name) || str(readData(r.data, 'story_title'));
  const suffix = name.replace(/^\s*candidate\s*\d+\s*[—\-:]\s*/i, '').trim();
  if (suffix) return `name:${suffix.toLowerCase()}`;
  return `id:${r.id}`;
}

/** Candidate title without the "Candidate N — " scaffolding the writer adds. */
export function candidateTitle(r: EntityRecord): string {
  const raw = str(readData(r.data, 'story_title')) || str(r.name);
  return raw.replace(/^\s*candidate\s*\d+\s*[—\-:]\s*/i, '').trim() || raw || `#${r.id}`;
}

export function candidateIndex(r: EntityRecord): number {
  const n = Number(readData(r.data, 'candidate_index'));
  return Number.isFinite(n) ? n : 0;
}

export function isChosen(r: EntityRecord): boolean {
  const v = readData(r.data, 'chosen');
  return v === true || v === 'true' || v === 1;
}

export interface DraftGroup {
  key: string;
  label: string;
  contentType: string;
  candidates: EntityRecord[];
  chosen: EntityRecord | null;
  written: boolean;
}

/**
 * Cluster draft records into candidate sets (one per story), each sorted by
 * candidate_index. Groups are ordered so unresolved stories (nothing picked)
 * float to the top — that's the work to do — and fully-written ones sink.
 */
export function groupDrafts(records: EntityRecord[]): DraftGroup[] {
  const byKey = new Map<string, EntityRecord[]>();
  for (const r of records) {
    const k = groupKeyOf(r);
    (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(r);
  }
  const groups: DraftGroup[] = [];
  for (const [key, cands] of byKey) {
    cands.sort((a, b) => candidateIndex(a) - candidateIndex(b));
    const chosen = cands.find(isChosen) ?? null;
    const head = chosen ?? cands[0];
    const written = cands.some((c) => str(readData(c.data, 'status')) === 'written');
    groups.push({
      key,
      label: candidateTitle(head),
      contentType: str(readData(head.data, 'content_type')),
      candidates: cands,
      chosen,
      written,
    });
  }
  // Unresolved first (nothing chosen), then chosen-but-not-written, then written.
  const rank = (g: DraftGroup) => (g.written ? 2 : g.chosen ? 1 : 0);
  return groups.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
}

/** Word-count targets by content type, from the OGMC skill specs. */
export function wordTargets(contentType: string): { blog: [number, number]; linkedin: [number, number] } {
  switch (contentType) {
    case 'lead_magnet':
      return { blog: [3000, 4500], linkedin: [0, 0] };
    case 'weekly_brief':
      return { blog: [400, 500], linkedin: [150, 250] };
    default:
      return { blog: [350, 600], linkedin: [120, 280] };
  }
}

export type CheckStatus = 'ok' | 'low' | 'high' | 'none';

/** Grade a word count against a [lo, hi] target. hi===0 means "no target". */
export function gradeWords(count: number, [lo, hi]: [number, number]): CheckStatus {
  if (hi === 0) return 'none';
  if (count < lo) return 'low';
  if (count > hi) return 'high';
  return 'ok';
}
