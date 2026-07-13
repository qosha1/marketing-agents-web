'use client';

/**
 * Generic, schema-driven record drawer (bd ogmc-9ms.1.9; readable detail startsim-768w.17.6).
 * Opens READ-FIRST: renders every declared attribute read-optimized via the shared
 * @startsimpli/ui RecordDetail (long-text bodies as readable prose, urls as links) so a
 * full article is comfortable to read. An "Edit" toggle reveals the editable form
 * (AttributeField widgets) + Save. Preserves non-declared data keys and canonicalizes to
 * the client's camelCase blob so a PATCH (which REPLACES data) never drops fields.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Label, notify, RecordDetail, type RecordField } from '@startsimpli/ui';
import {
  DocumentEditor,
  recordPatchFromSections,
  type DocSection,
} from '@startsimpli/ui/document-editor';

import { AttributeField } from './attribute-field';
import { readData, toCamelKey } from '@/lib/board';
import { CONTENT_TYPE_KEY } from '@/lib/content';
import {
  buildStoryFromTopic,
  draftCandidateIndex,
  draftJudgeVerdict,
  draftStatus,
  draftTitle,
  fetchTopicDrafts,
} from '@/lib/topic-drafts';
import { updateEntity, type EntityRecord, type EntityTypeDef } from '@/lib/foundry-api';

interface Props {
  type: EntityTypeDef;
  record: EntityRecord | null;
  onClose: () => void;
  onSaved: () => void;
}

export function EntityDetailDrawer({ type, record, onClose, onSaved }: Props) {
  if (!record) return null;
  return <DrawerInner key={record.id} type={type} record={record} onClose={onClose} onSaved={onSaved} />;
}

function initialValues(type: EntityTypeDef, record: EntityRecord): Record<string, unknown> {
  const v: Record<string, unknown> = {};
  for (const attr of type.attributes) {
    const raw = readData(record.data, attr.name);
    if (attr.dataType === 'json') {
      v[attr.name] = raw == null ? '' : typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
    } else {
      v[attr.name] = raw ?? '';
    }
  }
  return v;
}

function readFields(type: EntityTypeDef, record: EntityRecord): RecordField[] {
  return type.attributes.map((attr) => {
    const raw = readData(record.data, attr.name);
    const kind: RecordField['kind'] =
      attr.dataType === 'longtext' ? 'longtext' : attr.dataType === 'json' ? 'json' : 'text';
    let value: string;
    if (raw == null) value = '';
    else if (attr.dataType === 'boolean') value = raw ? 'Yes' : 'No';
    else if (attr.dataType === 'json') value = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
    else value = String(raw);
    return { label: attr.name.replace(/_/g, ' '), value, kind };
  });
}

function DrawerInner({
  type,
  record,
  onClose,
  onSaved,
}: {
  type: EntityTypeDef;
  record: EntityRecord;
  onClose: () => void;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<'read' | 'edit'>('read');
  const [name, setName] = useState(record.name || '');
  const [values, setValues] = useState<Record<string, unknown>>(() => initialValues(type, record));
  const [saving, setSaving] = useState(false);
  const fields = useMemo(() => readFields(type, record), [type, record]);

  async function save() {
    const nextData: Record<string, unknown> = { ...record.data };
    for (const attr of type.attributes) {
      const camel = toCamelKey(attr.name);
      let val = values[attr.name];
      if (attr.dataType === 'json') {
        const s = String(val ?? '').trim();
        if (!s) {
          delete nextData[camel];
          delete nextData[attr.name];
          continue;
        }
        try {
          val = JSON.parse(s);
        } catch {
          notify.error(`"${attr.name}" is not valid JSON.`);
          return;
        }
      }
      if (val === '' || val === undefined || val === null) {
        delete nextData[camel];
        delete nextData[attr.name];
      } else {
        nextData[camel] = val;
        if (camel !== attr.name) delete nextData[attr.name];
      }
    }
    setSaving(true);
    try {
      await updateEntity(record.id, { name: name.trim() || record.name, data: nextData });
      await qc.invalidateQueries({ queryKey: ['entities', type.key] });
      notify.success('Saved.');
      onSaved();
      onClose();
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden />
      <aside className="relative z-10 flex h-full w-full max-w-2xl flex-col overflow-hidden border-l bg-white shadow-xl">
        <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide text-neutral-500">{type.label}</div>
            <div className="truncate text-sm font-medium">
              {record.name || record.externalId || `#${record.id}`}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => setMode((m) => (m === 'read' ? 'edit' : 'read'))}
              className="rounded border px-2.5 py-1 text-xs hover:bg-neutral-50"
            >
              {mode === 'read' ? 'Edit' : 'View'}
            </button>
            <button
              onClick={onClose}
              className="rounded p-1 text-neutral-500 hover:bg-neutral-100"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </header>

        {mode === 'read' ? (
          <div className="flex-1 overflow-y-auto px-5 py-4">
            <RecordDetail fields={fields} showEmpty emptyMessage="No details captured for this item yet." />
            {type.key === CONTENT_TYPE_KEY ? <TopicDrafts topic={record} onTopicChanged={onSaved} /> : null}
            {record.externalId ? (
              <p className="pt-4 text-xs text-neutral-400">external_id: {record.externalId}</p>
            ) : null}
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              {type.attributes.map((attr) => (
                <div key={String(attr.id)} className="space-y-1.5">
                  <Label className="capitalize">{attr.name.replace(/_/g, ' ')}</Label>
                  <AttributeField
                    attr={attr}
                    value={values[attr.name]}
                    onChange={(val) => setValues((prev) => ({ ...prev, [attr.name]: val }))}
                  />
                </div>
              ))}
            </div>
            <footer className="flex gap-2 border-t px-4 py-3">
              <Button onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
              <button
                onClick={() => setMode('read')}
                disabled={saving}
                className="rounded border px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50"
              >
                Cancel
              </button>
            </footer>
          </>
        )}
      </aside>
    </div>
  );
}

/** How long we keep polling for new drafts after firing the writer (~1 min run). */
const GENERATE_POLL_MS = 8_000;
const GENERATE_WINDOW_MS = 90_000;

/**
 * A topic's candidate drafts + the write→review→edit→confirm loop (bd 768w.16.9.4/.5).
 *
 * Fires the n8n writer ("Generate drafts" → /actions/generate-drafts — NOT /api,
 * which the tenant nginx routes to Django), lists the
 * candidates linked to this topic (via `written_for` OR `topic_ref`), and opens
 * any one in the shared DocumentEditor to edit + mark ready. Only rendered for the
 * content-spine (topic) type; every other type's drawer is untouched.
 */
function TopicDrafts({ topic, onTopicChanged }: { topic: EntityRecord; onTopicChanged: () => void }) {
  const qc = useQueryClient();
  const topicId = topic.id;
  const [generating, setGenerating] = useState(false);
  const [openDraftId, setOpenDraftId] = useState<number | null>(null);

  const draftsQuery = useQuery({
    queryKey: ['topic-drafts', topicId],
    queryFn: () => fetchTopicDrafts(topicId),
    // While the writer runs (~1 min, async), poll so the new candidates appear.
    refetchInterval: generating ? GENERATE_POLL_MS : false,
  });
  const drafts = draftsQuery.data ?? [];

  // Stop the generating state once new drafts land, or after a hard time cap so a
  // silent writer failure doesn't spin forever.
  const baselineRef = useRef(0);
  useEffect(() => {
    if (!generating) return;
    if (drafts.length > baselineRef.current) {
      setGenerating(false);
      return;
    }
    const t = setTimeout(() => setGenerating(false), GENERATE_WINDOW_MS);
    return () => clearTimeout(t);
  }, [generating, drafts.length]);

  async function generate() {
    baselineRef.current = drafts.length;
    setGenerating(true);
    try {
      const res = await fetch('/actions/generate-drafts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ story: buildStoryFromTopic(topic) }),
      });
      if (!res.ok) throw new Error(`Writer request failed (${res.status}).`);
      notify.success('Generating drafts… new candidates appear in ~1 min.');
    } catch (err) {
      setGenerating(false);
      notify.error(err instanceof Error ? err.message : 'Could not start the writer.');
    }
  }

  const openDraft = drafts.find((d) => d.id === openDraftId) ?? null;

  return (
    <section className="mt-6 border-t pt-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Drafts{drafts.length ? ` (${drafts.length})` : ''}
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => qc.invalidateQueries({ queryKey: ['topic-drafts', topicId] })}
            className="rounded border px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50"
          >
            Refresh
          </button>
          <Button onClick={generate} disabled={generating} className="text-xs">
            {generating ? 'Generating… (~1 min)' : 'Generate drafts'}
          </Button>
        </div>
      </div>

      {draftsQuery.isLoading ? (
        <p className="mt-2 text-sm text-neutral-500">Loading drafts…</p>
      ) : draftsQuery.isError ? (
        <p className="mt-2 text-sm text-neutral-400">Couldn’t load drafts for this topic.</p>
      ) : drafts.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-400">
          {generating ? 'Waiting for the writer to return candidates…' : 'No drafts written for this topic yet.'}
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {drafts.map((d) => {
            const idx = draftCandidateIndex(d);
            const verdict = draftJudgeVerdict(d);
            return (
              <li key={d.id}>
                <button
                  onClick={() => setOpenDraftId(d.id)}
                  className="flex w-full items-center justify-between gap-3 rounded border px-3 py-2 text-left text-sm hover:bg-neutral-50"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {idx ? (
                      <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-500">
                        #{idx}
                      </span>
                    ) : null}
                    <span className="min-w-0 truncate">{draftTitle(d)}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {verdict ? (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          verdict === 'accept'
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        judge: {verdict}
                      </span>
                    ) : null}
                    {draftStatus(d) ? (
                      <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs capitalize text-neutral-600">
                        {draftStatus(d)}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {openDraft ? (
        <DraftEditor
          key={openDraft.id}
          draft={openDraft}
          topic={topic}
          onClose={() => setOpenDraftId(null)}
          onChanged={() => {
            void qc.invalidateQueries({ queryKey: ['topic-drafts', topicId] });
            onTopicChanged();
          }}
        />
      ) : null}
    </section>
  );
}

/** camelCase-aware read of a draft data value as a string. */
function draftStr(data: EntityRecord['data'], name: string): string {
  const v = readData(data, name);
  return v == null ? '' : String(v);
}

/** Explicit document sections for a draft: blog/linkedin/seo/sources. */
function draftSections(draft: EntityRecord): DocSection[] {
  const seo = readData(draft.data, 'seo');
  const seoObj =
    seo && typeof seo === 'object' && !Array.isArray(seo) ? (seo as Record<string, unknown>) : {};
  const sourcesRaw = readData(draft.data, 'sources');
  const sources = Array.isArray(sourcesRaw)
    ? sourcesRaw.map((s) => (typeof s === 'string' ? s : String((s as Record<string, unknown>)?.url ?? s)))
    : typeof sourcesRaw === 'string'
      ? sourcesRaw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
      : [];
  return [
    { key: 'blog', label: 'Blog post', kind: 'markdown', value: draftStr(draft.data, 'blog') },
    { key: 'linkedin', label: 'LinkedIn post', kind: 'text', value: draftStr(draft.data, 'linkedin') },
    { key: 'seo', label: 'SEO', kind: 'structured', value: seoObj },
    { key: 'sources', label: 'Sources', kind: 'list', value: sources },
  ];
}

/**
 * Opens one draft in the shared DocumentEditor. The editor is controlled — we own
 * the section values and persist on its debounced autosave. The backend PATCH
 * REPLACES the whole `data` blob, so every write merges the patch into the FULL
 * existing draft.data (never a partial), or untouched attributes would drop. Mark
 * ready flips the draft (chosen + ready) and the topic (written) together.
 */
function DraftEditor({
  draft,
  topic,
  onClose,
  onChanged,
}: {
  draft: EntityRecord;
  topic: EntityRecord;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [sections, setSections] = useState<DocSection[]>(() => draftSections(draft));
  const [marking, setMarking] = useState(false);
  const ready = draftStatus(draft) === 'ready';

  const onChange = (key: string, value: unknown) =>
    setSections((prev) => prev.map((s) => (s.key === key ? { ...s, value } : s)));

  // Debounced autosave: PATCH the merged blob. No list invalidation here — the
  // DocumentEditor shows its own "Saved" pill, and refetching mid-edit would churn
  // the list. markReady is what refreshes the list + board.
  async function save(next: DocSection[]) {
    const patch = recordPatchFromSections(next);
    await updateEntity(draft.id, { data: { ...draft.data, ...patch } });
  }

  async function markReady() {
    setMarking(true);
    try {
      const patch = recordPatchFromSections(sections);
      // Save any pending edits and flip the draft to chosen+ready in one PATCH.
      await updateEntity(draft.id, {
        data: { ...draft.data, ...patch, chosen: true, status: 'ready' },
      });
      await updateEntity(topic.id, { data: { ...topic.data, status: 'written' } });
      notify.success('Marked ready.');
      onChanged();
      onClose();
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Could not mark ready.');
    } finally {
      setMarking(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border bg-neutral-50/60 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium">{draftTitle(draft)}</span>
        <button onClick={onClose} className="rounded border px-2 py-1 text-xs hover:bg-neutral-100">
          Close draft
        </button>
      </div>
      <DocumentEditor
        sections={sections}
        onChange={onChange}
        onSave={save}
        header={
          <Button onClick={markReady} disabled={marking || ready} className="text-xs">
            {ready ? 'Ready' : marking ? 'Marking…' : 'Mark ready'}
          </Button>
        }
      />
    </div>
  );
}
