import { describe, expect, it } from 'vitest';

import { describeRevision } from '@/lib/content-history';

const rev = (changed: Record<string, { before?: unknown; after?: unknown }>, extra = {}) => ({
  id: 'r', version: 2, action: 'updated', actor_label: 'rita@x.com', created_at: '2026-11-05T02:00:00Z',
  metadata: { changed }, ...extra,
});

describe('describeRevision (bd startsim-bj3zz.3)', () => {
  it('reads each step of the item life as a sentence', () => {
    expect(describeRevision(rev({ linkedin: { before: 'a', after: 'b' } })).what).toBe('edited the text');
    expect(describeRevision(rev({ status: { before: 'ready_for_review', after: 'approved' } })).what).toBe('approved it');
    expect(describeRevision(rev({ status: { before: 'ready_for_review', after: 'rejected' } })).what).toBe('rejected it');
    expect(describeRevision(rev({ status: { before: 'approved', after: 'published' } })).what).toBe('marked it as posted');
    expect(describeRevision(rev({ status: { before: 'scheduled', after: 'approved' }, scheduled_for: { before: 'x', after: '' } })).what).toBe('unscheduled it');
  });

  it('says when it was scheduled for, in the given zone', () => {
    const r = describeRevision(
      rev({ status: { before: 'approved', after: 'scheduled' }, scheduled_for: { after: '2026-10-23T09:00:00.000Z' } }),
      'UTC',
    );
    expect(r.what).toBe('scheduled it for Fri 10/23, 9:00 AM');
  });

  it('a date change on its own is a reschedule; creation is "created it"', () => {
    expect(describeRevision(rev({ scheduled_for: { before: 'a', after: '2026-10-27T14:30:00.000Z' } }), 'UTC').what).toBe('changed the date to Tue 10/27, 2:30 PM');
    expect(describeRevision({ ...rev({}), action: 'created', version: 1 }).what).toBe('created it');
  });

  it('names the person, or the automation', () => {
    expect(describeRevision(rev({})).who).toBe('rita@x.com');
    expect(describeRevision(rev({}, { actor_kind: 'machine', actor_label: 'svc:n8n' })).who).toBe('Automation');
  });
});
