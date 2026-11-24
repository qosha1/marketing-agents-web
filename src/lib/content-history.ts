/**
 * The Content item's History, as sentences (bd startsim-bj3zz.3): "Rita approved
 * it · 2 min ago". Reads the same revision trail the shared panel does, but says
 * only what the design's History card says: who changed what, and when.
 */
import { formatWhen } from '@/lib/content-list';
import { contentStatusOf } from '@/lib/content-status';
import type { EntityRevision } from '@startsimpli/ui/history';

const TEXT_FIELDS = ['blog', 'linkedin'];

function moment(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', ...(timeZone ? { timeZone } : {}) }).format(d);
  return `${formatWhen(iso, timeZone)}, ${time}`;
}

export function describeRevision(r: EntityRevision, timeZone?: string): { who: string; what: string; at: string } {
  const g = r as unknown as Record<string, unknown>;
  const machine = String(g.actor_kind ?? g.actorKind ?? '') === 'machine';
  const who = machine ? 'Automation' : String(g.actor_label ?? g.actorLabel ?? '') || 'Someone';
  const at = String(g.created_at ?? g.createdAt ?? '');
  const changed = (r.metadata?.changed ?? {}) as Record<string, { before?: unknown; after?: unknown }>;
  const parts: string[] = [];

  if (r.action === 'created') {
    parts.push('created it');
  } else {
    const status = changed.status;
    const scheduledFor = changed.scheduled_for;
    if (status) {
      const to = String(status.after ?? '');
      const next = contentStatusOf(to);
      if (to === 'rejected') parts.push('rejected it');
      else if (next === 'scheduled') {
        const when = moment(String(scheduledFor?.after ?? ''), timeZone);
        parts.push(when ? `scheduled it for ${when}` : 'scheduled it');
      } else if (next === 'approved') parts.push(contentStatusOf(status.before) === 'scheduled' ? 'unscheduled it' : 'approved it');
      else if (next === 'posted') parts.push('marked it as posted');
      else parts.push('changed the status');
    } else if (scheduledFor) {
      const when = moment(String(scheduledFor.after ?? ''), timeZone);
      parts.push(when ? `changed the date to ${when}` : 'cleared the date');
    }
    if (TEXT_FIELDS.some((f) => f in changed)) parts.push('edited the text');
    if (parts.length === 0) parts.push('updated it');
  }
  return { who, what: parts.join(' and '), at };
}

/** "just now", "5 min ago", "2 h ago", then "Nov 4". '' when unusable. */
export function ago(iso: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const m = Math.max(0, Math.round((now - t) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
