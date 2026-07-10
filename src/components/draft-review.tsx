'use client';

/**
 * OGMC draft review workspace — the "3 candidates, pick 1, then review it" surface
 * (from the June 24 call), bd startsim-768w.18.5 / .18.6.
 *
 * The n8n writer emits N candidate drafts per ready topic. This is where the team
 * COMPARES a story's candidates side by side, PICKS the one to publish, reads the
 * full draft (blog + LinkedIn + SEO), and checks it against the isolated Content
 * Judge + the auto-checks (word count / hype / approved sources) before marking
 * the chosen final "ready to post" (posting stays a manual step).
 *
 * Drafts carry no stored parent-topic id, so candidates are clustered by their
 * shared primary source (see lib/drafts). All writes go through the tenant API;
 * the backend PATCH REPLACES the data blob, so we always send the full merged
 * data ({...record.data, ...}).
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Badge, notify } from '@startsimpli/ui';
import { MarkdownRenderer } from '@startsimpli/ui/blog';
import { ShieldCheck, AlertTriangle, ExternalLink, CheckCircle2, Circle } from 'lucide-react';

import { listAllEntities, listTypes, updateEntity, type EntityRecord } from '@/lib/foundry-api';
import { readData, toCamelKey } from '@/lib/board';
import {
  groupDrafts,
  parseSources,
  candidateTitle,
  candidateIndex,
  isChosen,
  gradeWords,
  wordTargets,
  type DraftGroup,
  type DraftSource,
  type CheckStatus,
} from '@/lib/drafts';

function field(r: EntityRecord, name: string): string {
  const v = readData(r.data, name);
  return v == null ? '' : String(v);
}
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
/** camel-first read of a nested json key (the api client camelCases the blob). */
function get(o: Record<string, unknown>, camel: string, snake: string): unknown {
  return o[camel] ?? o[snake];
}
function hostOf(url: string): string {
  try {
    return new URL(/^https?:\/\//.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function DraftReviewWorkspace() {
  const qc = useQueryClient();
  const typesQ = useQuery({ queryKey: ['schema-types'], queryFn: () => listTypes() });
  const draftType = typesQ.data?.results.find((t) => t.key === 'draft');
  const recordsQ = useQuery({
    queryKey: ['entities', 'draft', 'all'],
    queryFn: () => listAllEntities('draft'),
    enabled: !!draftType,
  });
  const records = recordsQ.data ?? [];

  // Approved-source whitelist -> domain→tier, so a draft's sources can be badged
  // by trust tier (same signal as the topic review).
  const sourcesQ = useQuery({
    queryKey: ['entities', 'source', 'all'],
    queryFn: () => listAllEntities('source'),
    enabled: !!draftType,
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

  const groups = useMemo(() => groupDrafts(records), [records]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  async function writeEntity(record: EntityRecord, changes: Record<string, unknown>) {
    const data: Record<string, unknown> = { ...record.data };
    for (const [k, v] of Object.entries(changes)) data[toCamelKey(k)] = v;
    return updateEntity(record.id, { data });
  }

  async function pick(group: DraftGroup, cand: EntityRecord) {
    setBusyKey(group.key);
    try {
      await Promise.all(
        group.candidates.map((c) =>
          writeEntity(c, {
            chosen: String(c.id) === String(cand.id),
            status:
              String(c.id) === String(cand.id)
                ? 'selected'
                : field(c, 'status') === 'ready'
                  ? 'ready'
                  : '',
          }),
        ),
      );
      await qc.invalidateQueries({ queryKey: ['entities', 'draft'] });
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Could not save the pick.');
    } finally {
      setBusyKey(null);
    }
  }

  async function markReady(record: EntityRecord) {
    setBusyKey(String(record.id));
    try {
      // Terminal state: the human-approved final is ready to post. Posting itself
      // stays a manual step (templates), so we mark, not deliver.
      await writeEntity(record, { status: 'ready', chosen: true });
      await qc.invalidateQueries({ queryKey: ['entities', 'draft'] });
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Could not mark ready.');
    } finally {
      setBusyKey(null);
    }
  }

  if (typesQ.isLoading || recordsQ.isLoading) {
    return <p className="text-sm text-gray-500">Loading drafts…</p>;
  }
  if (!draftType) {
    return <p className="text-sm text-gray-500">No “draft” type is defined for this app.</p>;
  }

  const pickedCount = groups.filter((g) => g.chosen).length;
  const readyCount = groups.filter((g) => g.ready).length;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Draft review</h1>
          <p className="text-sm text-gray-500">
            Each story has a few AI-written candidates. Compare them, pick the one to publish, and check it against the
            judge before approving.
          </p>
        </div>
        <span className="text-sm text-gray-500">
          {groups.length} stories · {pickedCount} picked · {readyCount} ready to post
        </span>
      </div>

      {groups.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
          No drafts yet. Move a topic to “ready” and the writer will generate candidates here.
        </p>
      ) : (
        <ol className="space-y-4">
          {groups.map((g) => (
            <StoryGroup
              key={g.key}
              group={g}
              tierByDomain={tierByDomain}
              openId={openId}
              onToggleOpen={(id) => setOpenId((cur) => (cur === id ? null : id))}
              onPick={pick}
              onMarkReady={markReady}
              busy={busyKey === g.key}
              busyId={busyKey}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function StoryGroup({
  group,
  tierByDomain,
  openId,
  onToggleOpen,
  onPick,
  onMarkReady,
  busy,
  busyId,
}: {
  group: DraftGroup;
  tierByDomain: Map<string, number>;
  openId: string | null;
  onToggleOpen: (id: string) => void;
  onPick: (g: DraftGroup, c: EntityRecord) => Promise<void>;
  onMarkReady: (c: EntityRecord) => Promise<void>;
  busy: boolean;
  busyId: string | null;
}) {
  const headSources = parseSources(readData(group.candidates[0].data, 'sources'));
  return (
    <li className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold text-gray-900">{group.label}</h2>
        {group.contentType && (
          <Badge variant="secondary" className="text-xs">
            {group.contentType.replace(/_/g, ' ')}
          </Badge>
        )}
        <span className="text-xs text-gray-400">
          {group.candidates.length} candidate{group.candidates.length === 1 ? '' : 's'}
        </span>
        {group.ready && <Badge className="bg-emerald-600 text-xs text-white">ready to post</Badge>}
      </div>

      <SourceChips sources={headSources} tierByDomain={tierByDomain} />

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {group.candidates.map((c) => (
          <CandidateCard
            key={String(c.id)}
            record={c}
            contentType={group.contentType}
            open={openId === String(c.id)}
            onToggle={() => onToggleOpen(String(c.id))}
            onPick={() => onPick(group, c)}
            picking={busy}
          />
        ))}
      </div>

      {group.candidates
        .filter((c) => openId === String(c.id))
        .map((c) => (
          <ContentReview
            key={`rev-${c.id}`}
            record={c}
            contentType={group.contentType}
            onMarkReady={() => onMarkReady(c)}
            marking={busyId === String(c.id)}
          />
        ))}
    </li>
  );
}

function CandidateCard({
  record,
  contentType,
  open,
  onToggle,
  onPick,
  picking,
}: {
  record: EntityRecord;
  contentType: string;
  open: boolean;
  onToggle: () => void;
  onPick: () => void;
  picking: boolean;
}) {
  const chosen = isChosen(record);
  const status = field(record, 'status');
  const preview = field(record, 'blog').slice(0, 150);
  const checks = obj(readData(record.data, 'auto_checks'));
  const blogWords = Number(get(checks, 'blogWords', 'blog_words')) || 0;
  const target = wordTargets(contentType).blog;
  return (
    <div
      className={`flex flex-col rounded-md border p-3 ${
        chosen ? 'border-emerald-400 bg-emerald-50/40' : 'border-border bg-white'
      }`}
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          Candidate {candidateIndex(record) || '—'}
        </span>
        {status === 'ready' ? (
          <Badge className="bg-emerald-600 text-[10px] text-white">ready</Badge>
        ) : chosen ? (
          <Badge className="bg-emerald-100 text-[10px] text-emerald-700">picked</Badge>
        ) : null}
      </div>
      <p className="line-clamp-2 text-sm font-medium text-gray-900">{candidateTitle(record)}</p>
      <p className="mt-1 line-clamp-3 text-xs text-gray-500">{preview}…</p>

      <div className="mt-2 flex flex-wrap gap-1">
        <WordChip label="blog" count={blogWords} status={gradeWords(blogWords, target)} />
        <JudgeChip record={record} />
      </div>

      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          variant={chosen ? 'secondary' : 'default'}
          disabled={picking}
          onClick={onPick}
          className="text-xs"
        >
          {chosen ? (
            <>
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Picked
            </>
          ) : (
            <>
              <Circle className="mr-1 h-3.5 w-3.5" /> Pick
            </>
          )}
        </Button>
        <Button size="sm" variant="outline" onClick={onToggle} className="text-xs">
          {open ? 'Hide' : 'Review'}
        </Button>
      </div>
    </div>
  );
}

function ContentReview({
  record,
  contentType,
  onMarkReady,
  marking,
}: {
  record: EntityRecord;
  contentType: string;
  onMarkReady: () => void;
  marking: boolean;
}) {
  const blog = field(record, 'blog');
  const linkedin = field(record, 'linkedin');
  const seo = obj(readData(record.data, 'seo'));
  const judge = obj(readData(record.data, 'judge_verdict'));
  const checks = obj(readData(record.data, 'auto_checks'));
  const ready = field(record, 'status') === 'ready';

  const tags = ((): string[] => {
    const t = seo.tags;
    if (Array.isArray(t)) return t.map(String);
    if (typeof t === 'string') return t.split(',').map((s) => s.trim()).filter(Boolean);
    return [];
  })();

  const targets = wordTargets(contentType);
  const blogWords = Number(get(checks, 'blogWords', 'blog_words')) || 0;
  const liWords = Number(get(checks, 'linkedinWords', 'linkedin_words')) || 0;
  const hype = get(checks, 'hypeFlags', 'hype_flags');
  const approvedSources = get(checks, 'approvedSources', 'approved_sources');

  const issues = Array.isArray(judge.issues) ? (judge.issues as Record<string, unknown>[]) : [];
  const verdict = String(judge.verdict ?? '');
  const summary = String(judge.summary ?? '');
  const scores = obj(judge.scores);

  return (
    <div className="mt-4 rounded-lg border border-border bg-gray-50/60 p-4">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* Left: the draft itself */}
        <div className="min-w-0 space-y-4">
          <section>
            <SectionLabel>Blog post</SectionLabel>
            {blog ? (
              <div className="rounded-md border border-border bg-white p-4">
                <MarkdownRenderer content={blog} />
              </div>
            ) : (
              <Empty>No blog body.</Empty>
            )}
          </section>

          {linkedin && (
            <section>
              <SectionLabel>LinkedIn post</SectionLabel>
              <p className="whitespace-pre-wrap rounded-md border border-border bg-white p-4 text-sm text-gray-800">
                {linkedin}
              </p>
            </section>
          )}

          {(seo.metaDescription || seo.meta_description || seo.primaryKeyword || seo.primary_keyword || tags.length > 0) && (
            <section>
              <SectionLabel>SEO</SectionLabel>
              <div className="space-y-1.5 rounded-md border border-border bg-white p-4 text-sm">
                <p>
                  <span className="text-gray-400">Meta:</span>{' '}
                  {String(get(seo, 'metaDescription', 'meta_description') ?? '—')}
                </p>
                <p>
                  <span className="text-gray-400">Keyword:</span>{' '}
                  {String(get(seo, 'primaryKeyword', 'primary_keyword') ?? '—')}
                </p>
                {tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {tags.map((t) => (
                      <Badge key={t} variant="outline" className="text-[10px]">
                        {t}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}
        </div>

        {/* Right: judge verdict + auto-checks + approve */}
        <div className="space-y-4">
          <section>
            <SectionLabel>Content judge</SectionLabel>
            <div className="space-y-2 rounded-md border border-border bg-white p-3">
              <div className="flex items-center gap-2">
                <VerdictBadge verdict={verdict} issueCount={issues.length} />
                {summary && <span className="text-xs text-gray-600">{summary}</span>}
              </div>
              {Object.keys(scores).length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {Object.entries(scores).map(([k, v]) => (
                    <Badge key={k} variant="outline" className="text-[10px]">
                      {k.replace(/_/g, ' ')} {String(v)}
                    </Badge>
                  ))}
                </div>
              )}
              {issues.length === 0 ? (
                <p className="flex items-center gap-1 text-xs text-emerald-700">
                  <ShieldCheck className="h-3.5 w-3.5" /> No issues flagged.
                </p>
              ) : (
                <ul className="space-y-2">
                  {issues.map((it, i) => (
                    <li key={i} className="rounded border border-amber-200 bg-amber-50 p-2 text-xs">
                      <div className="mb-0.5 flex items-center gap-1.5">
                        <AlertTriangle className="h-3 w-3 text-amber-600" />
                        {it.severity ? <SeverityBadge severity={String(it.severity)} /> : null}
                        {it.guardrail ? <span className="font-medium text-amber-800">{String(it.guardrail)}</span> : null}
                      </div>
                      {it.problem ? <p className="text-gray-700">{String(it.problem)}</p> : null}
                      {it.fix ? <p className="mt-1 text-gray-500">Fix: {String(it.fix)}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section>
            <SectionLabel>Auto-checks</SectionLabel>
            <div className="flex flex-wrap gap-1.5 rounded-md border border-border bg-white p-3">
              <WordChip label="blog" count={blogWords} status={gradeWords(blogWords, targets.blog)} />
              <WordChip label="linkedin" count={liWords} status={gradeWords(liWords, targets.linkedin)} />
              {Array.isArray(hype) && (
                <Badge
                  variant="outline"
                  className={`text-[10px] ${hype.length === 0 ? 'text-emerald-700' : 'text-amber-700'}`}
                >
                  {hype.length === 0 ? 'no hype' : `${hype.length} hype flag${hype.length === 1 ? '' : 's'}`}
                </Badge>
              )}
              {approvedSources != null && (
                <Badge
                  variant="outline"
                  className={`text-[10px] ${approvedSources ? 'text-emerald-700' : 'text-rose-700'}`}
                >
                  sources {approvedSources ? 'approved' : 'unverified'}
                </Badge>
              )}
            </div>
          </section>

          <Button onClick={onMarkReady} disabled={marking || ready} className="w-full">
            {ready ? (
              <>
                <CheckCircle2 className="mr-1.5 h-4 w-4" /> Ready to post
              </>
            ) : marking ? (
              'Saving…'
            ) : (
              'Mark ready to post'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SourceChips({ sources, tierByDomain }: { sources: DraftSource[]; tierByDomain: Map<string, number> }) {
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
        const host = hostOf(s.url);
        const tier = host ? tierByDomain.get(host.toLowerCase()) : undefined;
        const href = /^https?:\/\//.test(s.url) ? s.url : host ? `https://${s.url}` : undefined;
        const chip = (
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-white px-2 py-0.5 text-xs text-gray-700">
            {tier === 1 && <ShieldCheck className="h-3 w-3 text-emerald-600" />}
            <span className="max-w-[12rem] truncate">{s.outlet || host || s.url}</span>
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

function JudgeChip({ record }: { record: EntityRecord }) {
  const judge = obj(readData(record.data, 'judge_verdict'));
  const verdict = String(judge.verdict ?? '');
  const issues = Array.isArray(judge.issues) ? (judge.issues as unknown[]).length : 0;
  if (verdict === 'accept') return <Badge variant="outline" className="text-[10px] text-emerald-700">judge: accept</Badge>;
  if (verdict && verdict !== 'accept') return <Badge variant="outline" className="text-[10px] text-rose-700">judge: {verdict}</Badge>;
  if (issues > 0) return <Badge variant="outline" className="text-[10px] text-amber-700">{issues} issue{issues === 1 ? '' : 's'}</Badge>;
  return <Badge variant="outline" className="text-[10px] text-gray-500">unjudged</Badge>;
}

function WordChip({ label, count, status }: { label: string; count: number; status: CheckStatus }) {
  if (status === 'none' && count === 0) return null;
  const tone =
    status === 'ok' ? 'text-emerald-700' : status === 'none' ? 'text-gray-500' : 'text-amber-700';
  return (
    <Badge variant="outline" className={`text-[10px] ${tone}`}>
      {label} {count}w{status === 'low' ? ' ↓' : status === 'high' ? ' ↑' : ''}
    </Badge>
  );
}

function VerdictBadge({ verdict, issueCount }: { verdict: string; issueCount: number }) {
  if (verdict === 'accept') return <Badge className="bg-emerald-600 text-xs text-white">accept</Badge>;
  if (verdict) return <Badge className="bg-rose-600 text-xs text-white">{verdict}</Badge>;
  return (
    <Badge className={`text-xs ${issueCount ? 'bg-amber-500 text-white' : 'bg-gray-400 text-white'}`}>
      {issueCount ? `${issueCount} issue${issueCount === 1 ? '' : 's'}` : 'reviewed'}
    </Badge>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, string> = {
    high: 'bg-rose-100 text-rose-700',
    medium: 'bg-amber-100 text-amber-700',
    low: 'bg-gray-100 text-gray-600',
  };
  return <span className={`rounded px-1 text-[10px] font-semibold ${map[severity] ?? map.low}`}>{severity}</span>;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">{children}</p>;
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md border border-dashed border-gray-300 p-3 text-xs text-gray-400">{children}</p>;
}
