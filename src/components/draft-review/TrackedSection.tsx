'use client';

/**
 * TrackedSection — one draft text field (the blog, the LinkedIn post) under
 * track changes (bd startsim-q8sgy; design startsim-xyn25). It replaced the
 * blog's textarea card and the LinkedIn DocumentEditor, so each field has ONE
 * editor (rule 1).
 *
 * The surface is the shared `TrackedField` from @startsimpli/ui/track-changes:
 * the rendered Read view (the blog still opens there, locked decision #3) or
 * the source editor, show/hide changes, Current / Final / Original, and the
 * suggestions-and-comments rail. What this card adds is what is this page's:
 * the debounced autosave of the reviewer's own edits (BYO persistence, the
 * contract BlogSection had), the word count and save state, and the
 * jump-to-issue marks painted over the Read view.
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
  /**
   * Substrings a jump-to-issue wants marked in the rendered blog (bd 768w.16.15.3).
   * Painted in the Read/Split preview only — see {@link useRangeHighlight}.
   */
  highlight?: string[];
  className?: string;
}

/**
 * Separator for the paint-effect key. The needles are PHRASES ("on earth",
 * "world leading"), so joining on anything that can occur inside one would split it.
 */
const NEEDLE_SEP = '\u0000';

/** Stable identity for "nothing to highlight" so the paint effect doesn't churn. */
const NO_HIGHLIGHT: string[] = [];

/** The CSS Custom Highlight registry key, styled by {@link HIGHLIGHT_STYLE}. */
const HIGHLIGHT_NAME = 'draft-issue';

/**
 * The mark's paint. Injected as a <style> tag rather than living in globals.css
 * because the build's CSS optimizer rejects `::highlight()` as an unknown
 * pseudo-element and fails the whole build on it. Inline, it reaches the browser
 * untouched — and a browser that doesn't know the selector drops just this rule,
 * which is exactly the degradation we want.
 */
const HIGHLIGHT_STYLE = `::highlight(${HIGHLIGHT_NAME}){background-color:#fde68a;color:#78350f;}`;

/**
 * The SHARED counter (bd startsim-wn2p.28). This was a local `split(/\s+/)`,
 * which reported an 855-character Chinese blog as 16 words while the validation
 * rail on the same screen reported 524.
 */
function countWords(s: string): number {
  return wordCount(s);
}

/**
 * Every Range under `root` whose text matches one of `needles`, case-insensitively
 * (the hype scan lowercases, so the rendered casing rarely matches the needle).
 *
 * A needle split across text nodes by inline markup (`**game**-changing`) is not
 * found — markdown decides where the nodes break, and stitching across them would
 * be the brittle-text-walk this deliberately avoids. Missing a mark is acceptable;
 * the caller has already switched channel and scrolled, so the issue is not lost.
 */
function textRanges(root: HTMLElement, needles: string[]): Range[] {
  const ranges: Range[] = [];
  const lowered = needles.map((n) => n.toLowerCase()).filter(Boolean);
  if (lowered.length === 0) return ranges;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue?.toLowerCase();
    if (!text) continue;
    for (const needle of lowered) {
      for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) {
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + needle.length);
        ranges.push(range);
      }
    }
  }
  return ranges;
}

/**
 * Mark `matches` inside the rendered markdown WITHOUT touching its DOM.
 *
 * The blog goes through the shared MarkdownRenderer, which takes only `content` —
 * there is no seam to wrap <mark> at the React level. Rewriting its output
 * (innerHTML / text replace) would both fight React's reconciliation and reintroduce
 * an injection surface, so we use the CSS Custom Highlight API instead: it paints
 * Ranges over the existing text nodes and mutates nothing. Where it is unsupported
 * nothing paints and nothing breaks — the caller still switched channel and scrolled.
 *
 * Scrolling the first match into view is deliberately NOT done here: the jump already
 * scrolls the content pane, and this effect re-runs on every keystroke (the checks
 * recompute live), which would yank the page out from under the writer.
 */
function useRangeHighlight(
  containerRef: React.RefObject<HTMLDivElement | null>,
  matches: string[],
  /** The rendered text; a change re-paints because the old Ranges are now stale. */
  content: string,
) {
  // The `matches` ARRAY identity churns on every recompute — key on its values.
  const key = matches.join(NEEDLE_SEP);

  React.useEffect(() => {
    if (typeof CSS === 'undefined' || !('highlights' in CSS)) return;
    // Wrapped: registry.delete returns a boolean, which is not a valid cleanup.
    const clear = () => {
      CSS.highlights.delete(HIGHLIGHT_NAME);
    };

    const root = containerRef.current;
    const needles = key ? key.split(NEEDLE_SEP) : [];
    if (!root || needles.length === 0) {
      clear();
      return;
    }
    const ranges = textRanges(root, needles);
    if (ranges.length === 0) {
      clear();
      return;
    }
    CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges));
    return clear;
  }, [containerRef, key, content]);
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
  highlight = NO_HIGHLIGHT,
  className,
}: TrackedSectionProps) {
  const [status, setStatus] = React.useState<SaveStatus>('idle');
  const words = countWords(value);

  // Marks live in the rendered Read view only — the source editor paints its
  // own decorations, so a jump into a field the reviewer is EDITING switches +
  // scrolls without a mark.
  const previewRef = React.useRef<HTMLDivElement | null>(null);
  useRangeHighlight(previewRef, highlight, stored ?? value);

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
      {/* Static, author-written CSS — never interpolates content. */}
      <style>{HIGHLIGHT_STYLE}</style>
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
        // Locked decision #3: the blog opens in the rendered (Read) view.
        defaultSurface={language === 'markdown' ? 'read' : 'source'}
        readViewRef={previewRef}
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
