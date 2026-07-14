'use client';

/**
 * BlogSection — the draft's blog card, defaulting to the RENDERED (Read) view
 * (P1 of the redesigned review flow; locked product decision #3).
 *
 * The shared @startsimpli/ui DocumentEditor hardcodes its markdown sub-section to
 * open in Split and exposes no prop to seed the initial view mode, so a blog that
 * "opens in Read" cannot be expressed from the consumer side via the DocumentEditor.
 * This fork-local card reuses the shared MarkdownRenderer to render Read by default;
 * Edit is opt-in and Split only appears in edit context. It's controlled (value +
 * onChange) with a debounced autosave (BYO persistence), mirroring DocumentEditor's
 * contract so persistence stays identical. Extracted to a shared composer later —
 * at which point DocumentEditor should gain an initial-markdown-mode prop and this
 * goes away. (TODO: upstream `initialMarkdownMode`/per-section `defaultMode` on
 * @startsimpli/ui DocumentEditor.)
 */
import * as React from 'react';
import { Columns2, Eye, Pencil, Loader2, Check, AlertCircle } from 'lucide-react';

import { cn } from '@startsimpli/ui/utils';
import { MarkdownRenderer } from '@startsimpli/ui/blog';

export type BlogViewMode = 'read' | 'edit' | 'split';
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface BlogSectionProps {
  value: string;
  label?: string;
  /** Controlled edit — the parent updates its blog section state. */
  onChange(next: string): void;
  /** Debounced autosave (BYO persistence). Receives the current value. */
  onSave?(value: string): void | Promise<void>;
  /** Autosave debounce, ms. Default 1200 (matches DocumentEditor). */
  autosaveMs?: number;
  className?: string;
}

function countWords(s: string): number {
  const t = s.trim();
  return t ? t.split(/\s+/).length : 0;
}

export function BlogSection({
  value,
  label = 'Blog post',
  onChange,
  onSave,
  autosaveMs = 1200,
  className,
}: BlogSectionProps) {
  // Locked decision #3: the blog opens in the rendered (Read) view.
  const [mode, setMode] = React.useState<BlogViewMode>('read');
  const [status, setStatus] = React.useState<SaveStatus>('idle');
  const words = countWords(value);

  // Debounced autosave, mirroring DocumentEditor: fire onSave only on a real
  // content change, keep the latest value + writer in refs so the effect depends
  // only on the serialized value.
  const valueRef = React.useRef(value);
  valueRef.current = value;
  const onSaveRef = React.useRef(onSave);
  onSaveRef.current = onSave;
  const savedRef = React.useRef(value);

  React.useEffect(() => {
    const fn = onSaveRef.current;
    if (!fn) return;
    if (value === savedRef.current) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      setStatus('saving');
      try {
        await fn(valueRef.current);
        if (cancelled) return;
        savedRef.current = valueRef.current;
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

  const showEditor = mode === 'edit' || mode === 'split';
  const showPreview = mode === 'read' || mode === 'split';

  return (
    <section className={cn('rounded-lg border border-border bg-card', className)}>
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</h3>
        <div className="flex items-center gap-3">
          <SaveStatusPill status={status} />
          <span className="text-xs text-muted-foreground">{words} words</span>
          <ModeToggle mode={mode} onMode={setMode} />
        </div>
      </div>
      <div className={cn('grid gap-0', mode === 'split' && 'lg:grid-cols-2 lg:divide-x lg:divide-border')}>
        {showEditor && (
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-label={`${label} markdown`}
            className="min-h-[16rem] w-full resize-y border-0 bg-transparent p-4 font-mono text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground focus:ring-0"
            spellCheck
          />
        )}
        {showPreview && (
          <div className="min-h-[16rem] overflow-x-auto p-4">
            {value ? (
              <MarkdownRenderer content={value} />
            ) : (
              <p className="text-sm italic text-muted-foreground">Nothing to preview yet.</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function ModeToggle({ mode, onMode }: { mode: BlogViewMode; onMode: (m: BlogViewMode) => void }) {
  // Split only appears in edit context (decision #3): it's disabled/hidden until
  // the reviewer opts into editing — but we keep it in the group on wide screens
  // once editing so the split affordance is one click away.
  const opts: { value: BlogViewMode; label: string; icon: React.ReactNode; editOnly?: boolean }[] = [
    { value: 'read', label: 'Read', icon: <Eye className="h-3 w-3" /> },
    { value: 'edit', label: 'Edit', icon: <Pencil className="h-3 w-3" /> },
    { value: 'split', label: 'Split', icon: <Columns2 className="h-3 w-3" />, editOnly: true },
  ];
  const editing = mode === 'edit' || mode === 'split';
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-border" role="group" aria-label="Blog view mode">
      {opts.map((o) => {
        // Split shows only once the reviewer is editing, and only on wide screens.
        if (o.editOnly && !editing) return null;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onMode(o.value)}
            aria-pressed={mode === o.value}
            className={cn(
              'inline-flex items-center gap-1 px-2 py-1 text-xs transition-colors',
              o.editOnly && 'hidden lg:inline-flex',
              mode === o.value
                ? 'bg-primary text-primary-foreground'
                : 'bg-transparent text-muted-foreground hover:bg-muted',
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
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
