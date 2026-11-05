/**
 * "Start content" on a topic (bd startsim-i4diy): reuse, do not rebuild.
 *
 * The draft is written by the existing writer relay (`/actions/generate-drafts`,
 * reached through `dispatchDraftForApproval`, which claims the run, builds the
 * story and reports refusals). The relay only accepts an approved topic, so a
 * topic that is not `ready` is approved first with the SAME decision the old
 * Approve button wrote (status + verdict from TOPIC_REVIEW_CONFIG). A topic that
 * already has a draft never reaches the writer: its draft is opened instead.
 */
import { applyDecisionToData, resolveReviewConfig, reviewDecisions } from '@startsimpli/ui/collection';

import { readData } from '@/lib/board';
import type { EntityRecord, EntityTypeDef } from '@/lib/foundry-api';
import { TOPIC_REVIEW_CONFIG } from '@/lib/review-vocabulary';
import { draftHref, storyHref } from '@/lib/story-nav';

export interface StartContentDeps {
  fetchDrafts: (topic: EntityRecord) => Promise<EntityRecord[]>;
  saveTopic: (id: EntityRecord['id'], data: Record<string, unknown>) => Promise<unknown>;
  dispatch: (topic: EntityRecord) => Promise<void>;
}

async function realDeps(): Promise<StartContentDeps> {
  const [{ fetchTopicDrafts }, { updateEntity }, { dispatchDraftForApproval }] = await Promise.all([
    import('@/lib/topic-drafts'),
    import('@/lib/foundry-api'),
    import('@/lib/approve-dispatch'),
  ]);
  return {
    fetchDrafts: (t) => fetchTopicDrafts(t),
    saveTopic: (id, data) => updateEntity(id, { data }),
    dispatch: dispatchDraftForApproval,
  };
}

export async function startContent(
  topic: EntityRecord,
  type: EntityTypeDef | null | undefined,
  deps?: StartContentDeps,
): Promise<{ href: string; started: boolean }> {
  const d = deps ?? (await realDeps());

  const existing = await d.fetchDrafts(topic);
  if (existing.length === 1) return { href: draftHref(existing[0].id), started: false };
  if (existing.length > 1) return { href: storyHref(topic.id), started: false };

  const cfg = resolveReviewConfig(type, TOPIC_REVIEW_CONFIG);
  const approve = reviewDecisions(cfg).find((x) => x.key === 'approve');
  const ready = String(readData(topic.data, cfg.statusName) ?? '') === approve?.status;
  let toDispatch = topic;
  if (!ready && approve) {
    const data = applyDecisionToData(topic.data, approve, cfg, (type?.attributes ?? []).map((a) => a.name));
    await d.saveTopic(topic.id, data);
    toDispatch = { ...topic, data };
  }
  await d.dispatch(toDispatch);
  return { href: storyHref(topic.id), started: true };
}
