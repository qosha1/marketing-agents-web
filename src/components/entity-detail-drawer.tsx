'use client';

/**
 * Generic, schema-driven record drawer (bd ogmc-9ms.1.9; readable detail startsim-768w.17.6).
 * Opens READ-FIRST: renders every declared attribute read-optimized via the shared
 * @startsimpli/ui RecordDetail (long-text bodies as readable prose, urls as links) so a
 * full article is comfortable to read. An "Edit" toggle reveals the editable form
 * (AttributeField widgets) + Save. Preserves non-declared data keys and canonicalizes to
 * the client's camelCase blob so a PATCH (which REPLACES data) never drops fields.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Input,
  Label,
  notify,
  RecordDetail,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  type RecordField,
} from '@startsimpli/ui';

import { resolveReviewConfig } from '@startsimpli/ui/collection';

import { AttributeField } from './attribute-field';
import { getRegisteredToken } from '@/infrastructure/auth';
import { formatBearer } from '@/lib/bearer';
import { readData, toCamelKey } from '@/lib/board';
import { CONTENT_TYPE_KEY } from '@/lib/content';
import { memberDisplayName, memberSub, normalizeMembers } from '@/lib/roster';
import { findTag, GOOD_EXAMPLE_LABEL } from '@/lib/tags';
import {
  GENERATE_POLL_MS,
  GENERATE_TICK_MS,
  generatePollMessage,
  isGeneratePollFailure,
} from '@/lib/generate-poll';
import {
  endGenerateRun,
  generateRunDecision,
  generateRunStopped,
  isGenerateRunning,
  mountGenerateRun,
  noteGenerateCount,
  noteGeneratePoll,
  startGenerateRun,
  unmountGenerateRun,
} from '@/lib/generate-run';
import {
  buildStoryFromTopic,
  canGenerateDrafts,
  draftCandidateIndex,
  draftJudgeVerdict,
  draftStatus,
  draftTitle,
  fetchTopicDrafts,
} from '@/lib/topic-drafts';
import {
  createTag,
  deleteTag,
  listAllTags,
  orgMembers,
  updateEntity,
  type EntityRecord,
  type EntityTypeDef,
} from '@/lib/foundry-api';

/** Name convention (any type, not just topic/draft) that upgrades the two plain
 *  text fields into one roster picker (startsim-71z6). */
const ASSIGNEE_SUB_ATTR = 'assignee_sub';
const ASSIGNEE_NAME_ATTR = 'assignee_name';
const UNASSIGNED_VALUE = '__unassigned__';

/**
 * "Mark as good example" toggle (startsim-iegx) — generic Tag affordance for ANY
 * entity type, not topic-specific. A tag's presence/absence over
 * {entity, label:'good_example'} IS the toggle state. The backend has no
 * `?entity=` filter, so this fetches the (bounded) full tag set and finds this
 * record's own tag client-side.
 */
export function GoodExampleToggle({ record }: { record: EntityRecord }) {
  const qc = useQueryClient();
  const tagsQuery = useQuery({ queryKey: ['tags', 'all'], queryFn: () => listAllTags() });
  const [pending, setPending] = useState(false);
  const mine = findTag(tagsQuery.data ?? [], record.id, GOOD_EXAMPLE_LABEL);

  async function toggle() {
    setPending(true);
    try {
      if (mine) {
        await deleteTag(mine.id);
      } else {
        await createTag({ entity: record.id, label: GOOD_EXAMPLE_LABEL });
      }
      await qc.invalidateQueries({ queryKey: ['tags'] });
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Could not update the tag.');
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending || tagsQuery.isLoading}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-50 ${
        mine
          ? 'border-amber-300 bg-amber-50 text-amber-700'
          : 'border-neutral-200 text-neutral-500 hover:bg-neutral-50'
      }`}
    >
      <span aria-hidden>{mine ? '★' : '☆'}</span> Good example
    </button>
  );
}

/**
 * Roster picker for the `assignee_sub`/`assignee_name` attribute pair
 * (startsim-71z6) — writes both together so they never drift apart. Sourced
 * from GET /api/v1/org/members/, which needs an admin-tier bearer (bd
 * startsim-q79l): a non-admin caller gets a 403, so this degrades to a plain
 * text input on ANY roster-fetch error rather than losing the field entirely.
 */
function AssigneePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (sub: string, name: string) => void;
}) {
  const membersQuery = useQuery({ queryKey: ['org-members'], queryFn: () => orgMembers() });

  if (membersQuery.isError) {
    return (
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value, e.target.value)}
        placeholder="assignee_sub (roster unavailable — admin role required)"
      />
    );
  }

  const members = membersQuery.data ? normalizeMembers(membersQuery.data) : [];

  return (
    <Select
      value={value || UNASSIGNED_VALUE}
      onValueChange={(sub) => {
        if (sub === UNASSIGNED_VALUE) {
          onChange('', '');
          return;
        }
        const m = members.find((mm) => memberSub(mm) === sub);
        onChange(sub, m ? memberDisplayName(m) : '');
      }}
    >
      <SelectTrigger>
        <SelectValue placeholder={membersQuery.isLoading ? 'Loading…' : 'Unassigned'} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNASSIGNED_VALUE}>Unassigned</SelectItem>
        {members.map((m) => {
          const sub = memberSub(m);
          return sub ? (
            <SelectItem key={sub} value={sub}>
              {memberDisplayName(m)}
            </SelectItem>
          ) : null;
        })}
      </SelectContent>
    </Select>
  );
}

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
      {(() => {
        // Assignee name-convention (any type, not just topic/draft): both
        // halves declared -> ONE roster picker writes them together instead
        // of two independently-typed text rows that can drift.
        const hasAssigneePair =
          type.attributes.some((a) => a.name === ASSIGNEE_SUB_ATTR) &&
          type.attributes.some((a) => a.name === ASSIGNEE_NAME_ATTR);
        return type.attributes
          .filter((attr) => !(hasAssigneePair && attr.name === ASSIGNEE_NAME_ATTR))
          .map((attr) =>
            hasAssigneePair && attr.name === ASSIGNEE_SUB_ATTR ? (
              <div key={String(attr.id)} className="space-y-1.5">
                <Label>Assignee</Label>
                <AssigneePicker
                  value={String(values[ASSIGNEE_SUB_ATTR] ?? '')}
                  onChange={(sub, assigneeName) =>
                    setValues((prev) => ({
                      ...prev,
                      [ASSIGNEE_SUB_ATTR]: sub,
                      [ASSIGNEE_NAME_ATTR]: assigneeName,
                    }))
                  }
                />
              </div>
            ) : (
              <div key={String(attr.id)} className="space-y-1.5">
                <Label className="capitalize">{attr.name.replace(/_/g, ' ')}</Label>
                <AttributeField
                  attr={attr}
                  value={values[attr.name]}
                  onChange={(val) => setValues((prev) => ({ ...prev, [attr.name]: val }))}
                />
              </div>
            ),
          );
      })()}
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
            <GoodExampleToggle record={record} />
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
            {type.key === CONTENT_TYPE_KEY ? <TopicDrafts topic={record} type={type} /> : null}
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


/**
 * A topic's candidate drafts + the write→review→edit→confirm loop (bd 768w.16.9.4/.5).
 *
 * Fires the n8n writer ("Generate drafts" → /actions/generate-drafts — NOT /api,
 * which the tenant nginx routes to Django), polls for the candidates it produces
 * (the when-to-stop-looking rules live in `@/lib/generate-poll`), lists the
 * candidates linked to this topic (via `written_for` OR `topic_ref`), and links
 * each one to the full-page draft editor (/draft/<id>) to edit + mark ready. Only
 * rendered for the content-spine (topic) type; every other type's drawer is
 * untouched.
 */
export function TopicDrafts({ topic, type }: { topic: EntityRecord; type: EntityTypeDef }) {
  const qc = useQueryClient();
  const topicId = topic.id;
  // SEEDED FROM THE RUN STORE, not from `false` (bd startsim-ozpjw.9). This
  // component is destroyed and rebuilt by j/k, the arrow keys, the chevrons, the
  // auto-advance after a decision, "Edit fields" and Close — none of which mean
  // "stop watching a writer that is still running". The run lives in
  // `@/lib/generate-run`, keyed by topic id; a fresh instance rejoins it. These
  // two pieces of state are the render mirror of the store, driven by the ticker.
  //
  // DELIBERATELY `isGenerateRunning` AND NOT `generateRunDecision(...).keepPolling`.
  // Seeding from the decision looks tighter — it would skip one poll interval for a
  // run that expired while the drawer was shut — but a `useState` initializer runs
  // during RENDER, before the mount effect below has refreshed the contact point.
  // It would therefore read a `polledAt` from before the drawer closed, and any
  // absence longer than GENERATE_STALL_MS would evaluate as `lost_contact`, seed
  // `generating` false, and never resume the poll. That is this very bug in a new
  // costume. Whether a run EXISTS is order-independent; what to do about it is not,
  // so the ticker (which runs after the rejoin) owns every decision.
  const [generating, setGenerating] = useState(() => isGenerateRunning(topicId));
  // WHY the wait ended, once it has. This is the half of startsim-tkz9d that was
  // missing: the old code stopped polling at 90s and said nothing, so a writer
  // still running read as "this topic has no drafts" and the only cure was a
  // browser reload. A terminal state that isn't rendered is the bug.
  const [stopped, setStopped] = useState(() => generateRunStopped(topicId));
  // The SAME resolved review map ReviewDrawer/InlineReviewActions derive their
  // Approve button from, so the gate and the Approve action cannot drift apart
  // (bd startsim-0e9ue). No literal approve status is declared here.
  const review = useMemo(() => resolveReviewConfig(type), [type]);

  const draftsQuery = useQuery({
    queryKey: ['topic-drafts', topicId],
    queryFn: () => fetchTopicDrafts(topic),
    // While the writer runs (~2 min, measured), poll so the new candidates appear.
    refetchInterval: generating ? GENERATE_POLL_MS : false,
    // AND, while it runs, never trust the cache on a remount (bd startsim-ozpjw.9).
    // QueryProvider's default is `staleTime: 5 * 60 * 1000` with
    // `refetchOnWindowFocus: false`, so navigating away and back mid-run re-served
    // the CACHED EMPTY LIST without asking — the drafts existed, the drawer just
    // never looked. Resuming the poll alone would still show that stale list for a
    // full interval. Overridden on THIS query only, and only for a live run:
    // `fetchTopicDrafts` pages every relationship plus every draft record, so the
    // 5-minute default is the right one to fall back to when nothing is running.
    // `generating` is already correct on the first render (it is seeded from the
    // store), which is what `refetchOnMount` is read on.
    staleTime: generating ? 0 : undefined,
    refetchOnMount: generating ? 'always' : undefined,
  });
  const drafts = draftsQuery.data ?? [];
  // Unapproved -> refused with a rendered reason; drafts already written ->
  // refused and hidden, so a second run can't add a 4th candidate over a set
  // someone has already reviewed (bd startsim-c8izw).
  //
  // The gate is only MEANINGFUL once the draft count is known: until the query
  // resolves, drafts.length is 0, which is indistinguishable from "no drafts"
  // and would show an enabled button on a topic that already has three. That
  // window is not small — fetchTopicDrafts pages every relationship plus every
  // draft record. An errored query never learns the count at all, so it stays
  // withheld rather than guessing.
  const draftCountKnown = !draftsQuery.isLoading && !draftsQuery.isError;
  const gate = canGenerateDrafts(topic, review, drafts.length);

  const { dataUpdatedAt } = draftsQuery;

  // (0) Join this topic's run, and let go of it without ending it. The clock
  // used to be a `useRef` here, which is exactly why the run died on every
  // remount: a fresh instance re-created it zeroed, so `elapsedMs` came out as
  // "since the epoch" and the very first tick declared the writer silent. It
  // lives in the store now, so all five clock inputs survive the teardown
  // together. Rejoining also refreshes the contact point — a closed drawer was
  // not polling and failing, it was not looking (see `mountGenerateRun`).
  useEffect(() => {
    mountGenerateRun(topicId, Date.now());
    return () => unmountGenerateRun(topicId);
  }, [topicId]);

  // (1) Keep the poll clock current. Writes the STORE only, never state, so it
  // stays plain bookkeeping and the single decision below owns every transition.
  // Both notes are no-ops when no run is in flight for this topic.
  useEffect(() => {
    noteGenerateCount(topicId, drafts.length, Date.now());
    // `dataUpdatedAt` on a remount is the CACHED result's timestamp, from before
    // the drawer closed. `noteGeneratePoll` only ever moves contact forward, so
    // that cannot re-stale the point the rejoin above just refreshed.
    if (dataUpdatedAt) noteGeneratePoll(topicId, dataUpdatedAt);
  }, [topicId, drafts.length, dataUpdatedAt]);

  // (2) ONE ticker owns "are we still waiting?", armed once per run.
  //
  // Deps are [generating, topicId] — neither of which moves during a run — so a
  // cap is still a cap: nothing that happens while the writer works can push the
  // window back. The old timeout took the draft count as a dep, so it cleared and
  // re-armed itself on every change and measured "time since something last
  // moved" instead of capping the run. The window now lives on the run itself, so
  // even re-arming the ticker on a remount cannot extend it.
  //
  // And it TICKS rather than reacting to poll results, so the window is
  // guaranteed to be evaluated when it expires — reacting to refetches would
  // leave the decision to whenever a fetch happened to resolve, which is
  // incidental. The predicate is pure arithmetic over the store; the tick is free.
  //
  // The terminal transition is written to the STORE first and mirrored into state
  // second, so a run that ends is ended for the topic, not merely for whichever
  // instance happened to be watching when the window expired.
  useEffect(() => {
    if (!generating) return;
    const id = setInterval(() => {
      const decision = generateRunDecision(topicId, Date.now());
      if (!decision.terminal) return;
      endGenerateRun(topicId, decision.reason);
      setGenerating(false);
      setStopped(decision.reason);
    }, GENERATE_TICK_MS);
    return () => clearInterval(id);
  }, [generating, topicId]);

  // What the empty list says. A run that ended with nothing MUST say so — falling
  // back to "No drafts written for this topic yet." is the lie that made a slow
  // writer look like a broken button.
  const emptyMessage =
    (generating ? generatePollMessage('waiting') : generatePollMessage(stopped)) ??
    'No drafts written for this topic yet.';
  const emptyIsFailure = !generating && isGeneratePollFailure(stopped);

  async function generate() {
    if (!draftCountKnown || !gate.allowed) return;
    startGenerateRun(topicId, { at: Date.now(), baseline: drafts.length });
    setStopped('idle');
    setGenerating(true);
    try {
      const res = await fetch('/actions/generate-drafts', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // The handler re-checks the gate against the tenant with THIS bearer
          // (bd startsim-ozpjw.2) — it can only start a writer the person who
          // clicked could have started. AWAITED: interpolating the promise sent
          // `Bearer [object Promise]` in the translate action and Django
          // rejected it (see draft/[draftId]/page.tsx).
          authorization: formatBearer(await getRegisteredToken()),
        },
        body: JSON.stringify({ story: buildStoryFromTopic(topic) }),
      });
      if (!res.ok) {
        // The server's refusal carries its own reason ('Approve this topic to
        // generate drafts'). Showing a bare status code instead would make a
        // correct, explainable refusal look like a broken button.
        const detail = await res
          .json()
          .then((b: { error?: string }) => b?.error)
          .catch(() => undefined);
        throw new Error(detail || `Writer request failed (${res.status}).`);
      }
      notify.success('Generating drafts… new candidates appear in ~2 min.');
    } catch (err) {
      // The writer never started, so there is nothing to have waited for: clear
      // the terminal copy and let the toast carry the refusal. Ended in the store
      // too, so navigating away and back doesn't rejoin a run that never began.
      endGenerateRun(topicId, 'idle');
      setGenerating(false);
      setStopped('idle');
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
          {!draftCountKnown ? null : gate.allowed ? (
            <Button onClick={generate} disabled={generating} className="text-xs">
              {generating ? 'Generating… (~2 min)' : 'Generate drafts'}
            </Button>
          ) : gate.reason === 'not_approved' ? (
            <span className="text-xs text-neutral-500">{gate.message}</span>
          ) : null}
        </div>
      </div>

      {draftsQuery.isLoading ? (
        <p className="mt-2 text-sm text-neutral-500">Loading drafts…</p>
      ) : draftsQuery.isError ? (
        <p className="mt-2 text-sm text-neutral-400">Couldn’t load drafts for this topic.</p>
      ) : drafts.length === 0 ? (
        <p className={`mt-2 text-sm ${emptyIsFailure ? 'text-amber-700' : 'text-neutral-400'}`}>
          {emptyMessage}
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

