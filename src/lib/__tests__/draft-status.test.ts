/**
 * RED for the draft status vocabulary (bd startsim-wn2p.1).
 *
 * OGMC's "Content tracker/pipeline workflow" diagram names six states per
 * language. The tenant declares five, and only `approved` is shared. These
 * tests describe the vocabulary the workflow needs; wn2p.2 makes them pass by
 * declaring the enum and wn2p.3 moves the consumers onto it.
 *
 * Markers are keyed on the stub still throwing, per docs/design/VALIDATION.md
 * Stage 1 — so this file arms while `draft-status.ts` is a stub and disarms the
 * moment it is implemented. `it.fails` is strict in vitest: once the module
 * works, a still-marked test FAILS the build, so the markers cannot be left
 * behind.
 *
 * ENUM VALUES ARE NOT GUESSES. They are the team's own words from the diagram,
 * snake_cased. The live comparison values were read off the marketing-agents
 * schema endpoint on 2026-08-21:
 *   draft.status = drafting | ready | needs_revision | approved | sent
 */
import { describe, expect, it } from 'vitest';

import {
  DraftStatusNotImplementedError,
  declaredDraftStatuses,
  draftStatusLabel,
  draftStatuses,
  isTerminalStatus,
  missingRequiredStatuses,
  STATUS_ATTR,
} from '@/lib/draft-status';

const STILL_RED = (() => {
  try {
    draftStatuses();
    return false;
  } catch (err) {
    return err instanceof DraftStatusNotImplementedError;
  }
})();

/** `it` once implemented, `it.fails` while the stub throws. Strict both ways. */
const xit = STILL_RED ? it.fails : it;

/**
 * The seven, in pipeline order. Six come from the diagram; `published` was added
 * on the team's answer (2026-08-21) that a published state "should be" there —
 * without it the tracker cannot tell "approved, not yet posted" from "posted".
 */
const REQUIRED = [
  'ready_for_review',
  'under_review',
  'approved',
  'published',
  'rejected',
  'not_for_publication',
  'for_repurpose',
];

/** A type def shaped like the live one, so membership is read not assumed. */
function typeDef(choices: string[]) {
  return { attributes: [{ name: STATUS_ATTR, config: { choices } }] };
}

/** What marketing-agents declared when this RED was written. */
const LIVE_TODAY = typeDef(['drafting', 'ready', 'needs_revision', 'approved', 'sent']);

describe('the vocabulary the workflow needs', () => {
  xit('names all seven states the workflow needs', () => {
    expect(draftStatuses().map((s) => s.key)).toEqual(REQUIRED);
  });

  xit('uses the team’s own wording, not invented labels', () => {
    // These strings appear on screen, and matching the words the team already
    // says to each other is most of what makes a tracker legible to them.
    expect(draftStatusLabel('ready_for_review')).toBe('Ready for review');
    expect(draftStatusLabel('under_review')).toBe('Under review');
    expect(draftStatusLabel('not_for_publication')).toBe('Not for publication');
    expect(draftStatusLabel('for_repurpose')).toBe('For repurpose');
  });

  xit('still labels a status the tenant declares but we do not name', () => {
    // A tenant that adds a state should not see a raw enum key in the UI.
    expect(draftStatusLabel('awaiting_legal')).toBe('Awaiting legal');
  });
});

describe('terminal states — what leaves the tracker', () => {
  xit('treats the three dispositions as terminal', () => {
    // Diagram stages 3 and 6: these go to the content repository and are
    // removed from the tracker.
    expect(isTerminalStatus('rejected')).toBe(true);
    expect(isTerminalStatus('not_for_publication')).toBe(true);
    expect(isTerminalStatus('for_repurpose')).toBe(true);
  });

  xit('does not treat in-flight states as terminal', () => {
    expect(isTerminalStatus('ready_for_review')).toBe(false);
    expect(isTerminalStatus('under_review')).toBe(false);
  });

  xit('does NOT treat published as terminal', () => {
    // `terminal` means "shelved without publishing — goes to a disposition
    // library and leaves the tracker". Published work does the opposite: the
    // team asked for it to stay visible with its date and destination, so
    // marking it terminal would hide exactly the pieces they want shown.
    expect(isTerminalStatus('published')).toBe(false);
  });

  xit('does NOT treat approved as terminal', () => {
    // Approved is the opposite of finished: it is what FIRES the CN translation
    // (diagram stage 4). Marking it terminal would drop a piece off the tracker
    // exactly when its second-language half is about to begin.
    expect(isTerminalStatus('approved')).toBe(false);
  });
});

describe('membership comes from the live schema', () => {
  xit('reads the declared choices rather than a list in the code', () => {
    expect(declaredDraftStatuses(typeDef(['approved', 'rejected']))).toEqual([
      'approved',
      'rejected',
    ]);
  });

  xit('is empty when the type declares no status attribute', () => {
    expect(declaredDraftStatuses({ attributes: [] })).toEqual([]);
    expect(declaredDraftStatuses(null)).toEqual([]);
  });

  xit('reports nothing missing once the tenant declares all seven', () => {
    expect(missingRequiredStatuses(typeDef(REQUIRED))).toEqual([]);
  });

  xit('names exactly what today’s live schema cannot express', () => {
    // The gap, stated as data. `approved` is the only survivor.
    expect(missingRequiredStatuses(LIVE_TODAY)).toEqual([
      'ready_for_review',
      'under_review',
      'published',
      'rejected',
      'not_for_publication',
      'for_repurpose',
    ]);
  });

  xit('does not accept `ready` as `ready_for_review`', () => {
    // The trap this whole bead exists for. Today `ready` means "ready to post",
    // i.e. a human approved it. Treating the shared word as a match would
    // silently un-approve finished work during the migration.
    expect(missingRequiredStatuses(typeDef(['ready', 'approved']))).toContain('ready_for_review');
  });
});
