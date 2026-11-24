import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CalendarGrid } from '@/components/content/CalendarGrid';
import { RejectDialog } from '@/components/content/RejectDialog';
import { SchedulePicker } from '@/components/content/SchedulePicker';
import { placeItems } from '@/lib/content-calendar';
import type { EntityRecord } from '@/lib/foundry-api';

afterEach(cleanup);

describe('Reject dialog (bd startsim-656pt)', () => {
  it('asks "Reject this draft?", takes an optional reason and hands it back', async () => {
    const onReject = vi.fn();
    render(<RejectDialog open busy={false} onCancel={() => {}} onReject={onReject} />);
    expect(screen.getByText('Reject this draft?')).toBeTruthy();
    await userEvent.type(screen.getByLabelText(/Why\?/), 'off topic');
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(onReject).toHaveBeenCalledWith('off topic');
  });

  it('rejects with no reason', async () => {
    const onReject = vi.fn();
    render(<RejectDialog open busy={false} onCancel={() => {}} onReject={onReject} />);
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(onReject).toHaveBeenCalledWith('');
  });
});

describe('Schedule picker (bd startsim-4f989)', () => {
  it('opens a date and time picker and saving hands back the chosen moment', async () => {
    const onSchedule = vi.fn();
    render(<SchedulePicker current={null} busy={false} onSchedule={onSchedule} onUnschedule={async () => true} />);
    expect(screen.getByText(/Not scheduled/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /Schedule/ }));
    const date = screen.getByLabelText('Date') as HTMLInputElement;
    await userEvent.clear(date);
    await userEvent.type(date, '2026-10-23');
    await userEvent.click(screen.getAllByRole('button', { name: 'Schedule' }).at(-1)!);
    expect(onSchedule).toHaveBeenCalledTimes(1);
    const when = onSchedule.mock.calls[0][0] as Date;
    expect(when.getFullYear()).toBe(2026);
    expect(when.getMonth()).toBe(9);
    expect(when.getDate()).toBe(23);
  });

  it('says "Pick a date" while open and lets a scheduled date be changed', async () => {
    const onSchedule = vi.fn();
    render(<SchedulePicker current={new Date('2026-10-23T09:00:00')} busy={false} onSchedule={onSchedule} onUnschedule={async () => true} />);
    await userEvent.click(screen.getByRole('button', { name: /Schedule/ }));
    expect(screen.getByText(/Pick a date/)).toBeTruthy();
    expect((screen.getByLabelText('Date') as HTMLInputElement).value).toBe('2026-10-23');
  });

  it('offers Unschedule only when a date is set', async () => {
    const { rerender } = render(<SchedulePicker current={null} busy={false} onSchedule={async () => true} onUnschedule={async () => true} />);
    await userEvent.click(screen.getByRole('button', { name: /Schedule/ }));
    expect(screen.queryByRole('button', { name: 'Unschedule' })).toBeNull();
    rerender(<SchedulePicker current={new Date()} busy={false} onSchedule={async () => true} onUnschedule={async () => true} />);
    expect(screen.getByRole('button', { name: 'Unschedule' })).toBeTruthy();
  });
});

describe('Calendar grid (bd startsim-fggqp)', () => {
  const item = { id: 5, name: 'Item 5', entityType: 'draft', data: { status: 'scheduled', scheduledFor: '2026-10-27T09:00:00Z' } } as unknown as EntityRecord;

  it('puts an item on its day and links it to the item page', () => {
    render(<CalendarGrid year={2026} month={9} placed={placeItems([item], 'UTC')} todayKey="2026-10-01" />);
    const cell = document.querySelector('[data-day="2026-10-27"]')!;
    const link = cell.querySelector('a')!;
    expect(link.textContent).toBe('Item 5 · LinkedIn');
    expect(link.getAttribute('href')).toBe('/content/5');
    expect(document.querySelectorAll('a').length).toBe(1);
  });
});
