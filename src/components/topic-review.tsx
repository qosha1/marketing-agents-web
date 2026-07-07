'use client';

/**
 * OGMC topic review workspace — the "live-ranked list" (from the June 30 call).
 *
 * The daily tool: topics ranked by AI rank (highest first), triaged fast without
 * a drawer — set a good/bad/edit verdict, move status, jot a team note. Rejected
 * sink to the bottom (kept, not deleted, so we build a "don't like" list over
 * time); written drop into a Done section. Click a title for the full editor.
 *
 * All writes go through the tenant API (updateEntity). The backend PATCH REPLACES
 * the data blob, so we always send the full merged data ({...record.data, ...}).
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Textarea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  notify,
} from '@startsimpli/ui';
import { ChevronDown, ChevronRight, ThumbsUp, ThumbsDown, PencilLine, ExternalLink, AlertTriangle, ShieldCheck } from 'lucide-react';

import { listAllEntities, listTypes, updateEntity, type EntityRecord } from '@/lib/foundry-api';
import { readData, toCamelKey } from '@/lib/board';
import { EntityDetailDrawer } from '@/components/entity-detail-drawer';

const STATUSES = ['suggested', 'ready', 'rejected', 'written'] as const;
const VERDICTS = [
  { value: 'good', label: 'Good', icon: ThumbsUp, on: 'bg-emerald-600 text-white border-emerald-600' },
  { value: 'bad', label: 'Bad', icon: ThumbsDown, on: 'bg-rose-600 text-white border-rose-600' },
  { value: 'edit', label: 'Edit', icon: PencilLine, on: 'bg-amber-500 text-white border-amber-500' },
] as const;

function field(r: EntityRecord, name: string): string {
  const v = readData(r.data, name);
  return v == null ? '' : String(v);
}
function rankOf(r: EntityRecord): number {
  const n = Number(readData(r.data, 'ai_rank'));
  return Number.isFinite(n) ? n : 0;
}

// The markets we publish for (locks the box — no more "Dubai" vs "Dubai, UAE").
// Edit this list as the coverage changes; the current value is always kept as an
// option even if it's off-list.
const MARKETS = [
  'GCC-wide', 'MENA', 'Saudi Arabia', 'UAE', 'Abu Dhabi (UAE)', 'Dubai (UAE)',
  'Qatar', 'Bahrain', 'Kuwait', 'Oman', 'China',
];

function hostOf(url: string): string {
  try {
    return new URL(/^https?:\/\//.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function TopicReviewWorkspace() {
  const qc = useQueryClient();
  const typesQ = useQuery({ queryKey: ['schema-types'], queryFn: () => listTypes() });
  const topicType = typesQ.data?.results.find((t) => t.key === 'topic');
  const recordsQ = useQuery({
    queryKey: ['entities', 'topic', 'all'],
    queryFn: () => listAllEntities('topic'),
    enabled: !!topicType,
  });
  const records = recordsQ.data ?? [];

  // Approved-source whitelist -> domain→tier, so a topic's sources can be badged
  // by trust tier (tier 1 = trusted outlet; unlisted = a flag to check). This is
  // the "publish facts, not op-eds" signal from the call.
  const sourcesQ = useQuery({
    queryKey: ['entities', 'source', 'all'],
    queryFn: () => listAllEntities('source'),
    enabled: !!topicType,
  });
  const tierByDomain = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sourcesQ.data ?? []) {
      const d = String(readData(s.data, 'domain') ?? '').replace(/^www\./, '').toLowerCase();
      const t = Number(readData(s.data, 'tier'));
      if (d) m.set(d, Number.isFinite(t) ? t : 0);
    }
    return m;
  }, [sourcesQ.data]);

  const [selected, setSelected] = useState<EntityRecord | null>(null);
  const [showRejected, setShowRejected] = useState(false);
  const [showWritten, setShowWritten] = useState(false);

  const { active, written, rejected } = useMemo(() => {
    const a: EntityRecord[] = [];
    const w: EntityRecord[] = [];
    const rej: EntityRecord[] = [];
    for (const r of records) {
      const s = field(r, 'status');
      if (s === 'rejected') rej.push(r);
      else if (s === 'written') w.push(r);
      else a.push(r);
    }
    const byRank = (x: EntityRecord, y: EntityRecord) => rankOf(y) - rankOf(x);
    return { active: a.sort(byRank), written: w.sort(byRank), rejected: rej.sort(byRank) };
  }, [records]);

  async function patch(record: EntityRecord, changes: Record<string, unknown>) {
    const data: Record<string, unknown> = { ...record.data };
    for (const [k, v] of Object.entries(changes)) data[toCamelKey(k)] = v;
    try {
      await updateEntity(record.id, { data });
      await qc.invalidateQueries({ queryKey: ['entities', 'topic'] });
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Could not save.');
    }
  }

  if (typesQ.isLoading || recordsQ.isLoading) {
    return <p className="text-sm text-gray-500">Loading topics…</p>;
  }
  if (!topicType) {
    return <p className="text-sm text-gray-500">No “topic” type is defined for this app.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Topic review</h1>
          <p className="text-sm text-gray-500">
            Ranked by AI. Rate each topic, jot a note, and move it along — rejected sink to the bottom.
          </p>
        </div>
        <span className="text-sm text-gray-500">
          {active.length} to review · {written.length} written · {rejected.length} rejected
        </span>
      </div>

      {active.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
          Nothing to review right now.
        </p>
      ) : (
        <ol className="space-y-3">
          {active.map((r, i) => (
            <TopicRow key={String(r.id)} rank={i + 1} record={r} onOpen={() => setSelected(r)} onPatch={patch} tierByDomain={tierByDomain} />
          ))}
        </ol>
      )}

      {/* Written — done, tucked below. */}
      {written.length > 0 && (
        <Section
          label={`Written (${written.length})`}
          open={showWritten}
          onToggle={() => setShowWritten((v) => !v)}
        >
          <ol className="space-y-3">
            {written.map((r) => (
              <TopicRow key={String(r.id)} record={r} onOpen={() => setSelected(r)} onPatch={patch} tierByDomain={tierByDomain} muted />
            ))}
          </ol>
        </Section>
      )}

      {/* Rejected — kept, at the very bottom. */}
      {rejected.length > 0 && (
        <Section
          label={`Rejected (${rejected.length})`}
          open={showRejected}
          onToggle={() => setShowRejected((v) => !v)}
        >
          <ol className="space-y-3">
            {rejected.map((r) => (
              <TopicRow key={String(r.id)} record={r} onOpen={() => setSelected(r)} onPatch={patch} tierByDomain={tierByDomain} muted />
            ))}
          </ol>
        </Section>
      )}

      {topicType && (
        <EntityDetailDrawer
          type={topicType}
          record={selected}
          onClose={() => setSelected(null)}
          onSaved={() => recordsQ.refetch()}
        />
      )}
    </div>
  );
}

function Section({
  label,
  open,
  onToggle,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1.5 text-sm font-semibold text-gray-500 hover:text-gray-900"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        {label}
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

function TopicRow({
  record,
  rank,
  onOpen,
  onPatch,
  tierByDomain,
  muted,
}: {
  record: EntityRecord;
  rank?: number;
  onOpen: () => void;
  onPatch: (r: EntityRecord, changes: Record<string, unknown>) => Promise<void>;
  tierByDomain: Map<string, number>;
  muted?: boolean;
}) {
  const title = field(record, 'title') || record.name || `#${record.id}`;
  const angle = field(record, 'angle');
  const market = field(record, 'market');
  const contentType = field(record, 'content_type');
  const status = field(record, 'status') || 'suggested';
  const verdict = field(record, 'team_verdict');
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState(field(record, 'team_notes'));
  const [savingNote, setSavingNote] = useState(false);

  async function saveNote() {
    setSavingNote(true);
    await onPatch(record, { team_notes: note });
    setSavingNote(false);
    setNoteOpen(false);
  }

  return (
    <li className={`rounded-lg border border-border bg-card p-4 ${muted ? 'opacity-70' : ''}`}>
      <div className="flex items-start gap-3">
        {rank != null && (
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-50 text-xs font-semibold text-primary-700">
            {rank}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <button type="button" onClick={onOpen} className="min-w-0 text-left">
              <span className="font-semibold text-gray-900 hover:underline">{title}</span>
            </button>
            <button
              type="button"
              onClick={onOpen}
              className="shrink-0 text-gray-400 hover:text-gray-700"
              aria-label="Open topic"
            >
              <ExternalLink className="h-4 w-4" />
            </button>
          </div>
          {angle && <p className="mt-1 line-clamp-2 text-sm text-gray-600">{angle}</p>}

          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            {/* Market — a locked dropdown (kills the "Dubai" vs "Dubai, UAE" drift). */}
            <Select value={market || undefined} onValueChange={(val) => onPatch(record, { market: val })}>
              <SelectTrigger className="h-7 w-auto min-w-[8rem] gap-1 text-xs">
                <SelectValue placeholder="Set market" />
              </SelectTrigger>
              <SelectContent>
                {[...new Set([...(market ? [market] : []), ...MARKETS])].map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {contentType && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">
                {contentType.replace(/_/g, ' ')}
              </span>
            )}
          </div>

          {/* Sources — the fact-check surface. Each source is clickable + badged by
              trust tier from the approved-source whitelist. No sources = a flag. */}
          <TopicSources record={record} tierByDomain={tierByDomain} />

          {/* Triage controls */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {/* Verdict */}
            <div className="flex overflow-hidden rounded-md border border-border">
              {VERDICTS.map((v) => {
                const active = verdict === v.value;
                const Icon = v.icon;
                return (
                  <button
                    key={v.value}
                    type="button"
                    onClick={() => onPatch(record, { team_verdict: active ? '' : v.value })}
                    className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium transition ${
                      active ? v.on : 'bg-white text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" /> {v.label}
                  </button>
                );
              })}
            </div>

            {/* Status */}
            <Select value={status} onValueChange={(val) => onPatch(record, { status: val })}>
              <SelectTrigger className="h-8 w-36 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Notes */}
            <Button variant="outline" size="sm" onClick={() => setNoteOpen((v) => !v)} className="text-xs">
              {note ? 'Note ✓' : 'Add note'}
            </Button>
          </div>

          {noteOpen && (
            <div className="mt-2 space-y-2">
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="Quick note for the AI — e.g. “sources don’t validate; topic is good, angle too broad.”"
                className="text-sm"
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={saveNote} disabled={savingNote}>
                  {savingNote ? 'Saving…' : 'Save note'}
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setNote(field(record, 'team_notes')); setNoteOpen(false); }}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
          {!noteOpen && note && <p className="mt-2 border-l-2 border-gray-200 pl-2 text-xs italic text-gray-500">{note}</p>}
        </div>
      </div>
    </li>
  );
}

function TopicSources({
  record,
  tierByDomain,
}: {
  record: EntityRecord;
  tierByDomain: Map<string, number>;
}) {
  const sources = [1, 2, 3].map((i) => field(record, `source_${i}`)).filter(Boolean);
  if (sources.length === 0) {
    return (
      <p className="mt-2 flex items-center gap-1 text-xs font-medium text-amber-600">
        <AlertTriangle className="h-3.5 w-3.5" /> No sources — needs verification
      </p>
    );
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-gray-400">Sources:</span>
      {sources.map((s, i) => {
        const host = hostOf(s);
        const tier = host ? tierByDomain.get(host.toLowerCase()) : undefined;
        const href = /^https?:\/\//.test(s) ? s : host ? `https://${s}` : undefined;
        const chip = (
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-white px-2 py-0.5 text-xs text-gray-700">
            {tier === 1 && <ShieldCheck className="h-3 w-3 text-emerald-600" />}
            <span className="max-w-[12rem] truncate">{host || s}</span>
            {tier != null ? (
              <span
                className={`rounded px-1 text-[10px] font-semibold ${
                  tier === 1 ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
                }`}
              >
                T{tier}
              </span>
            ) : (
              <span className="rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-700">unlisted</span>
            )}
            {href && <ExternalLink className="h-3 w-3 text-gray-400" />}
          </span>
        );
        return href ? (
          <a key={i} href={href} target="_blank" rel="noreferrer" className="hover:opacity-80">
            {chip}
          </a>
        ) : (
          <span key={i}>{chip}</span>
        );
      })}
    </div>
  );
}
