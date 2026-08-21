/**
 * RED for draft title durability (bd startsim-wn2p.16).
 *
 * The tracker asks that an AI-written title "be able to be updated if changes
 * are made in human review stage". These tests describe the guarantee the
 * second half of that needs: an AI write aimed at a draft a human has already
 * edited must not put the AI's words back.
 *
 * Markers are keyed on the stub still throwing, per the house Stage-1 pattern
 * (`draft-status.ts` is the worked example) — this file arms while
 * `title-durability.ts` is a stub and disarms the moment it is implemented.
 * `it.fails` is strict in vitest: once the module works, a still-marked test
 * FAILS the build, so the markers cannot be left behind.
 *
 * NOTHING HERE IS GUESSED. Every expectation below was measured against the
 * live marketing-agents tenant on 2026-08-21 — the endpoint split, the 400 on a
 * duplicate `external_id`, the `data` merge, and the `name` assignment that the
 * merge does not cover. The module docstring records each measurement.
 *
 * NOT A DUPLICATE of startsim-5fwa / fobz / 53wk. Those cover TOPICS, where the
 * re-rank agent resends `title`/`angle` every run and the fix is to stop
 * resending them. Drafts differ in two ways that need their own proof: the
 * writer talks to the CREATE endpoint rather than the merging one, and a
 * draft's title is the `name` COLUMN, which the merge does not protect at all.
 */
import { describe, expect, it } from 'vitest';

import type { EntityRecord } from '@/lib/foundry-api';
import {
  aiRewritePayload,
  applyUpsert,
  draftExternalId,
  slugForHeadline,
  TITLE_DATA_FIELDS,
  TITLE_NAME_FIELD,
  TitleDurabilityNotImplementedError,
  titleWasRenamed,
  type DraftWrite,
} from '@/lib/title-durability';

const STILL_RED = (() => {
  try {
    aiRewritePayload(
      { id: 1, entityType: 'draft', externalId: 'x', name: 'x', data: {}, createdAt: '' },
      { entity_type: 'draft', external_id: 'x', data: {} },
      [],
    );
    return false;
  } catch (err) {
    return err instanceof TitleDurabilityNotImplementedError;
  }
})();

/** `it` once implemented, `it.fails` while the stub throws. Strict both ways. */
const xit = STILL_RED ? it.fails : it;

/** Every title piece a human can edit, `name` column included. */
const ALL_TITLE_PIECES = [TITLE_NAME_FIELD, ...TITLE_DATA_FIELDS];

/** A real headline from the live tenant, with the slug the writer stored for it. */
const LIVE_HEADLINE = 'UAE-China Trade Links Improve Entry Options but Not Execution';
const LIVE_SLUG = 'uae-china-trade-links-improve-entry-options-but-not-execution';

function draft(over: Partial<EntityRecord> = {}): EntityRecord {
  return {
    id: 1,
    entityType: 'draft',
    externalId: LIVE_SLUG,
    name: LIVE_HEADLINE,
    data: {
      content_type: 'weekly_brief',
      status: 'drafting',
      story_title: LIVE_HEADLINE,
      subheadline: 'What the AI wrote underneath it.',
      angle: 'Practical implications for foreign operators',
      blog: 'AI body v1',
      _origin: 'n8n-weekly-writer',
    },
    createdAt: '2026-08-19T00:00:00Z',
    ...over,
  };
}

/** The same draft after a human rewrote all four title pieces in the drawer. */
function humanEdited(): EntityRecord {
  const d = draft();
  return {
    ...d,
    name: 'Gulf Entry Is Easier; Execution Is Not',
    data: {
      ...d.data,
      story_title: 'Gulf Entry Is Easier; Execution Is Not',
      subheadline: 'The subhead the team actually wants to publish.',
      angle: 'Risks and what to watch',
    },
  };
}

/** What the writer would POST on a later run — its own headline, its own slug. */
function aiWrite(headline = LIVE_HEADLINE): DraftWrite {
  return {
    entity_type: 'draft',
    external_id: LIVE_SLUG,
    name: headline,
    data: {
      content_type: 'weekly_brief',
      status: 'drafting',
      story_title: headline,
      subheadline: 'What the AI wrote underneath it.',
      angle: 'Practical implications for foreign operators',
      blog: 'AI body v2 — genuinely improved',
      seo: { primary_keyword: 'UAE China trade' },
      _origin: 'n8n-weekly-writer',
    },
  };
}

describe('the title pieces an AI write must leave alone', () => {
  xit('omits the top-level name — merge does NOT protect it', () => {
    // The measurement this whole bead turns on. `_upsert_one` merges `data` but
    // runs `if name is not None: entity.name = name`, so a payload that drops
    // the three data keys and still carries `name` loses the title anyway.
    // A startsim-fobz-shaped fix stops one field short for drafts.
    const payload = aiRewritePayload(humanEdited(), aiWrite(), ALL_TITLE_PIECES);
    expect(payload).not.toHaveProperty('name');
  });

  xit('omits the three title keys inside data, so merge preserves them', () => {
    const payload = aiRewritePayload(humanEdited(), aiWrite(), ALL_TITLE_PIECES);
    for (const field of TITLE_DATA_FIELDS) {
      expect(payload.data).not.toHaveProperty(field);
    }
  });

  xit('still lets the AI update everything it does own', () => {
    // The guard must not freeze the whole record — a re-write should still be
    // able to improve the body, the SEO block and the status. Protecting the
    // title by refusing the write outright would be a worse bug.
    const payload = aiRewritePayload(humanEdited(), aiWrite(), ALL_TITLE_PIECES);
    expect(payload.data.blog).toBe('AI body v2 — genuinely improved');
    expect(payload.data.seo).toEqual({ primary_keyword: 'UAE China trade' });
    expect(payload.data.status).toBe('drafting');
  });

  xit('drops only the pieces the caller says are owned', () => {
    // Owned-ness is an input, not a guess (see the module docstring). A caller
    // that claims only the subheadline gets the rest of the AI's title back.
    const payload = aiRewritePayload(humanEdited(), aiWrite(), ['subheadline']);
    expect(payload.data).not.toHaveProperty('subheadline');
    expect(payload.data.story_title).toBe(LIVE_HEADLINE);
    expect(payload.name).toBe(LIVE_HEADLINE);
  });
});

describe('the write has to land on the row the human edited', () => {
  xit('addresses the stored external_id, not a slug of the new headline', () => {
    // The writer derives `external_id` from whatever headline the model emitted
    // THIS run. Re-deriving it means a paraphrased headline addresses a row that
    // does not exist — which is how one story ends up with two sets of
    // candidates instead of one updated set.
    const payload = aiRewritePayload(
      humanEdited(),
      aiWrite('Gulf Entry Improves While Execution Risk Persists'),
      ALL_TITLE_PIECES,
    );
    expect(payload.external_id).toBe(LIVE_SLUG);
  });

  xit('keeps addressing the original slug after a human rename', () => {
    // A rename does not move the row: `external_id` is fixed at create. The
    // payload must follow the row, not the new name.
    const edited = humanEdited();
    expect(slugForHeadline(edited.name)).not.toBe(edited.externalId);
    expect(aiRewritePayload(edited, aiWrite(), ALL_TITLE_PIECES).external_id).toBe(LIVE_SLUG);
  });
});

describe('the round trip the acceptance criterion asks for', () => {
  xit('write → human edit → AI re-write leaves the human’s four pieces standing', () => {
    // Exactly the bead AC, run through the tenant's own merge semantics.
    const edited = humanEdited();
    const after = applyUpsert(edited, aiRewritePayload(edited, aiWrite(), ALL_TITLE_PIECES));

    expect(after.name).toBe('Gulf Entry Is Easier; Execution Is Not');
    expect(after.data.story_title).toBe('Gulf Entry Is Easier; Execution Is Not');
    expect(after.data.subheadline).toBe('The subhead the team actually wants to publish.');
    expect(after.data.angle).toBe('Risks and what to watch');
    // and the AI's improvement still landed
    expect(after.data.blog).toBe('AI body v2 — genuinely improved');
  });

  xit('an UNGUARDED write is what loses it — this is the measured clobber', () => {
    // The control. Sending the writer's payload as-is at `/entities/upsert/`
    // reverted all four pieces on the live tenant; `applyUpsert` has to model
    // that faithfully or the test above proves nothing.
    const after = applyUpsert(humanEdited(), aiWrite());

    expect(after.name).toBe(LIVE_HEADLINE);
    expect(after.data.story_title).toBe(LIVE_HEADLINE);
    expect(after.data.subheadline).toBe('What the AI wrote underneath it.');
    expect(after.data.angle).toBe('Practical implications for foreign operators');
  });

  xit('leaves a data key the payload never mentions alone', () => {
    // The merge half of the semantics, which is what makes omission a fix at
    // all. `_origin` and `content_type` are resent; `chosen` is not.
    const edited = { ...humanEdited() };
    edited.data = { ...edited.data, chosen: true };
    const after = applyUpsert(edited, aiRewritePayload(edited, aiWrite(), ALL_TITLE_PIECES));
    expect(after.data.chosen).toBe(true);
  });

  xit('protects a draft that has no verdict field to key a freeze on', () => {
    // The topic side freezes text when `team_verdict === 'good'`. Drafts carry
    // no verdict at all, so that workaround cannot be ported — the guard has to
    // hold without one.
    const edited = humanEdited();
    expect(edited.data).not.toHaveProperty('team_verdict');
    const after = applyUpsert(edited, aiRewritePayload(edited, aiWrite(), ALL_TITLE_PIECES));
    expect(after.name).toBe('Gulf Entry Is Easier; Execution Is Not');
  });
});

describe('the slug, reproduced from the writer node', () => {
  xit('matches the external_id the writer actually stored', () => {
    // 75 of 75 robot-written drafts satisfy this live.
    expect(slugForHeadline(LIVE_HEADLINE)).toBe(LIVE_SLUG);
  });

  xit('lowercases, collapses punctuation to single dashes, and trims them', () => {
    expect(slugForHeadline('Bahrain Cuts Registration Steps — Foreign-Owned Setups')).toBe(
      'bahrain-cuts-registration-steps-foreign-owned-setups',
    );
    expect(slugForHeadline('  ...Leading & trailing!  ')).toBe('leading-trailing');
  });

  xit('caps at 80 characters, as the node does', () => {
    expect(slugForHeadline('a'.repeat(200)).length).toBe(80);
  });

  xit('collapses a headline with no slug characters to the empty string', () => {
    // Honest, not convenient. A CJK or Arabic title has nothing to slug, and
    // pretending otherwise would hide the hazard below.
    expect(slugForHeadline('中文标题')).toBe('');
  });
});

describe('the writer’s fallbacks, which a bare slug cannot express', () => {
  xit('falls back to draft-<n> when the headline slugifies to nothing', () => {
    // `slice(0,80) || ('draft-'+(i+1))`. This is why the node carries the
    // candidate ordinal and `slugForHeadline` alone cannot reproduce it.
    expect(draftExternalId('中文标题', 2)).toBe('draft-2');
  });

  xit('falls back to cand-<n> when there is no headline at all', () => {
    // A different fallback from the one above: the node slugifies
    // `headline || 'cand-'+(i+1)` BEFORE testing the result for emptiness.
    expect(draftExternalId('', 1)).toBe('cand-1');
  });

  xit('is the plain slug whenever the headline has one', () => {
    expect(draftExternalId(LIVE_HEADLINE, 1)).toBe(LIVE_SLUG);
  });

  xit('never yields the empty string, which the unique constraint exempts', () => {
    // `condition=~Q(external_id="")` — an empty external_id is exempt from
    // uniqueness, so it silently stops de-duplicating. Two live drafts (both
    // translations) sit in exactly that state, so this is not hypothetical.
    for (const headline of ['', '中文标题', '   ', '!!!', 'يتطلب تأسيس']) {
      expect(draftExternalId(headline, 3)).not.toBe('');
    }
  });
});

describe('detecting a rename without a provenance field', () => {
  xit('reports a pristine robot draft as unrenamed', () => {
    expect(titleWasRenamed(draft())).toBe(false);
  });

  xit('reports a human-renamed draft as renamed', () => {
    expect(titleWasRenamed(humanEdited())).toBe(true);
  });

  xit('does not call a draft with no external_id renamed', () => {
    // Two live drafts carry `external_id: ''`. They were never slugged, so
    // there is no baseline to have drifted from.
    expect(titleWasRenamed(draft({ externalId: '' }))).toBe(false);
  });
});
