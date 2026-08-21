/**
 * RED for the automatic CN translation (bd startsim-wn2p.9).
 *
 * OGMC's "Content tracker/pipeline workflow" diagram, stage 4: "IF EN status =
 * Approved, generate CN translation and update CN status column to ready for
 * review." Nothing does that today. Translation exists and works — it is a
 * button a person presses — and `accept()` in `draft/[draftId]/page.tsx` writes
 * `status: 'approved'` and stops there. These tests describe the trigger;
 * wn2p.10 makes them pass.
 *
 * Markers are keyed on the stub still throwing, per docs/design/VALIDATION.md
 * Stage 1 — so this file arms while `approval-translation.ts` is a stub and
 * disarms the moment it is implemented. `it.fails` is strict in vitest: once the
 * module works, a still-marked test FAILS the build, so the markers cannot be
 * left behind. Assertions that already pass live in the unmarked companion,
 * `approval-translation.fixtures.test.ts`.
 *
 * THIS SUITE DEPENDS ON TWO STUBS, DELIBERATELY. The status the new draft lands
 * in comes from `draft-status.ts` (wn2p.2), which is also a stub. That is the
 * real ordering — wn2p.10 cannot land before wn2p.2 — and it is visible rather
 * than assumed: implement THIS module first and the status tests fail loudly
 * with `DraftStatusNotImplementedError` instead of quietly passing on a literal.
 *
 * FIELD NAMES ARE NOT GUESSES. The draft fixture below is the same live-read
 * shape `draft-translation.test.ts` documents — read off the marketing-agents
 * tenant on 2026-08-19 by ECS exec inside `org_scope("marketing-agents")`:
 *   draft attrs — content_type(enum), candidate_index(int), blog(longtext),
 *   linkedin(longtext), seo(json), sources(json), judge_verdict(json),
 *   auto_checks(json), chosen(bool), status(enum), sent_at(date),
 *   lang(enum: en|ar — `zh` added since, and both an `ar` and a `zh`
 *   translation were produced live on 2026-08-19), assignee_sub(text),
 *   assignee_name(text)
 *   rel defs — grounded_by, for_client, written_for, translation_of
 */
import { describe, expect, it } from 'vitest';

import {
  APPROVED_STATUS,
  AutoTranslationNotImplementedError,
  CREATED_DRAFT,
  runApprovalTranslation,
  translationOnApproval,
  translationWrites,
  type ApprovalContext,
  type ApprovalDeps,
  type ApprovalWrite,
  type TranslationRequest,
} from '@/lib/approval-translation';
import { draftStatuses } from '@/lib/draft-status';
import { TRANSLATED_STATUS } from '@/lib/draft-translation';
import { DRAFT_TYPE, TRANSLATION_OF } from '@/lib/topic-drafts';
import type { EntityRecord, EntityTypeDef } from '@/lib/foundry-api';

/** The language the pipeline writes in, and the one the team asked us to add. */
const SOURCE_LANG = 'en';
const TARGET_LANG = 'zh';

/**
 * The third declared locale — the one the team did NOT ask for. It is in the
 * enum and an `ar` translation shipped live on 2026-08-19, so every wrong
 * version of this trigger produces one. It is a fixture value here precisely so
 * that "we never made an Arabic draft" is an assertion rather than a hope.
 */
const OTHER_LANG = 'ar';

/**
 * The team's word for where a fresh CN draft lands, from the diagram and from
 * their spreadsheet ("If EN = Approved -> CN status becomes 'Ready to review'").
 * Spelled here, in the spec, exactly as `draft-status.test.ts` spells the other
 * five — the coupling test below is what stops the MODULE spelling it too.
 */
const READY_FOR_REVIEW = 'ready_for_review';

function draft(over: Partial<EntityRecord> & { data?: Record<string, unknown> }): EntityRecord {
  return {
    id: 114,
    entityType: DRAFT_TYPE,
    externalId: 'draft-114',
    name: 'Gulf logistics rebound',
    createdAt: '2026-08-20',
    ...over,
    data: {
      content_type: 'weekly_brief',
      topic_ref: 42,
      candidate_index: 2,
      chosen: true,
      status: APPROVED_STATUS,
      lang: SOURCE_LANG,
      blog: 'Revenue grew 12.5% across the corridor.',
      linkedin: 'A short post about the corridor.',
      seo: { meta_description: 'How the corridor recovered.', tags: 'logistics,gulf' },
      sources: ['https://reuters.com/a', 'https://ft.com/b'],
      judge_verdict: { score: 8 },
      auto_checks: { ok: true },
      assignee_sub: 'sub-nordby',
      assignee_name: 'nordby@ogmc.ai',
      ...(over.data ?? {}),
    },
  } as EntityRecord;
}

/** The English original, freshly approved. */
const EN = draft({});

/** Its Chinese half, once it exists. */
const ZH = draft({
  id: 115,
  name: '海湾物流复苏',
  data: { lang: TARGET_LANG, status: READY_FOR_REVIEW },
});

/** An Arabic sibling — the language group is not always just two rows. */
const AR = draft({
  id: 116,
  name: 'انتعاش الخدمات اللوجستية',
  data: { lang: OTHER_LANG, status: READY_FOR_REVIEW },
});

/** A draft type declaring the locales the live tenant declares. */
function draftType(choices: string[] = [SOURCE_LANG, OTHER_LANG, TARGET_LANG]): EntityTypeDef {
  return {
    key: DRAFT_TYPE,
    attributes: [
      { name: 'status', dataType: 'enum', config: { choices: ['drafting', APPROVED_STATUS] } },
      { name: 'lang', dataType: 'enum', config: { choices } },
    ],
  } as unknown as EntityTypeDef;
}

function ctx(over: Partial<ApprovalContext> = {}): ApprovalContext {
  return {
    draft: EN,
    nextStatus: APPROVED_STATUS,
    group: [EN],
    draftType: draftType(),
    ...over,
  };
}

const STILL_RED = (() => {
  try {
    translationOnApproval(ctx());
    return false;
  } catch (err) {
    return err instanceof AutoTranslationNotImplementedError;
  }
})();

/** `it` once implemented, `it.fails` while the stub throws. Strict both ways. */
const xit = STILL_RED ? it.fails : it;

/** What the model gave back, keyed by the segment ids `draftSegments` emits. */
const TRANSLATED = new Map([
  ['name', '海湾物流复苏'],
  ['blog', '该走廊的收入增长了 12.5%。'],
  ['linkedin', '一篇关于该走廊的短文。'],
  ['seo.meta_description', '该走廊如何复苏。'],
]);

/** The decision, spelled out, so the write tests don't depend on the decider. */
const REQUEST: TranslationRequest = {
  draftId: EN.id,
  sourceLocale: SOURCE_LANG,
  targetLocale: TARGET_LANG,
  status: READY_FOR_REVIEW,
};

type CreateWrite = Extract<ApprovalWrite, { kind: 'create-draft' }>;
type LinkWrite = Extract<ApprovalWrite, { kind: 'link' }>;

const creates = (writes: ApprovalWrite[]): CreateWrite[] =>
  writes.filter((w): w is CreateWrite => w.kind === 'create-draft');
const links = (writes: ApprovalWrite[]): LinkWrite[] =>
  writes.filter((w): w is LinkWrite => w.kind === 'link');

describe('what an approval decides', () => {
  xit('turns an approved EN draft into exactly one CN translation', () => {
    // The whole bead, in one assertion: the approval is what asks for it.
    expect(translationOnApproval(ctx())).toEqual({
      draftId: EN.id,
      sourceLocale: SOURCE_LANG,
      targetLocale: TARGET_LANG,
      status: READY_FOR_REVIEW,
    });
  });

  xit('starts the CN draft at ready for review, not at drafting', () => {
    // The team's spreadsheet: "If EN = Approved -> CN status becomes 'Ready to
    // review'." The manual button's TRANSLATED_STATUS is 'drafting', which on
    // this path would leave the Chinese half sitting outside the review queue
    // it was created to enter.
    expect(translationOnApproval(ctx())?.status).toBe(READY_FOR_REVIEW);
    expect(translationOnApproval(ctx())?.status).not.toBe(TRANSLATED_STATUS);
  });

  xit('takes that status from the vocabulary module, not from a word of its own', () => {
    // wn2p.2 owns the words. If this module spelled 'ready_for_review' itself, a
    // rename there would leave translations landing in a status the tracker no
    // longer has, and nothing would fail until someone noticed the CN column was
    // empty. Membership, not position: inserting a seventh state must not break
    // this.
    const status = translationOnApproval(ctx())?.status;
    expect(draftStatuses().map((s) => s.key)).toContain(status);
  });

  xit('does nothing for any status that is not an approval', () => {
    // Stages 2 and 5 both move a draft without approving it.
    for (const status of ['drafting', 'ready_for_review', 'under_review', 'needs_revision', '']) {
      expect(translationOnApproval(ctx({ nextStatus: status }))).toBeNull();
    }
  });

  xit('does nothing when the group already has its CN half', () => {
    // Idempotence, keyed on the drafts that actually exist rather than on a flag
    // that can disagree with them. Approving twice, or retrying a job that
    // already ran, must not leave a reviewer choosing between two Chinese
    // drafts.
    //
    // THE SHARP EDGE: `translatableTargets(['en','ar','zh'], ['en','zh'])` is
    // ['ar'] — NOT empty. A guard that asks "is anything still translatable?"
    // and takes the first answer quietly produces an ARABIC draft on the second
    // approval. The guard has to be membership of the target language.
    expect(translationOnApproval(ctx({ group: [EN, ZH] }))).toBeNull();
    expect(translationOnApproval(ctx({ group: [EN, ZH, AR] }))).toBeNull();
  });

  xit('still produces CN when only some OTHER language exists', () => {
    // The same guard from the other side: an `ar` translation is not a `zh` one,
    // so an approved EN draft that has only been translated into Arabic still
    // owes the team its Chinese half.
    expect(translationOnApproval(ctx({ group: [EN, AR] }))?.targetLocale).toBe(TARGET_LANG);
  });

  xit('does not fan out to every language the tenant declares', () => {
    // `ar` is in the enum and a live `ar` translation was produced on
    // 2026-08-19. The team asked for Chinese. One approval, one translation.
    expect(translationOnApproval(ctx())?.targetLocale).toBe(TARGET_LANG);
    expect(translationOnApproval(ctx())?.targetLocale).not.toBe(OTHER_LANG);
  });

  xit('does nothing when the CN draft itself is approved', () => {
    // Diagram stage 6 approves the Chinese half too, through the same status
    // write. Without a source-language guard that approval sees a group of
    // {en, zh}, finds `ar` still on offer, and translates the Chinese draft into
    // Arabic — the back door into exactly the fan-out above.
    expect(translationOnApproval(ctx({ draft: ZH, group: [EN, ZH] }))).toBeNull();
  });

  xit('does nothing when the tenant has not declared the target language', () => {
    // A write the backend would reject is not worth attempting. Declaring a
    // language stays a schema change (startsim-jb1z), so this is how a tenant
    // that has not made one opts out.
    expect(
      translationOnApproval(ctx({ draftType: draftType([SOURCE_LANG, OTHER_LANG]) })),
    ).toBeNull();
    expect(translationOnApproval(ctx({ draftType: null }))).toBeNull();
  });
});

describe('the writes an approved draft produces', () => {
  xit('creates exactly one draft and exactly one link', () => {
    const writes = translationWrites(EN, TRANSLATED, REQUEST);

    expect(creates(writes)).toHaveLength(1);
    expect(links(writes)).toHaveLength(1);
    expect(writes).toHaveLength(2);
  });

  xit('writes the translated prose into a new CN draft at ready for review', () => {
    const [created] = creates(translationWrites(EN, TRANSLATED, REQUEST));

    expect(created.entityType).toBe(DRAFT_TYPE);
    expect(created.name).toBe('海湾物流复苏');
    expect(created.data.blog).toBe('该走廊的收入增长了 12.5%。');
    expect(created.data.lang).toBe(TARGET_LANG);
    expect(created.data.status).toBe(READY_FOR_REVIEW);
  });

  xit('carries the classification across so the CN half lands in its own section', () => {
    // startsim-ylbz: a lead_magnet translation that says weekly_brief is
    // invisible in its own content tab.
    const source = draft({ data: { content_type: 'lead_magnet' } });
    const [created] = creates(translationWrites(source, TRANSLATED, REQUEST));

    expect(created.data.content_type).toBe('lead_magnet');
  });

  xit('does NOT inherit the source draft review state or its assignee', () => {
    // A judge verdict copied across shows a score for text the judge never saw,
    // and a copied assignee silently hands someone work they did not take — a
    // translation is new work for a reviewer, which is the whole reason it lands
    // at ready_for_review rather than approved.
    const [created] = creates(translationWrites(EN, TRANSLATED, REQUEST));

    for (const key of [
      'judge_verdict',
      'auto_checks',
      'chosen',
      'candidate_index',
      'sent_at',
      'assignee_sub',
      'assignee_name',
    ]) {
      expect(created.data).not.toHaveProperty(key);
    }
  });

  xit('links the new draft TO the original, in that direction', () => {
    // Direction is load-bearing: `originalOfTranslation` follows the edge
    // OUTGOING from the translation and `draftLanguageGroup` is built on it.
    // Backwards, the pair still has an edge and the language switcher is still
    // empty.
    const [link] = links(translationWrites(EN, TRANSLATED, REQUEST));

    expect(link).toEqual({
      kind: 'link',
      relType: TRANSLATION_OF,
      source: CREATED_DRAFT,
      target: EN.id,
    });
  });

  xit('never writes to the source draft', () => {
    // It is already approved. Anything this plan does to it is a chance to
    // un-approve it (bd startsim-i3so).
    const writes = translationWrites(EN, TRANSLATED, REQUEST);

    expect(links(writes).map((w) => w.source)).toEqual([CREATED_DRAFT]);
    expect(creates(writes).map((w) => w.data.lang)).toEqual([TARGET_LANG]);
  });

  xit('does not mutate the source draft', () => {
    translationWrites(EN, TRANSLATED, REQUEST);

    expect(EN.name).toBe('Gulf logistics rebound');
    expect(EN.data.lang).toBe(SOURCE_LANG);
    expect(EN.data.status).toBe(APPROVED_STATUS);
  });
});

/** A recording double for the three side effects, with a scriptable failure. */
interface Recorder extends ApprovalDeps {
  calls: string[];
  written: ApprovalWrite[][];
  approved: boolean;
}

function deps(over: Partial<Pick<ApprovalDeps, 'translate' | 'write'>> = {}): Recorder {
  const rec: Recorder = {
    calls: [],
    written: [],
    approved: false,
    approve: async () => {
      rec.calls.push('approve');
      // A real PATCH is not instantaneous, and settling on a later tick is what
      // makes "the approval finished before the model was asked" a real
      // assertion rather than an artifact of synchronous test doubles.
      await Promise.resolve();
      rec.approved = true;
    },
    translate: async () => {
      rec.calls.push('translate');
      return TRANSLATED;
    },
    write: async (writes) => {
      rec.calls.push('write');
      rec.written.push(writes);
    },
    ...over,
  };
  return rec;
}

describe('the approval survives a failed translation (bd startsim-i3so)', () => {
  xit('approves, translates and writes, in that order', async () => {
    const d = deps();

    const outcome = await runApprovalTranslation(ctx(), d);

    expect(d.calls).toEqual(['approve', 'translate', 'write']);
    expect(outcome).toEqual({ approved: true, translation: 'created' });
  });

  xit('finishes the approval BEFORE it asks the model for anything', async () => {
    // The ordering i3so was written about: a notification threw on a sibling
    // branch, the persistence branch never ran, and eight days of content were
    // destroyed. A translation is the secondary action here; it cannot sit
    // upstream of the thing it is secondary to.
    const d = deps();
    let approvedWhenAsked: boolean | null = null;
    d.translate = async () => {
      approvedWhenAsked = d.approved;
      return TRANSLATED;
    };

    await runApprovalTranslation(ctx(), d);

    expect(approvedWhenAsked).toBe(true);
  });

  xit('leaves the draft approved when the model call dies', async () => {
    const d = deps({
      translate: async () => {
        throw new Error('provider unavailable');
      },
    });

    const outcome = await runApprovalTranslation(ctx(), d);

    expect(d.approved).toBe(true);
    expect(outcome).toEqual({ approved: true, translation: 'failed' });
    expect(d.written).toEqual([]);
  });

  xit('leaves the draft approved when the translation write dies', async () => {
    const d = deps({
      write: async () => {
        throw new Error('tenant POST entities responded 500');
      },
    });

    const outcome = await runApprovalTranslation(ctx(), d);

    expect(d.approved).toBe(true);
    expect(outcome).toEqual({ approved: true, translation: 'failed' });
  });

  xit('asks the model for nothing when nothing is owed', async () => {
    // A translation costs a provider call. Approving the CN half, or re-saving
    // an already-translated EN draft, must not spend one.
    const d = deps();

    const outcome = await runApprovalTranslation(ctx({ group: [EN, ZH] }), d);

    expect(d.calls).toEqual(['approve']);
    expect(outcome).toEqual({ approved: true, translation: 'none' });
  });

  xit('produces nothing new on a retry', async () => {
    // Idempotence the way a retry actually arrives: the first run created the CN
    // draft, so the second run sees it in the group.
    const first = deps();
    await runApprovalTranslation(ctx(), first);

    const second = deps();
    const outcome = await runApprovalTranslation(ctx({ group: [EN, ZH] }), second);

    expect(second.written).toEqual([]);
    expect(outcome.translation).toBe('none');
  });
});
