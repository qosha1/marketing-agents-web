'use client';

/**
 * Add content by hand (bd startsim-rcnt1): Title, Type, optional Based on topic,
 * What should it say. Creates a Draft and opens it. Lives on /content/new, as
 * in the design (V16 "New").
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, notify } from '@startsimpli/ui';

import { CONTENT_TYPES, basedOnRule, newContentInput, sharedScopePath, validateNewContent, type NewContentForm } from '@/lib/content-new';
import { createEntity, listEntities } from '@/lib/foundry-api';
import { readData } from '@/lib/board';
import { recordScopePath } from '@/lib/scope';
import { CHANGE_EVENT, getActiveProjectId } from '@/lib/project-scope';

const FIELD = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm';

export function AddContentForm() {
  const router = useRouter();
  const qc = useQueryClient();
  const [form, setForm] = useState<NewContentForm>({ title: '', type: CONTENT_TYPES[0].key, topicId: '', brief: '' });
  const [errors, setErrors] = useState<{ title?: string }>({});
  const [busy, setBusy] = useState(false);

  // The topics worth basing a piece on: approved ones, newest first. One page.
  const topics = useQuery({
    queryKey: ['content-topics'],
    queryFn: () => listEntities('topic', 1, { 'attr.status__in': 'ready,written', page_size: '50' }),
  });

  // Existing items, to find the one scope they all share (see sharedScopePath).
  const existing = useQuery({
    queryKey: ['content-scope-probe'],
    queryFn: () => listEntities('draft', 1, { page_size: '25' }),
  });
  const [problem, setProblem] = useState('');

  // The sidebar switcher can change while this form is open.
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const read = () => setActive(getActiveProjectId());
    read();
    window.addEventListener(CHANGE_EVENT, read);
    return () => window.removeEventListener(CHANGE_EVENT, read);
  }, []);
  const sharedScope = sharedScopePath((existing.data?.results ?? []).map((r) => recordScopePath(r.data)));
  // "Based on" is optional only while the item can still be placed (bd startsim-bj3zz.10).
  const basedOn = basedOnRule({ topicId: form.topicId, activeProject: active, sharedScope });

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
    <div className="max-w-xl space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Add content</h1>
      <form onSubmit={submit} className="space-y-4">
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
          {basedOn.required ? 'Based on' : <>Based on <span className="font-normal text-neutral-500">(optional)</span></>}
          <select className={FIELD} value={form.topicId} onChange={(e) => setForm({ ...form, topicId: e.target.value })}>
            <option value="">{basedOn.required ? 'Pick a topic first' : 'Pick a topic'}</option>
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
        {basedOn.required && !basedOn.satisfied ? (
          <p className="text-xs text-neutral-500">With All projects selected, an item needs a topic to know where it belongs. Pick a topic, or choose a project in the sidebar.</p>
        ) : null}
        {problem ? <p role="alert" className="text-sm text-red-600">{problem}</p> : null}
        <div className="flex gap-2">
          <Button type="submit" disabled={busy || !basedOn.satisfied}>{busy ? 'Creating…' : 'Create'}</Button>
          <Button type="button" variant="secondary" onClick={() => router.push('/content')} disabled={busy}>Cancel</Button>
        </div>
      </form>
    </div>
  );
}
