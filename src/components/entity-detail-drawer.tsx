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
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Label, notify, RecordDetail, type RecordField } from '@startsimpli/ui';

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

/**
 * The deep field editor for a record — Name + one AttributeField per declared attr
 * + Save/Cancel. Extracted so BOTH the read-first EntityDetailDrawer (its "Edit"
 * mode) AND the shared ReviewDrawer ("Edit fields" toggle) reuse the same form.
 * Self-contained: owns its draft state + save (PATCH replaces the data blob, so it
 * sends the full merged blob). Renders as plain content (no scroll container of its
 * own) so the host drawer supplies the layout.
 */
export function RecordEditFields({
  type,
  record,
  onSaved,
  onCancel,
}: {
  type: EntityTypeDef;
  record: EntityRecord;
  /** Called after a successful save (the host closes / returns to read). */
  onSaved: () => void;
  /** Called when the user cancels out of the editor. */
  onCancel: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(record.name || '');
  const [values, setValues] = useState<Record<string, unknown>>(() => initialValues(type, record));
  const [saving, setSaving] = useState(false);

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
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
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
      <div className="flex gap-2 pt-1">
        <Button onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <button
          onClick={onCancel}
          disabled={saving}
          className="rounded border px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
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
  const [mode, setMode] = useState<'read' | 'edit'>('read');
  const fields = useMemo(() => readFields(type, record), [type, record]);

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
            {type.key === CONTENT_TYPE_KEY ? <TopicDrafts topic={record} /> : null}
            {record.externalId ? (
              <p className="pt-4 text-xs text-neutral-400">external_id: {record.externalId}</p>
            ) : null}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <RecordEditFields
              type={type}
              record={record}
              onSaved={() => {
                onSaved();
                onClose();
              }}
              onCancel={() => setMode('read')}
            />
          </div>
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
 * candidates linked to this topic (via `written_for` OR `topic_ref`), and links
 * each one to the full-page draft editor (/draft/<id>) to edit + mark ready. Only
 * rendered for the content-spine (topic) type; every other type's drawer is
 * untouched.
 */
export function TopicDrafts({ topic }: { topic: EntityRecord }) {
  const qc = useQueryClient();
  const topicId = topic.id;
  const [generating, setGenerating] = useState(false);

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
                <Link
                  href={`/draft/${d.id}`}
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
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

