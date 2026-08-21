/**
 * What approving an EN draft must CAUSE (bd startsim-wn2p.9 / .10).
 *
 * STUB — every function throws until wn2p.10 implements it. The RED suite keys
 * its `it.fails` markers on {@link AutoTranslationNotImplementedError}, so it
 * arms and disarms itself; nothing has to be deleted to go green.
 *
 * WHY THIS FILE EXISTS. OGMC's "Content tracker/pipeline workflow" diagram,
 * stage 4: "IF EN status = Approved, generate CN translation and update CN
 * status column to ready for review." Today nothing fires on approval —
 * translation is a button a human presses (`/actions/translate-draft`), and
 * `accept()` in `draft/[draftId]/page.tsx` just writes `status: 'approved'` and
 * moves on. The team's spreadsheet (wn2p epic NOTES) says the same thing in
 * their own words: "If EN = Approved -> CN status becomes 'Ready to review'."
 *
 * WHAT IS DELIBERATELY NOT REBUILT HERE. The payload half already exists and is
 * tested: `draft-translation.ts` owns segment extraction, reassembly, the
 * carried-across fields and the not-inherited ones, and `translatableTargets`
 * already refuses a language the group has. This module is the TRIGGER and
 * nothing else — the decision, the write plan, and the failure posture.
 *
 * THREE THINGS THE CONTRACT IS SHAPED BY:
 *
 *  1. APPROVAL HAS TWO CALL SITES, not one. `accept()` in the draft editor, and
 *     the kanban drag in `entity-board.tsx` (which PATCHes the status attr
 *     directly). {@link translationOnApproval} is therefore a pure function of a
 *     context object — no fetching, no hooks, no router — so both can call it.
 *
 *  2. THE SECONDARY ACTION MUST NEVER DESTROY THE PRIMARY ONE (bd startsim-i3so,
 *     measured: a dead Gmail credential on a sibling branch destroyed eight days
 *     of content because a NOTIFICATION threw before the persistence branch ran).
 *     So the approval is written FIRST and a translation failure is a logged
 *     outcome, never a throw and never a rollback. That posture is pinned by
 *     {@link runApprovalTranslation}, not left to a comment.
 *
 *  3. THE GUARD IS THE GROUP, NOT A FLAG. "Has this already been translated?" is
 *     answered by looking at the language group — the same question
 *     `translatableTargets` already answers for the manual button. A new
 *     `translation_requested` boolean would be a second source of truth that can
 *     disagree with the drafts that actually exist.
 *
 * TWO NOTES FOR wn2p.10, both of them real decisions this RED does not make:
 *
 *  - WHERE `zh` COMES FROM. `startsim-jb1z` bans naming a language in app code,
 *    which is why `draft-translation.ts` names none and the manual route takes
 *    the locale from the request body. An automatic trigger has no request body,
 *    so the en->zh pair has to live SOMEWHERE — configuration, in the shape
 *    `translation-config.ts` already uses, is the obvious answer. This RED pins
 *    the BEHAVIOUR (an approved `en` draft yields exactly one `zh` draft, and
 *    never an `ar` one) and leaves the mechanism to the GREEN.
 *
 *  - THE `TRANSLATED_STATUS` COLLISION. `applyDraftTranslations` stamps
 *    `'drafting'`, and `draft-translation.test.ts` has a PASSING assertion that
 *    `TRANSLATED_STATUS === 'drafting'`. The automatic path must land at
 *    `ready_for_review` (wn2p.2's vocabulary), which is why the status travels
 *    as plan DATA on {@link TranslationRequest} rather than being read off that
 *    constant. wn2p.10 has to reconcile the two; what the MANUAL button should
 *    stamp is out of scope for wn2p.9.
 */
import type { EntityRecord, EntityTypeDef } from '@/lib/foundry-api';

/** Thrown by every function while this module is still a stub. */
export class AutoTranslationNotImplementedError extends Error {
  constructor(what: string) {
    super(`${what} is not implemented — bd startsim-wn2p.10`);
    this.name = 'AutoTranslationNotImplementedError';
  }
}

/**
 * The status whose arrival fires the trigger.
 *
 * The one word the live enum and the team's vocabulary share — wn2p.1 measured
 * the overlap and `approved` is the only survivor — so this constant is stable
 * across the wn2p.2 migration in a way none of the other five states are.
 */
export const APPROVED_STATUS = 'approved';

/**
 * Stands in for "the draft that the create write returns", in the link write.
 *
 * The plan is composed BEFORE anything is persisted, so the edge cannot name an
 * id that does not exist yet. A sentinel keeps the plan a pure value that can be
 * asserted whole, instead of forcing the caller to hand-build the second write.
 */
export const CREATED_DRAFT = '@created';

/** Everything the decision needs. Gathered by the caller; never fetched here. */
export interface ApprovalContext {
  /** The draft whose status is changing. */
  draft: EntityRecord;
  /** The status it is moving TO. Only {@link APPROVED_STATUS} fires anything. */
  nextStatus: string;
  /**
   * Every draft in this draft's language group, including itself — what
   * `draftLanguageGroup(draft, relationships, drafts)` returns. This is the
   * idempotence guard's evidence: a group that already holds the target
   * language has already been translated.
   */
  group: EntityRecord[];
  /**
   * The `draft` type def, for its declared `lang` choices. A tenant that has not
   * declared the target language cannot store one, so the answer is "do
   * nothing" rather than a write the backend will reject.
   */
  draftType: EntityTypeDef | null | undefined;
}

/** A translation the approval has decided to produce. */
export interface TranslationRequest {
  /** The draft being translated FROM. */
  draftId: EntityRecord['id'];
  sourceLocale: string;
  targetLocale: string;
  /**
   * The status the NEW draft is created in — `ready_for_review`, from wn2p.2's
   * vocabulary. Carried as data so the automatic path and the manual button can
   * differ without either one hardcoding the other's answer.
   */
  status: string;
}

/**
 * One persistence step. The plan is a VALUE so the whole of it can be asserted:
 * "exactly one create and exactly one link" is a length check, not an
 * archaeology exercise over a mock's call log.
 */
export type ApprovalWrite =
  | {
      kind: 'create-draft';
      entityType: string;
      name: string;
      data: Record<string, unknown>;
    }
  | {
      kind: 'link';
      relType: string;
      /** {@link CREATED_DRAFT} — resolved to the new draft's id by the caller. */
      source: string;
      target: EntityRecord['id'];
    };

/** What actually happened, for the log line and for the caller's UI. */
export interface ApprovalOutcome {
  /** The PRIMARY action. True whenever the approval itself persisted. */
  approved: boolean;
  /** 'none' when nothing was owed, 'failed' when it was owed and did not land. */
  translation: 'none' | 'created' | 'failed';
}

/** The side effects {@link runApprovalTranslation} is allowed to have. */
export interface ApprovalDeps {
  /** Persist the approval. The primary action; runs first and alone. */
  approve(ctx: ApprovalContext): Promise<void>;
  /** Ask the model. Slow and allowed to fail. */
  translate(request: TranslationRequest): Promise<ReadonlyMap<string, string>>;
  /** Apply the translation writes, in order. */
  write(writes: ApprovalWrite[]): Promise<void>;
}

/**
 * What approving this draft must cause — `null` when it must cause nothing.
 *
 * Pure: a function of `ctx` alone, so both approval call sites can ask it.
 */
export function translationOnApproval(_ctx: ApprovalContext): TranslationRequest | null {
  throw new AutoTranslationNotImplementedError('translationOnApproval');
}

/**
 * The writes that turn a finished translation into a linked draft: create the
 * new draft, then link it to the original. Nothing else — in particular nothing
 * that touches the source draft, which has already been approved.
 */
export function translationWrites(
  _draft: EntityRecord,
  _translations: ReadonlyMap<string, string>,
  _request: TranslationRequest,
): ApprovalWrite[] {
  throw new AutoTranslationNotImplementedError('translationWrites');
}

/**
 * Approve, then try to translate. Resolves whatever happens to the translation.
 *
 * The ordering is the contract, not an implementation detail: `approve` settles
 * before `translate` is called, so a model outage, a revoked key or an
 * unreachable tenant leaves a draft that is approved and untranslated — a state
 * a person can see and retry — rather than a draft that silently stayed
 * unapproved because a second-order job threw (bd startsim-i3so).
 */
export function runApprovalTranslation(
  _ctx: ApprovalContext,
  _deps: ApprovalDeps,
): Promise<ApprovalOutcome> {
  throw new AutoTranslationNotImplementedError('runApprovalTranslation');
}
