'use client';

/**
 * Add content by hand (bd startsim-rcnt1): Title, Type, optional Based on topic,
 * What should it say. Creates a Draft and opens it.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BaseDialog, Button, notify } from '@startsimpli/ui';

import { CONTENT_TYPES, newContentInput, sharedScopePath, validateNewContent, type NewContentForm } from '@/lib/content-new';
import { createEntity, listEntities } from '@/lib/foundry-api';
import { readData } from '@/lib/board';
import { recordScopePath } from '@/lib/scope';
import { getActiveProjectId } from '@/lib/project-scope';

const FIELD = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm';

export function AddContentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [form, setForm] = useState<NewContentForm>({ title: '', type: CONTENT_TYPES[0].key, topicId: '', brief: '' });
  const [errors, setErrors] = useState<{ title?: string }>({});
  const [busy, setBusy] = useState(false);

  // The topics worth basing a piece on: approved ones, newest first. One page.
  const topics = useQuery({
    queryKey: ['content-topics'],
    queryFn: () => listEntities('topic', 1, { 'attr.status__in': 'ready,written', page_size: '50' }),
    enabled: open,
  });

  // Existing items, to find the one scope they all share (see sharedScopePath).
  const existing = useQuery({
    queryKey: ['content-scope-probe'],
    queryFn: () => listEntities('draft', 1, { page_size: '25' }),
    enabled: open,
  });
  const [problem, setProblem] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const found = validateNewContent(form);
    setErrors(found);
    if (found.title) return;
    setBusy(true);
    try {
      const topic = (topics.data?.results ?? []).find((t) => String(t.id) === form.topicId);
      const scopePath =
        (topic ? recordScopePath(topic.data) : undefined) ??
        getActiveProjectId() ??
        sharedScopePath((existing.data?.results ?? []).map((r) => recordScopePath(r.data))) ??
        null;
      if (!scopePath) {
        setProblem('Pick a topic or a project first, so the item knows where it belongs.');
        return;
      }
      setProblem('');
      const created = await createEntity(newContentInput(form, { scopePath }));
      await qc.invalidateQueries({ queryKey: ['content-list'] });
      onOpenChange(false);
      router.push(`/content/${created.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not add the content.';
      setProblem(msg);
      notify.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <BaseDialog open={open} onOpenChange={onOpenChange} size="md" loading={busy}>
      <BaseDialog.Header>
        <BaseDialog.Title>Add content</BaseDialog.Title>
      </BaseDialog.Header>
      <form onSubmit={submit} className="space-y-4 px-6 pb-6">
        <label className="block space-y-1 text-sm font-medium">
          Title
          <input
            className={FIELD}
            value={form.title}
            placeholder="What is it called?"
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            aria-invalid={!!errors.title}
          />
          {errors.title ? <span className="text-xs font-normal text-red-600">{errors.title}</span> : null}
        </label>
        <label className="block space-y-1 text-sm font-medium">
          Type
          <select className={FIELD} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as NewContentForm['type'] })}>
            {CONTENT_TYPES.map((t) => (
              <option key={t.key} value={t.key}>{t.label}</option>
            ))}
          </select>
        </label>
        <label className="block space-y-1 text-sm font-medium">
          Based on (optional)
          <select className={FIELD} value={form.topicId} onChange={(e) => setForm({ ...form, topicId: e.target.value })}>
            <option value="">Pick a topic</option>
            {(topics.data?.results ?? []).map((t) => (
              <option key={t.id} value={String(t.id)}>
                {String(readData(t.data, 'title') ?? t.name)}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1 text-sm font-medium">
          What should it say?
          <textarea
            className={`${FIELD} min-h-24`}
            value={form.brief}
            placeholder="A sentence or two."
            onChange={(e) => setForm({ ...form, brief: e.target.value })}
          />
        </label>
        {problem ? <p role="alert" className="text-sm text-red-600">{problem}</p> : null}
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create'}</Button>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
        </div>
      </form>
    </BaseDialog>
  );
}
