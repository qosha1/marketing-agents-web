/**
 * The v2 Content status flow (bd startsim-qztg3, startsim-bd1lj, startsim-2x1im).
 *
 * Jurga, 2026-11-04: Draft, Approved, Scheduled, Posted. No "In review", no
 * "Send for review". The four are a READING of the draft status vocabulary the
 * tenant already stores (lib/draft-status.ts), never a rewrite of it: a row
 * keeps the value it has, so history and every consumer of `approved` are
 * untouched.
 *
 *   Draft      ready_for_review (new)   · under_review, needs_revision, drafting (legacy)
 *   Approved   approved                 · ready (legacy)
 *   Scheduled  scheduled (new choice)
 *   Posted     published                · sent (legacy)
 *   (hidden)   rejected, not_for_publication, for_repurpose
 *
 * Stored values, not derived ones, because the list narrows on the server with
 * `attr.status__in` (rule 8) and a derived status could not be filtered there.
 *
 * Who may approve is deferred (bd startsim-fu9ls): anyone may, for now.
 *
 * Writes use the camelised key the record blob carries (`scheduledFor`), as
 * `laneMoveData` does; the write seam restores the declared spelling.
 */
import { toCamelKey } from '@/lib/board';

export type ContentStatus = 'draft' | 'approved' | 'scheduled' | 'posted';

export const CONTENT_STATUS_KEYS: ContentStatus[] = ['draft', 'approved', 'scheduled', 'posted'];

const LABELS: Record<ContentStatus, string> = {
  draft: 'Draft',
  approved: 'Approved',
  scheduled: 'Scheduled',
  posted: 'Posted',
};

/** The stored values each status reads, first = the one a write stores. */
const STORED: Record<ContentStatus, string[]> = {
  draft: ['ready_for_review', 'under_review', 'needs_revision', 'drafting'],
  approved: ['approved', 'ready'],
  scheduled: ['scheduled'],
  posted: ['published', 'sent'],
};

/** Values that mean the item is out of Content altogether. Kept, never deleted. */
export const HIDDEN_STATUS_VALUES = ['rejected', 'not_for_publication', 'for_repurpose'];

const REJECTED = 'rejected';

export function contentStatusLabel(status: ContentStatus): string {
  return LABELS[status];
}

/** The status a stored value reads as; null for a rejected/shelved or unknown value. */
export function contentStatusOf(stored: unknown): ContentStatus | null {
  const v = String(stored ?? '');
  return CONTENT_STATUS_KEYS.find((s) => STORED[s].includes(v)) ?? null;
}

/**
 * The stored values the list asks the server for: every visible value the
 * tenant declares (or just one status's), never a rejected one. A value the
 * tenant does not declare is skipped rather than asked for.
 */
export function visibleStatusValues(declared: string[], only?: ContentStatus | null): string[] {
  const wanted = only ? STORED[only] : CONTENT_STATUS_KEYS.flatMap((s) => STORED[s]);
  const has = new Set(declared);
  return wanted.filter((v) => has.has(v));
}

type Data = Record<string, unknown>;

const set = (data: Data, patch: Data): Data => ({ ...data, ...patch });

export function approveData(data: Data): Data {
  return set(data, { status: 'approved' });
}

/** Set the time it goes out; stored as UTC so text comparison on the server orders correctly. */
export function scheduleData(data: Data, when: Date): Data {
  return set(data, { status: 'scheduled', [toCamelKey('scheduled_for')]: when.toISOString() });
}

export function unscheduleData(data: Data): Data {
  return set(data, { status: 'approved', [toCamelKey('scheduled_for')]: '' });
}

/** Posted is marked by hand (there is no posting integration). */
export function markPostedData(data: Data, now: Date): Data {
  return set(data, { status: 'published', [toCamelKey('sent_at')]: now.toISOString().slice(0, 10) });
}

/**
 * Reject keeps the record (status `rejected`, never a delete) and the topic it
 * came from. The reason is optional and is not shown on the list (bd
 * startsim-1c0ni: where a rejected draft ends up is still open).
 */
export function rejectData(data: Data, reason: string): Data {
  const clean = reason.trim();
  const next = set(data, { status: REJECTED });
  if (clean) next[toCamelKey('reject_reason')] = clean;
  return next;
}

export interface ContentAction {
  id: 'approve' | 'reject' | 'mark-posted';
  label: string;
  tone: 'primary' | 'secondary';
}

/** The buttons in the item header. Scheduling is its own control, not a button here. */
export function contentActions(status: ContentStatus | null): ContentAction[] {
  switch (status) {
    case 'draft':
      return [
        { id: 'approve', label: 'Approve', tone: 'primary' },
        { id: 'reject', label: 'Reject', tone: 'secondary' },
      ];
    case 'approved':
      return [
        { id: 'reject', label: 'Reject', tone: 'secondary' },
        { id: 'mark-posted', label: 'Mark as posted', tone: 'secondary' },
      ];
    case 'scheduled':
      return [{ id: 'mark-posted', label: 'Mark as posted', tone: 'secondary' }];
    default:
      return [];
  }
}

export function schedulingAvailable(status: ContentStatus | null): boolean {
  return status === 'approved' || status === 'scheduled';
}

interface TypeLike {
  attributes?: { name: string; config?: { choices?: unknown } }[];
}

/**
 * Scheduling needs the tenant to declare the `scheduled` status and the
 * `scheduled_for` date. A tenant that does not gets no Schedule control, rather
 * than a write of a value it has not declared (same stance as `declaresTopicRef`).
 */
export function schedulingDeclared(type: TypeLike | null | undefined): boolean {
  const attrs = type?.attributes ?? [];
  const choices = attrs.find((a) => a.name === 'status')?.config?.choices;
  return (
    attrs.some((a) => a.name === 'scheduled_for') &&
    Array.isArray(choices) &&
    choices.map(String).includes('scheduled')
  );
}
