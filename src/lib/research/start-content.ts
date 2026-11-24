/**
 * "Start content" on a topic (bd startsim-i4diy): reuse, do not rebuild.
 *
 * The draft is written by the existing writer relay (`/actions/generate-drafts`,
 * reached through `dispatchDraftForApproval`, which claims the run, builds the
 * story and reports refusals). The relay only accepts an approved topic, so a
 * topic that is not `ready` is approved first with the SAME decision the old
 * Approve button wrote (status + verdict from TOPIC_REVIEW_CONFIG). A topic that
 * already has a draft never reaches the writer: that draft is opened instead, so
 * a second click opens the same content.
 *
 * The writer is asynchronous (about two minutes live), so a started topic hands
 * back `href: null` and the caller waits for the draft with `waitForDraft`, then
 * opens it. The content item page is /content/:id.
 */
import { applyDecisionToData, resolveReviewConfig, reviewDecisions } from '@startsimpli/ui/collection';

import { readData } from '@/lib/board';
import type { EntityRecord, EntityTypeDef } from '@/lib/foundry-api';
import { GENERATE_POLL_MS, GENERATE_WINDOW_MS } from '@/lib/generate-poll';
import { TOPIC_REVIEW_CONFIG } from '@/lib/review-vocabulary';

export interface StartContentDeps {
  fetchDrafts: (topic: EntityRecord) => Promise<EntityRecord[]>;
  saveTopic: (id: EntityRecord['id'], data: Record<string, unknown>) => Promise<unknown>;
  dispatch: (topic: EntityRecord) => Promise<void>;
  /** Whether a writer run is still in flight for the topic after `dispatch` returned. */
  running: (topicId: EntityRecord['id']) => boolean;
}

export function contentHref(id: EntityRecord['id']): string {
  return `/content/${encodeURIComponent(String(id))}`;
}

async function realDeps(): Promise<StartContentDeps> {
  const [{ fetchTopicDrafts }, { updateEntity }, { dispatchDraftForApproval }, { isGenerateRunning }] = await Promise.all([
    import('@/lib/topic-drafts'),
    import('@/lib/foundry-api'),
    import('@/lib/approve-dispatch'),
    import('@/lib/generate-run'),
  ]);
  return {
    fetchDrafts: (t) => fetchTopicDrafts(t),
    saveTopic: (id, data) => updateEntity(id, { data }),
    dispatch: dispatchDraftForApproval,
    running: isGenerateRunning,
  };
}

/** The draft to open when a topic has several: the newest. */
export function newestDraft(drafts: EntityRecord[]): EntityRecord {
  return [...drafts].sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))[0];
}

export type StartResult =
  | { state: 'open'; href: string }
  | { state: 'writing' }
  | { state: 'refused' };

export async function startContent(
  topic: EntityRecord,
  type: EntityTypeDef | null | undefined,
  deps?: StartContentDeps,
): Promise<StartResult> {
  const d = deps ?? (await realDeps());

  const existing = await d.fetchDrafts(topic);
  if (existing.length > 0) return { state: 'open', href: contentHref(newestDraft(existing).id) };

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
  // `dispatch` reports its own refusals and ends the run when it did not start.
  return d.running(topic.id) ? { state: 'writing' } : { state: 'refused' };
}

/** Wait for the writer's draft to land; null when the window passes with nothing. */
export async function waitForDraft(
  topic: EntityRecord,
  fetchDrafts: StartContentDeps['fetchDrafts'],
  opts: { intervalMs?: number; windowMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
): Promise<EntityRecord | null> {
  const { intervalMs = GENERATE_POLL_MS / 2, windowMs = GENERATE_WINDOW_MS, now = Date.now } = opts;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const until = now() + windowMs;
  for (;;) {
    let drafts: EntityRecord[] = [];
    try {
      drafts = await fetchDrafts(topic);
    } catch {
      // A failed poll is not a verdict; the window decides.
    }
    if (drafts.length > 0) return newestDraft(drafts);
    if (now() >= until) return null;
    await sleep(intervalMs);
  }
}
