/**
 * RED for the v2 Content status flow (bd startsim-rlvwc, startsim-656pt, startsim-4f989).
 *
 * Jurga, 2026-11-04: Draft, Approved, Scheduled, Posted. No "In review", no
 * "Send for review". The four map onto the draft status vocabulary that already
 * exists, so history is never rewritten: a row keeps the value it has, and the
 * four labels are a reading of it.
 */
import { describe, expect, it } from 'vitest';

import {
  approveData,
  contentActions,
  contentStatusLabel,
  contentStatusOf,
  markPostedData,
  rejectData,
  scheduleData,
  unscheduleData,
  visibleStatusValues,
  CONTENT_STATUS_KEYS,
  schedulingAvailable,
  schedulingDeclared,
} from '@/lib/content-status';

const DECLARED = [
  'ready_for_review', 'under_review', 'approved', 'published', 'rejected',
  'not_for_publication', 'for_repurpose', 'drafting', 'ready', 'needs_revision', 'sent', 'scheduled',
];

describe('the four statuses', () => {
  it('are Draft, Approved, Scheduled, Posted and nothing else', () => {
    expect(CONTENT_STATUS_KEYS.map(contentStatusLabel)).toEqual(['Draft', 'Approved', 'Scheduled', 'Posted']);
  });

  it('read the stored value without rewriting it', () => {
    expect(contentStatusOf('ready_for_review')).toBe('draft');
    expect(contentStatusOf('approved')).toBe('approved');
    expect(contentStatusOf('scheduled')).toBe('scheduled');
    expect(contentStatusOf('published')).toBe('posted');
  });

  it('fold the legacy values into the nearest of the four', () => {
    expect(contentStatusOf('drafting')).toBe('draft');
    expect(contentStatusOf('under_review')).toBe('draft');
    expect(contentStatusOf('needs_revision')).toBe('draft');
    expect(contentStatusOf('ready')).toBe('approved');
    expect(contentStatusOf('sent')).toBe('posted');
  });

  it('give rejected and shelved rows no status, so they are not listed', () => {
    expect(contentStatusOf('rejected')).toBeNull();
    expect(contentStatusOf('not_for_publication')).toBeNull();
    expect(contentStatusOf('for_repurpose')).toBeNull();
  });

  it('never offer an in-review state', () => {
    expect(CONTENT_STATUS_KEYS).not.toContain('in_review');
    expect(CONTENT_STATUS_KEYS.map(contentStatusLabel).join(' ')).not.toMatch(/review/i);
  });
});

describe('which stored values the list asks the server for', () => {
  it('is every visible value the tenant declares and never a rejected one', () => {
    const v = visibleStatusValues(DECLARED);
    expect(v).toContain('ready_for_review');
    expect(v).toContain('approved');
    expect(v).not.toContain('rejected');
    expect(v).not.toContain('not_for_publication');
    expect(v).not.toContain('for_repurpose');
  });

  it('narrows to one status by its stored values', () => {
    expect(visibleStatusValues(DECLARED, 'approved').sort()).toEqual(['approved', 'ready']);
    expect(visibleStatusValues(DECLARED, 'posted').sort()).toEqual(['published', 'sent']);
  });

  it('skips a value the tenant does not declare, rather than asking for it', () => {
    expect(visibleStatusValues(['ready_for_review', 'approved', 'rejected'], 'scheduled')).toEqual([]);
    expect(visibleStatusValues(['ready_for_review', 'approved', 'rejected'])).toEqual(['ready_for_review', 'approved']);
  });
});

describe('transitions write the whole blob and keep what is already there', () => {
  const data = { blog: 'text', scopePath: '/ogmc', status: 'ready_for_review', topicRef: 't1' };

  it('Approve moves Draft to Approved', () => {
    const next = approveData(data);
    expect(next.status).toBe('approved');
    expect(next).toMatchObject({ blog: 'text', scopePath: '/ogmc', topicRef: 't1' });
  });

  it('picking a date moves Approved to Scheduled and stores it as UTC', () => {
    const next = scheduleData({ ...data, status: 'approved' }, new Date('2026-10-23T09:00:00-04:00'));
    expect(next.status).toBe('scheduled');
    expect(next.scheduledFor).toBe('2026-10-23T13:00:00.000Z');
    expect(next.scopePath).toBe('/ogmc');
  });

  it('un-scheduling goes back to Approved and clears the date', () => {
    const next = unscheduleData({ ...data, status: 'scheduled', scheduledFor: '2026-10-23T13:00:00.000Z' });
    expect(next.status).toBe('approved');
    expect(next.scheduledFor).toBe('');
  });

  it('Posted is set by hand, with the day it went out', () => {
    const next = markPostedData({ ...data, status: 'scheduled' }, new Date('2026-10-23T15:00:00Z'));
    expect(next.status).toBe('published');
    expect(next.sentAt).toBe('2026-10-23');
  });

  it('Reject sets status rejected, keeps the record and the topic, and stores the reason', () => {
    const next = rejectData(data, '  source says something else ');
    expect(next.status).toBe('rejected');
    expect(next.rejectReason).toBe('source says something else');
    expect(next).toMatchObject({ blog: 'text', topicRef: 't1', scopePath: '/ogmc' });
  });

  it('Reject without a reason is allowed and stores none', () => {
    expect(rejectData(data, '').rejectReason).toBeUndefined();
  });

  it('never touches the input object', () => {
    const frozen = Object.freeze({ ...data });
    expect(() => approveData(frozen)).not.toThrow();
    expect(() => rejectData(frozen, 'x')).not.toThrow();
  });
});

describe('what the item page offers', () => {
  it('a Draft shows Approve (primary) and Reject (secondary)', () => {
    expect(contentActions('draft')).toEqual([
      { id: 'approve', label: 'Approve', tone: 'primary' },
      { id: 'reject', label: 'Reject', tone: 'secondary' },
    ]);
  });

  it('never offers Send for review', () => {
    for (const s of ['draft', 'approved', 'scheduled', 'posted'] as const) {
      expect(contentActions(s).map((a) => a.label).join(' ')).not.toMatch(/review/i);
    }
  });

  it('Approved can be scheduled, rejected or marked posted', () => {
    expect(contentActions('approved').map((a) => a.id)).toEqual(['reject', 'mark-posted']);
  });

  it('Scheduled can be marked posted, nothing more', () => {
    expect(contentActions('scheduled').map((a) => a.id)).toEqual(['mark-posted']);
  });

  it('Posted has no actions', () => {
    expect(contentActions('posted')).toEqual([]);
  });
});

describe('scheduling', () => {
  const type = (names: string[], choices: string[]) => ({
    attributes: names.map((name) => ({ name, config: name === 'status' ? { choices } : {} })),
  });

  it('is offered on Approved and Scheduled only', () => {
    expect(schedulingAvailable('approved')).toBe(true);
    expect(schedulingAvailable('scheduled')).toBe(true);
    expect(schedulingAvailable('draft')).toBe(false);
    expect(schedulingAvailable('posted')).toBe(false);
  });

  it('is hidden when the tenant does not declare scheduled and scheduled_for', () => {
    expect(schedulingDeclared(type(['status', 'scheduled_for'], ['approved', 'scheduled']))).toBe(true);
    expect(schedulingDeclared(type(['status'], ['approved', 'scheduled']))).toBe(false);
    expect(schedulingDeclared(type(['status', 'scheduled_for'], ['approved']))).toBe(false);
    expect(schedulingDeclared(null)).toBe(false);
  });
});
