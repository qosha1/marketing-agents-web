/**
 * Good / Not good / Not reviewed on a pulled-in document (bd startsim-wgmf5,
 * decision bead startsim-rd9g8).
 *
 * Not a new vocabulary: a document is a `news_item`, and its curation already has
 * one — NEWS_REVIEW_CONFIG (Accept -> `acceptable`, Reject -> `rejected`), the
 * gate before topic generation. Good is that Accept and Not good is that Reject,
 * resolved and applied through the same shared helpers the old News table used,
 * so the two words cannot write different fields than the old buttons did.
 * Everything else a document can be (new, surfaced, cited...) reads as
 * "Not reviewed".
 */
import { applyDecisionToData, resolveReviewConfig, reviewDecisions } from '@startsimpli/ui/collection';

import { readData } from '@/lib/board';
import type { EntityRecord, EntityTypeDef } from '@/lib/foundry-api';
import { NEWS_REVIEW_CONFIG } from '@/lib/review-vocabulary';

export type DocumentReview = 'good' | 'not_good' | 'unreviewed';
export type ReviewChoice = 'good' | 'not_good';

export const REVIEW_LABEL: Record<DocumentReview, string> = {
  good: 'Good',
  not_good: 'Not good',
  unreviewed: 'Not reviewed',
};

const DECISION_FOR: Record<ReviewChoice, 'approve' | 'reject'> = { good: 'approve', not_good: 'reject' };

export function documentReview(doc: EntityRecord, type?: EntityTypeDef | null): DocumentReview {
  const cfg = resolveReviewConfig(type, NEWS_REVIEW_CONFIG);
  const status = String(readData(doc.data, cfg.statusName) ?? '');
  if (!status) return 'unreviewed';
  if (status === cfg.transitions.approve) return 'good';
  if (status === cfg.transitions.reject) return 'not_good';
  return 'unreviewed';
}

/** The full next data blob for a choice (the backend PATCH replaces `data`), or null if the type cannot express it. */
export function reviewDocumentData(
  doc: EntityRecord,
  choice: ReviewChoice,
  type: EntityTypeDef | null | undefined,
): Record<string, unknown> | null {
  const cfg = resolveReviewConfig(type, NEWS_REVIEW_CONFIG);
  const decision = reviewDecisions(cfg).find((d) => d.key === DECISION_FOR[choice]);
  if (!decision) return null;
  return applyDecisionToData(doc.data, decision, cfg, (type?.attributes ?? []).map((a) => a.name));
}
