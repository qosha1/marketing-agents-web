/**
 * Sources parsing / serialization + staleness + tier helpers for the draft-review
 * Sources tool (P2 of the review redesign).
 *
 * The n8n OGMC pipeline stores a draft's `sources` as evidence behind the brief.
 * The stored value is either a newline-delimited STRING (one entry per line) or a
 * JSON ARRAY of entry strings — each entry shaped like:
 *   `Arab News (2024-08-04) https://arabnews.com/… | one-line note`
 * The Sources tool needs those broken into structured rows (publisher · date · url
 * · note) to show tier + recency, but the pipeline (and any other reader) must keep
 * consuming `sources` in its ORIGINAL serialization. So these helpers PARSE into
 * rows, keep each entry's original `raw` text, and RE-SERIALIZE unchanged entries
 * verbatim into the SAME container (string ↔ array) — a lossless round-trip. New /
 * edited entries (with no `raw`) are rebuilt in the canonical `Publisher (date) url
 * | note` shape. Reviewer-only metadata (the `verified` flag) is NEVER folded into
 * this string — it rides a separate `source_meta` blob key — so the pipeline never
 * sees a token it can't parse.
 *
 * All pure + framework-free so they unit-test without a running tenant.
 */

/** The stored-container shape of the `sources` value, preserved on write. */
export type SourcesContainer = 'string' | 'array';

/** One parsed source row. `raw` is the original entry text (verbatim round-trip). */
export interface ParsedSource {
  /** Stable-ish id for React keys / meta lookups (the url, else the raw text). */
  id: string;
  /** Publisher / outlet name (before the `(` or the url). '' when unknown. */
  publisher: string;
  /** Publication date as `YYYY-MM-DD`. '' when absent/unparseable. */
  date: string;
  /** The first http(s) URL in the entry. '' when the entry has no URL. */
  url: string;
  /** Free-text note after the ` | ` separator. '' when absent. */
  note: string;
  /** The original entry text. Present → serialize verbatim; '' → rebuild canonical. */
  raw: string;
}

export interface ParsedSources {
  items: ParsedSource[];
  /** The original container shape, preserved when serializing back. */
  container: SourcesContainer;
}

/** Normalise a URL to its bare host (lowercased, `www.` stripped). '' if unparseable. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Parse one stored entry string into a structured {@link ParsedSource}. */
export function parseSourceEntry(rawInput: string): ParsedSource {
  const raw = String(rawInput ?? '');
  const text = raw.trim();

  const urlMatch = text.match(/https?:\/\/[^\s|]+/i);
  const url = urlMatch ? urlMatch[0].replace(/[.,;]+$/, '') : '';

  const dateMatch = text.match(/(\d{4}-\d{2}-\d{2})/);
  const date = dateMatch ? dateMatch[1] : '';

  const pipeIdx = text.indexOf('|');
  const note = pipeIdx >= 0 ? text.slice(pipeIdx + 1).trim() : '';

  // Publisher = the label before the `(date)` or the url, else before the pipe.
  let publisher = '';
  const parenIdx = text.indexOf('(');
  if (parenIdx > 0) {
    publisher = text.slice(0, parenIdx);
  } else if (url && text.indexOf(url) > 0) {
    publisher = text.slice(0, text.indexOf(url));
  } else if (pipeIdx > 0) {
    publisher = text.slice(0, pipeIdx);
  }
  publisher = publisher.replace(/[-–—:·|]\s*$/, '').trim();
  if (!publisher && url) publisher = hostOf(url);
  if (!publisher && !url) publisher = text.slice(0, 60);

  return { id: url || text || `src-${Math.random().toString(36).slice(2)}`, publisher, date, url, note, raw };
}

/**
 * Parse the stored `sources` value (a newline-string OR an array of entries) into
 * structured rows, remembering the original container so it round-trips on write.
 * Array elements may be plain strings or objects (`{url|href|value|name}`).
 */
export function parseSources(rawValue: unknown): ParsedSources {
  if (Array.isArray(rawValue)) {
    const items = rawValue
      .map((el) => {
        if (typeof el === 'string') return el.trim();
        if (el && typeof el === 'object') {
          const o = el as Record<string, unknown>;
          return String(o.url ?? o.href ?? o.value ?? o.name ?? '').trim();
        }
        return String(el ?? '').trim();
      })
      .filter(Boolean)
      .map(parseSourceEntry);
    return { items, container: 'array' };
  }
  if (typeof rawValue === 'string') {
    const items = rawValue
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map(parseSourceEntry);
    return { items, container: 'string' };
  }
  return { items: [], container: 'string' };
}

/** Rebuild the canonical `Publisher (date) url | note` line for one row. */
export function canonicalSourceLine(s: ParsedSource): string {
  const parts: string[] = [];
  if (s.publisher) parts.push(s.publisher.trim());
  if (s.date) parts.push(`(${s.date})`);
  if (s.url) parts.push(s.url.trim());
  let line = parts.join(' ').trim();
  if (s.note) line = line ? `${line} | ${s.note.trim()}` : s.note.trim();
  return line;
}

/** Serialize one row: verbatim `raw` when present (unchanged), else canonical. */
export function serializeSourceEntry(s: ParsedSource): string {
  const raw = (s.raw ?? '').trim();
  return raw ? raw : canonicalSourceLine(s);
}

/**
 * Serialize rows back to the ORIGINAL container: a `\n`-joined string, or an array
 * of entry strings. Unchanged entries survive byte-for-byte via their `raw`; new /
 * edited entries (raw='') are rebuilt canonical. Blank lines are dropped.
 */
export function serializeSources(items: ParsedSource[], container: SourcesContainer): string | string[] {
  const lines = items.map(serializeSourceEntry).map((l) => l.trim()).filter(Boolean);
  return container === 'array' ? lines : lines.join('\n');
}

/** Approved (Tier-1) when the URL's host is on the allow-list, else unverified. */
export function sourceTier(url: string, approvedHosts: string[]): 'approved' | 'unverified' {
  const host = hostOf(url);
  if (!host) return 'unverified';
  const approved = new Set(approvedHosts.map((h) => h.toLowerCase().replace(/^www\./, '')));
  return approved.has(host) ? 'approved' : 'unverified';
}

/** Whole days between a `YYYY-MM-DD` date and `today` (UTC). null when unparseable. */
export function sourceAgeDays(date: string, today: Date): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const days = Math.floor((today.getTime() - d.getTime()) / 86_400_000);
  return days < 0 ? 0 : days;
}

/** A source older than ~6 months is stale for a weekly brief. */
export function isStale(days: number | null): boolean {
  return days != null && days > 183;
}

/** Compact human age, e.g. "~2 mo old", "~1 yr old", "today". '' when unknown. */
export function ageLabel(days: number | null): string {
  if (days == null) return '';
  if (days < 1) return 'today';
  if (days < 45) return `~${days} d old`;
  const months = Math.round(days / 30);
  if (months < 18) return `~${months} mo old`;
  const years = Math.round(days / 365);
  return `~${years} yr old`;
}

/** Format `YYYY-MM-DD` as `Mon D, YYYY` (e.g. `Aug 4, 2024`). Echoes input on failure. */
export function formatSourceDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export interface CoverageSummary {
  count: number;
  /** Age in days of the OLDEST source (max), or null when none have a date. */
  oldestDays: number | null;
  /** True when coverage is thin (≤1 source) or the oldest source is stale. */
  concern: boolean;
}

/** Roll up the source set into a coverage summary for the warning banner. */
export function coverageSummary(items: ParsedSource[], today: Date): CoverageSummary {
  const ages = items.map((s) => sourceAgeDays(s.date, today)).filter((n): n is number => n != null);
  const oldestDays = ages.length ? Math.max(...ages) : null;
  const concern = items.length <= 1 || isStale(oldestDays);
  return { count: items.length, oldestDays, concern };
}
