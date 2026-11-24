'use client';

/**
 * The one editor on the item page (bd startsim-nkvgn): a Type switch and a text
 * area that saves itself. No versions, no show-changes, no mentions; who changed
 * what is the History panel's job.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Loader2, AlertCircle } from 'lucide-react';

import { CONTENT_TYPES, type ContentType } from '@/lib/content-new';

type Phase = 'idle' | 'saving' | 'saved' | 'error';

export function ContentEditor({
  initialType,
  initialText,
  canEdit,
  footer,
  onSave,
}: {
  initialType: ContentType['key'];
  initialText: Record<ContentType['field'], string>;
  canEdit: boolean;
  /** Under the text: what the item is based on. Nothing when null. */
  footer?: ReactNode;
  /** Write `value` into `field`. Resolves true when it is on the server. */
  onSave: (field: ContentType['field'], value: string) => Promise<boolean>;
}) {
  const [type, setType] = useState(initialType);
  const [texts, setTexts] = useState(initialText);
  const [phase, setPhase] = useState<Phase>('idle');
  const field = (CONTENT_TYPES.find((t) => t.key === type) ?? CONTENT_TYPES[0]).field;
  const saved = useRef(initialText);
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onSaveRef.current = onSave;
  });

  const value = texts[field];
  useEffect(() => {
    if (value === saved.current[field]) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setPhase('saving');
      const ok = await onSaveRef.current(field, value);
      if (cancelled) return;
      if (ok) saved.current = { ...saved.current, [field]: value };
      setPhase(ok ? 'saved' : 'error');
    }, 1200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value, field]);

  return (
    <section className="space-y-2 rounded-lg border border-border p-4" aria-label="Editor">
      <div className="flex items-center justify-between gap-3">
        <select
          aria-label="Type"
          className="rounded-md border border-border bg-background px-2 py-1 text-sm"
          value={type}
          onChange={(e) => setType(e.target.value as ContentType['key'])}
        >
          {CONTENT_TYPES.map((t) => (
            <option key={t.key} value={t.key}>{t.label}</option>
          ))}
        </select>
        <span role="status" aria-live="polite" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          {phase === 'saving' ? <><Loader2 className="h-3 w-3 animate-spin" /> Saving…</> : null}
          {phase === 'saved' ? <><Check className="h-3 w-3 text-emerald-600" /> Saved</> : null}
          {phase === 'error' ? <><AlertCircle className="h-3 w-3 text-rose-600" /> Save failed</> : null}
          {phase === 'idle' && canEdit ? 'Saves itself' : null}
        </span>
      </div>
      <textarea
        aria-label="Text"
        className="min-h-72 w-full resize-y rounded-md border border-border bg-background p-3 text-sm leading-relaxed"
        value={value}
        readOnly={!canEdit}
        onChange={(e) => setTexts({ ...texts, [field]: e.target.value })}
      />
      {footer ? <div className="flex items-center gap-2 border-t border-border pt-3 text-sm text-neutral-500">{footer}</div> : null}
    </section>
  );
}
