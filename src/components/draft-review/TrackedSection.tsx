'use client';

/**
 * TrackedSection — one draft text field (the blog, the LinkedIn post) under
 * track changes (bd startsim-q8sgy; design startsim-xyn25). It replaced the
 * blog's textarea card and the LinkedIn DocumentEditor, so each field has ONE
 * editor (rule 1).
 *
 * The surface is the shared `TrackedField` from @startsimpli/ui/track-changes:
 * the source editor or the rendered Read view, show/hide changes, Current /
 * Final / Original, and the suggestions-and-comments rail. Every field opens
 * in the editor (bd startsim-whwxd.17, which retired locked decision #3's
 * "the blog opens in Read"): Quinn wanted no clicks between opening a draft
 * and typing. What this card adds is what is this page's: the debounced
 * autosave of the reviewer's own edits (BYO persistence, the contract
 * BlogSection had), and the word count and save state. The jump-to-issue
 * marks it used to paint over the Read view went with the Checks section
 * (bd startsim-m7fdm.25).
 *
 * TWO TEXTS, ON PURPOSE. `value` is what the reviewer has typed (the page's
 * section state); it is what autosaves and what the word count counts.
 * `stored` is the text as saved at `version`; it is what every server offset
 * (authorship, suggestions, comments) describes, so it is what the tracked
 * surface is given. Handing the surface unsaved keystrokes would make every
 * anchor look orphaned until the save landed.
 */
import * as React from 'react';
import { Loader2, Check, AlertCircle } from 'lucide-react';

import { cn } from '@startsimpli/ui/utils';
import { wordCount } from '@startsimpli/ui';
import {
  TrackedField,
  type AcceptResponseWire,
  type TrackChangesClient,
} from '@startsimpli/ui/track-changes';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const NO_CLIENT: TrackChangesClient = {};

export interface TrackedSectionProps {
  /** What the reviewer has typed: the page's section state. */
  value: string;
  /** The text as stored at `version`. Defaults to `value`. */
  stored?: string;
  /** The version the page's next write asserts. */
  version?: number | null;
  /** The record field (`blog`, `linkedin`). */
  field?: string;
  label?: string;
  /** `markdown` (blog) or `plain` (LinkedIn). */
  language?: 'markdown' | 'plain';
  client?: TrackChangesClient;
  currentActorSub?: string | null;
  /** False for a view-only reviewer: suggest and comment only. */
  canEdit?: boolean;
  /** The page's accept: hold writes, accept at its live version, fold. */
  runAccept?: (accept: (expectedVersion: number) => Promise<AcceptResponseWire>) => Promise<unknown>;
  /** Controlled edit — the parent updates its section state. */
  onChange(next: string): void;
  /** Debounced autosave (BYO persistence). Receives the current value. */
  onSave?(value: string): void | Promise<void>;
  /** Autosave debounce, ms. Default 1200 (matches DocumentEditor). */
  autosaveMs?: number;
  /** Put the caret in the text on mount (the field on screen when the page
   *  opens), so typing needs no click (bd startsim-whwxd.17). */
  autoFocus?: boolean;
  className?: string;
}

/**
 * The SHARED counter (bd startsim-wn2p.28). This was a local `split(/\s+/)`,
 * which reported an 855-character Chinese blog as 16 words while the validation
 * rail on the same screen reported 524.
 */
function countWords(s: string): number {
  return wordCount(s);
}

export function TrackedSection({
  value,
  stored,
  version = null,
  field = 'blog',
  label = 'Blog post',
  language = 'markdown',
  client = NO_CLIENT,
  currentActorSub = null,
  canEdit = true,
  runAccept,
  onChange,
  onSave,
  autosaveMs = 1200,
  autoFocus = false,
  className,
}: TrackedSectionProps) {
  const [status, setStatus] = React.useState<SaveStatus>('idle');
  const words = countWords(value);

  // Debounced autosave, mirroring DocumentEditor: fire onSave only on a real
  // content change, and keep the writer in a ref so the effect depends only on
  // the serialized value.
  //
  // The mirror is an effect, not a render-time assignment (react-hooks/refs).
  // It is declared FIRST on purpose: a component's passive effects run in hook
  // order, so this has already written the ref by the time the autosave effect
  // below snapshots it in the same commit — which is exactly what assigning
  // during render used to give us.
  //
  // Why the ref at all: the draft page passes an inline arrow, so a new
  // `onSave` arrives on every parent render. Depending on it would restart the
  // debounce on each of those renders and a busy page would never autosave.
  const onSaveRef = React.useRef(onSave);
  React.useEffect(() => {
    onSaveRef.current = onSave;
  });

  // `value` needs no mirror. The autosave effect re-runs on every change to it
  // and its cleanup clears the pending timer, so the timer that actually fires
  // is always the one whose closure holds the current text.
  const savedRef = React.useRef(value);

  React.useEffect(() => {
    const fn = onSaveRef.current;
    if (!fn) return;
    if (value === savedRef.current) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      setStatus('saving');
      try {
        await fn(value);
        if (cancelled) return;
        savedRef.current = value;
        setStatus('saved');
      } catch {
        if (!cancelled) setStatus('error');
      }
    }, autosaveMs);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value, autosaveMs]);

  return (
    <div className={className}>
      <TrackedField
        client={client}
        field={field}
        label={label}
        language={language}
        value={stored ?? value}
        version={version}
        currentActorSub={currentActorSub}
        canEdit={canEdit}
        onChange={onChange}
        runAccept={runAccept}
        autoFocus={autoFocus}
        headerExtra={
          <>
            <SaveStatusPill status={status} />
            <span className="text-xs text-muted-foreground">{words} words</span>
          </>
        }
      />
    </div>
  );
}

function SaveStatusPill({ status }: { status: SaveStatus }) {
  const map: Record<SaveStatus, { label: string; tone: string; icon: React.ReactNode }> = {
    idle: { label: '', tone: 'text-muted-foreground', icon: null },
    saving: { label: 'Saving…', tone: 'text-muted-foreground', icon: <Loader2 className="h-3 w-3 animate-spin" /> },
    saved: { label: 'Saved', tone: 'text-emerald-600', icon: <Check className="h-3 w-3" /> },
    error: { label: 'Save failed', tone: 'text-rose-600', icon: <AlertCircle className="h-3 w-3" /> },
  };
  const s = map[status];
  if (!s.label) return null;
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs', s.tone)} role="status" aria-live="polite">
      {s.icon}
      {s.label}
    </span>
  );
}
