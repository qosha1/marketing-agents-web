/**
 * What an approver is told when the dispatch does not start (bd startsim-m7fdm.19,
 * constraint 6).
 *
 * THE CASE THIS EXISTS FOR IS `drafts_exist`, and it is a case where the right
 * answer is SILENCE. Re-approving a topic that already has a draft is not a
 * failure: the reviewer asked for nothing new, and the route's refusal ("Drafts
 * have already been written for this topic.") is a perfectly good explanation of
 * a button press and a nonsense red toast on an Approve click. The story page
 * they are being sent to is already about to list those drafts, or step straight
 * into the only one.
 *
 * EVERY OTHER REFUSAL MUST SPEAK, for the opposite reason: the reviewer has just
 * been told a draft is being written, and if it is not, a silent failure is the
 * six-hour wait this bead is about wearing a different hat.
 *
 * Pure, so all of it is decided here rather than in a browser.
 */
import { describe, expect, it } from 'vitest';

import { approvalDispatchRefusal } from '../approve-dispatch';

describe('approvalDispatchRefusal', () => {
  it('says NOTHING when the topic already has drafts', () => {
    expect(
      approvalDispatchRefusal(403, {
        reason: 'drafts_exist',
        error: 'Drafts have already been written for this topic.',
      }),
    ).toBeNull();
  });

  it('carries the route’s own reason for every other refusal', () => {
    // Preferred over anything invented here: it is the same sentence the drawer
    // already renders for the same refusal, so a reviewer who has seen one
    // recognises the other.
    expect(approvalDispatchRefusal(403, { reason: 'not_approved', error: 'Approve this topic to generate drafts.' })).toBe(
      'Approved, but the draft could not be started: Approve this topic to generate drafts.',
    );
    expect(approvalDispatchRefusal(502, { error: 'Could not verify the topic.' })).toBe(
      'Approved, but the draft could not be started: Could not verify the topic.',
    );
  });

  it('names the status when the body explains nothing', () => {
    // A bare status beats a shrug: "it didn't work" with no number is the report
    // nobody can act on.
    expect(approvalDispatchRefusal(500, null)).toBe(
      'Approved, but the draft could not be started (500).',
    );
    expect(approvalDispatchRefusal(502, {})).toBe(
      'Approved, but the draft could not be started (502).',
    );
    expect(approvalDispatchRefusal(502, { error: '   ' })).toBe(
      'Approved, but the draft could not be started (502).',
    );
    expect(approvalDispatchRefusal(400, { error: 42 })).toBe(
      'Approved, but the draft could not be started (400).',
    );
  });

  it('leads with "Approved" in every message it does produce', () => {
    // The approval SUCCEEDED — it is already saved by the time the dispatch is
    // attempted. A message that read as a failed approval would send the
    // reviewer back to press Approve again on a topic that is already ready.
    for (const status of [400, 401, 403, 500, 502]) {
      const message = approvalDispatchRefusal(status, { error: 'nope' });
      expect(message).not.toBeNull();
      expect(message).toMatch(/^Approved, but/);
    }
  });
});
