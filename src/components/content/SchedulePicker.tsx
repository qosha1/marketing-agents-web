'use client';

/**
 * Schedule: pick a date and time; saving moves the item to Scheduled (bd
 * startsim-2x1im). Native date/time inputs, read and written in the viewer's
 * zone; the stored value is UTC (lib/content-status.ts).
 */
import { useState } from 'react';
import { Button } from '@startsimpli/ui';

import { formatWhen } from '@/lib/content-list';

const pad = (n: number) => String(n).padStart(2, '0');
const dayOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeOf = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function SchedulePicker({
  current,
  busy,
  onSchedule,
  onUnschedule,
}: {
  current: Date | null;
  busy: boolean;
  onSchedule: (when: Date) => void;
  onUnschedule: () => void;
}) {
  const [open, setOpen] = useState(false);
  const seed = current ?? (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; })();
  const [day, setDay] = useState(dayOf(seed));
  const [time, setTime] = useState(timeOf(seed));
  const when = new Date(`${day}T${time}`);
  const valid = day !== '' && time !== '' && !Number.isNaN(when.getTime());

  return (
    <section className="space-y-2 rounded-lg border border-border p-4" aria-label="Schedule">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left text-sm font-semibold"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span>Schedule</span>
        <span className="font-normal text-neutral-500">
          {open ? 'Pick a date' : current ? `${formatWhen(current.toISOString())}, ${timeOf(current)}` : 'Not scheduled'} ▾
        </span>
      </button>
      {open ? (
        <div className="space-y-3">
          <div className="flex gap-2">
            <input aria-label="Date" type="date" value={day} onChange={(e) => setDay(e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1 text-sm" />
            <input aria-label="Time" type="time" value={time} onChange={(e) => setTime(e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1 text-sm" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy || !valid}
              onClick={() => {
                onSchedule(when);
                setOpen(false);
              }}
            >
              Schedule
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
            {current ? (
              <Button variant="secondary" disabled={busy} onClick={() => { onUnschedule(); setOpen(false); }}>
                Unschedule
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
