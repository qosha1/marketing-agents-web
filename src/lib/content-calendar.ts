/**
 * The Content calendar (bd startsim-xr4f2): scheduled items on their day, month
 * navigation, and the set a reminder job picks. Not a posting integration.
 *
 * A month is queried by UTC window a day wider than the month on each side, then
 * placed on the viewer's local day, because `scheduled_for` is stored as UTC and
 * the server compares it as text.
 */
import { readData } from '@/lib/board';
import { contentStatusOf } from '@/lib/content-status';
import type { EntityFilters, EntityRecord } from '@/lib/foundry-api';

export interface GridCell {
  year: number;
  month: number;
  day: number;
  inMonth: boolean;
  /** YYYY-MM-DD, the key `placeItems` files items under. */
  key: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const keyOf = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

/** Monday-first weeks covering `month` (0-based) of `year`. */
export function monthGrid(year: number, month: number): GridCell[][] {
  const first = new Date(Date.UTC(year, month, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const total = Math.ceil((lead + days) / 7) * 7;
  const weeks: GridCell[][] = [];
  for (let i = 0; i < total; i++) {
    const d = new Date(Date.UTC(year, month, 1 - lead + i));
    const cell: GridCell = {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth(),
      day: d.getUTCDate(),
      inMonth: d.getUTCMonth() === month && d.getUTCFullYear() === year,
      key: keyOf(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
    };
    if (i % 7 === 0) weeks.push([]);
    weeks[weeks.length - 1].push(cell);
  }
  return weeks;
}

export function monthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month, 1)),
  );
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(Date.UTC(year, month + delta, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
}

export function calendarFilters(year: number, month: number, projectId: string | null): EntityFilters {
  const from = new Date(Date.UTC(year, month, 1) - 86_400_000);
  const to = new Date(Date.UTC(year, month + 1, 1) + 86_400_000);
  const f: EntityFilters = {
    'attr.status__in': 'scheduled',
    'attr.scheduled_for__gte': from.toISOString(),
    'attr.scheduled_for__lt': to.toISOString(),
    order: 'attr.scheduled_for',
    page_size: '200',
  };
  if (projectId) f.scope = projectId;
  return f;
}

function localKey(d: Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', ...(timeZone ? { timeZone } : {}),
  }).format(d);
  return parts; // en-CA is YYYY-MM-DD
}

function scheduledAt(item: EntityRecord): Date | null {
  const raw = String(readData(item.data, 'scheduled_for') ?? '');
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function placeItems(items: EntityRecord[], timeZone?: string): Map<string, EntityRecord[]> {
  const out = new Map<string, EntityRecord[]>();
  for (const item of items) {
    const at = scheduledAt(item);
    if (!at) continue;
    const key = localKey(at, timeZone);
    out.set(key, [...(out.get(key) ?? []), item]);
  }
  return out;
}

/**
 * The items an email reminder should go out for today: Scheduled, and falling on
 * tomorrow's date in `timeZone`. Mirrors the job in the backend follow-up
 * (bd startsim-xwtv0.1), which has to agree with what the calendar shows.
 */
export function dueTomorrow(items: EntityRecord[], now: Date, timeZone?: string): EntityRecord[] {
  const tomorrow = localKey(new Date(now.getTime() + 86_400_000), timeZone);
  return items.filter((item) => {
    if (contentStatusOf(readData(item.data, 'status')) !== 'scheduled') return false;
    const at = scheduledAt(item);
    return !!at && localKey(at, timeZone) === tomorrow;
  });
}
