'use client';
import { useSyncExternalStore } from 'react';

import { CHANGE_EVENT, getActiveProjectId } from '@/lib/project-scope';

function subscribe(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}

/** The active project as React state; re-renders when the switcher changes it. */
export function useActiveProjectId(): string | null {
  return useSyncExternalStore(subscribe, getActiveProjectId, () => null);
}
