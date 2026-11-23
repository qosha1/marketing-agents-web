'use client';

/**
 * The review queue behind the draft page: which draft is next, how to go there,
 * and the [ / ] keys (split out of the page, bd startsim-m7fdm.27). The visible
 * previous/next arrows were removed (Quinn's list, e11); the keys and the
 * auto-advance after "Mark sent" stay.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { draftShortcut, shouldIgnoreShortcut } from '@/lib/keyboard';
import { draftHref, FROM_PARAM, safeReturnPath } from '@/lib/story-nav';
import type { EntityRecord } from '@/lib/foundry-api';

export function useDraftQueue(allDrafts: EntityRecord[], draftId: string) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queueIndex = useMemo(
    () => allDrafts.findIndex((d) => String(d.id) === String(draftId)),
    [allDrafts, draftId],
  );
  const prevDraft = queueIndex > 0 ? allDrafts[queueIndex - 1] : null;
  const nextDraft =
    queueIndex >= 0 && queueIndex + 1 < allDrafts.length ? allDrafts[queueIndex + 1] : null;

  function goToDraft(d: EntityRecord | null) {
    // Carry the return path along the queue (bd startsim-z384k) — stepping to
    // the next draft must not quietly lose the table scope the reviewer came
    // from, or "back" lands somewhere they never were.
    if (d) router.push(draftHref(d.id, safeReturnPath(searchParams.get(FROM_PARAM))));
  }

  // Mirror the queue step so the key listener binds ONCE yet always calls the
  // freshest handler — the queue churns as drafts load.
  const queueByRef = useRef<(delta: 1 | -1) => void>(() => {});
  useEffect(() => {
    queueByRef.current = (delta) => goToDraft(delta === 1 ? nextDraft : prevDraft);
  });

  // [ / ] step the queue. Bound to the document because the reviewer's focus is
  // normally in the content pane — and guarded so a bracket typed into the blog
  // editor never leaves the draft (see shouldIgnoreShortcut).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (
        shouldIgnoreShortcut({
          key: e.key,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
          altKey: e.altKey,
          target: e.target,
        })
      ) {
        return;
      }
      const action = draftShortcut(e.key);
      if (!action) return; // not ours — leave the event alone
      queueByRef.current(action.delta);
      e.preventDefault();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return { router, goToDraft, nextDraft };
}
