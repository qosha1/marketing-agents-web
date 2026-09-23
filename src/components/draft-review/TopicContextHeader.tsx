'use client';

/**
 * The topic, at the top of its draft (bd startsim-z384k), and — since
 * bd startsim-m7fdm.7 — the place its text is edited.
 *
 * WHAT IT REPLACES. Until now a reviewer read the topic in a modal — the shared
 * ReviewDrawer over /t/topic — and then left it behind to judge the draft. Quinn
 * on 2026-09-22: "once the topic gets accepted we go straight to the draft detail
 * page where the top contains the stuff about the topic that we have in the
 * modal so its all just 1 page experience." This is that top.
 *
 * IT IS THE SAME FIELD MAP, DERIVED, NOT COPIED. Every attribute below is read
 * through the shared `resolveReviewConfig(type, TOPIC_REVIEW_CONFIG)` — the very
 * object the drawer and both inline clusters resolve. A hand-written list of
 * attribute names here would be a second declaration of "what a topic is", one
 * schema change away from the header and the modal disagreeing about the same
 * record. Nothing here names a topic attribute.
 *
 * TWO THINGS THE MODAL SHOWS THAT THIS DELIBERATELY DOES NOT:
 *
 *  - `ai_rank`. It is a pre-approval triage signal — which of 80 suggestions to
 *    read first. Once the topic is approved and a draft exists it ranks nothing,
 *    and a number with no live meaning next to a decision is noise.
 *  - The topic's `source_1..3` chips. The draft page already owns sources, and
 *    owns them better: SourcesTool plus the Quality rail's approved-source
 *    checks, tier-validated against the live source registry. A second source
 *    list at the top of the same page would be two lists disagreeing about which
 *    sources matter. Filed rather than guessed — see the bead.
 *
 * WHAT IT ADDS that the modal never showed in this context: `team_notes`. That
 * is the instruction a reviewer attached when they said "needs work" — "angle
 * too broad; needs a 2026 source" — and it is the thing the draft was supposed
 * to satisfy. It appeared nowhere on the draft page before.
 *
 * ── EDITING (bd startsim-m7fdm.7) ──────────────────────────────────────────
 *
 * Quinn: "for the draft detail view even if we 'approve' the topic whatever we
 * need to be able to edit the text and description should we want to change it
 * right now we cant." The panel was read-only, so the only way to fix a title
 * was to go back to the table and open the drawer — the round trip this page
 * exists to remove. "Edit topic" turns the same four text fields into a form;
 * WHICH four, and why not status or the kind chips, is argued in lib/topic-edit.ts
 * beside the save path rather than here.
 *
 * WHY THE SAVE LIVES IN THIS COMPONENT and not in a callback the two host pages
 * each implement: /draft/<id> and /story/<id> render this same header, and a
 * `onSave` prop would be two copies of one whole-blob write — which is exactly
 * how the drawer and the draft page came to stamp the edit log differently
 * (bd startsim-m7fdm.3). The draft page still owns all DRAFT persistence; this
 * owns the TOPIC's, because it is the only surface that edits a topic here.
 *
 * COLLAPSING IS DISABLED WHILE EDITING. The panel's one existing control hides
 * its body; hiding a form mid-edit would either drop what was typed or leave it
 * invisibly pending. So the Show/Hide toggle steps aside until Save or Cancel.
 *
 * FORK-LOCAL, like the rest of src/components/draft-review/*. Rule 9 asks
 * whether another foundry fork would want it; the honest answer is "probably,
 * once one exists", which is the same answer startsim-m7fdm.1 gave about the
 * edit log and resolved by extracting it when a second tenant actually wanted
 * it. The reusable half is ALREADY shared and the edit path leans harder on it
 * than the read path did — `writeData` and `declaredBlob` from
 * `@startsimpli/ui/collection` are the shared package's own wire-safety rules,
 * not a second copy of them. What is left here is this tenant's arrangement.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, Pencil } from 'lucide-react';
import { resolveReviewConfig } from '@startsimpli/ui/collection';
import type { EntityRecord, EntityTypeDef } from '@startsimpli/ui/collection';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Input, Label, Textarea, notify } from '@startsimpli/ui';
import { useAuth } from '@startsimpli/auth';

import { readData } from '@/lib/board';
import { contentCategoryLabel } from '@/lib/content';
import { saveEntity } from '@/lib/entity-cache';
import { getEntity } from '@/lib/foundry-api';
import { TOPIC_REVIEW_CONFIG } from '@/lib/review-vocabulary';
import {
  SUBTITLE_ATTR,
  topicEditChanges,
  topicEditData,
  topicEditError,
  topicEditFields,
  topicEditName,
  topicEditValues,
} from '@/lib/topic-edit';

function str(data: Record<string, unknown> | undefined, name: string): string {
  const v = readData(data, name);
  return v == null ? '' : String(v).trim();
}

export interface TopicContextHeaderProps {
  topic: EntityRecord | null;
  /** The topic type, for the shared field map. Absent while the schema loads. */
  type?: EntityTypeDef | null;
  /** Rendered at the top-left — the back link the host owns. */
  backLink?: React.ReactNode;
  /** Rendered at the top-right — the host's own pills / queue controls. */
  actions?: React.ReactNode;
  /** Open on first render. The draft page opens it; the story page always shows it. */
  defaultOpen?: boolean;
  /** Hide the collapse control entirely (the story page IS the topic). */
  alwaysOpen?: boolean;
}

export function TopicContextHeader({
  topic,
  type,
  backLink,
  actions,
  defaultOpen = true,
  alwaysOpen = false,
}: TopicContextHeaderProps) {
  const [open, setOpen] = useState(defaultOpen);
  const cfg = useMemo(() => resolveReviewConfig(type ?? undefined, TOPIC_REVIEW_CONFIG), [type]);
  const qc = useQueryClient();
  // WHO IS EDITING — the email, for the same reason lib/edit-history.ts gives:
  // whoami returns no display name, and a `sub` UUID answers "who?" with a
  // string no reader can resolve.
  const { user } = useAuth();

  const data = topic?.data;
  const title = str(data, cfg.titleAttr) || topic?.name || '';
  const subtitle = str(data, SUBTITLE_ATTR);
  const summary = str(data, cfg.summaryAttr);
  const status = str(data, cfg.statusName);
  const notes = str(data, cfg.noteAttr);
  const chips = cfg.metaAttrs
    .map((a) => ({ attr: a, value: str(data, a) }))
    .filter((c) => c.value !== '');

  // The editable fields exist only once the schema has loaded: their spelling,
  // their control and the re-key pass all come off the declared attributes.
  const fields = useMemo(() => topicEditFields(cfg, type), [cfg, type]);
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  // What the form was seeded with, captured ONCE when it opened. A background
  // refetch landing mid-edit must not move the line between "she changed this"
  // and "she left it alone" — see `topicEditChanges`.
  const [baseline, setBaseline] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const canEdit = !!topic && !!type && fields.length > 0;
  const changes = topicEditChanges(fields, values, baseline);

  function startEditing() {
    const seed = topicEditValues(data, fields);
    setValues(seed);
    setBaseline(seed);
    setEditing(true);
  }

  async function save() {
    if (!topic || !type) return;
    const problem = topicEditError(changes, values);
    if (problem) {
      notify.error(problem);
      return;
    }
    setSaving(true);
    try {
      // RE-READ FIRST, and merge onto what comes back (bd startsim-m7fdm.2). The
      // tenant REPLACES `data` on a PATCH, so a whole-blob write built on the
      // blob this page loaded would undo every change made to the topic since —
      // including ones this form does not even show. It does not FIX the race
      // (startsim-jkkn7 owns the conditional write); it narrows it from "since
      // this page opened" to "since Save was pressed". `topicEditData` reads the
      // edit log out of this same response for the same reason.
      const fresh = await getEntity(topic.id);
      const { data: body } = topicEditData(
        fresh.data,
        type.attributes.map((a) => a.name),
        changes,
        values,
        user?.email,
      );
      // THE TITLE THE TABLE SHOWS IS `record.name`, not `data.title` — the
      // content spine folds title/subtitle/angle into one cell keyed off the
      // name (components/record-columns.ts). Editing only the attribute left
      // the panel saying one thing and the Topics table the reviewer goes back
      // to still saying the old one. `topicEditName` carries the name along
      // when the two were one thing, and leaves a name that genuinely differs.
      // ONLY when the title itself moved — the name follows the same diff rule
      // as every other field, or an angle-only save would write a name derived
      // from a title this reviewer never touched.
      const nextName = changes.some((f) => f.attr === cfg.titleAttr)
        ? topicEditName(fresh.name, str(fresh.data, cfg.titleAttr), values[cfg.titleAttr] ?? '')
        : undefined;
      // `saveEntity`, not a bare `updateEntity`: it writes the server's answer
      // into ['entity', <id>], which is the key both host pages read this topic
      // from — invalidation alone leaves the pre-edit blob on screen for the
      // next render (bd startsim-mk5qp).
      await saveEntity(qc, topic.id, {
        ...(nextName ? { name: nextName } : {}),
        data: body,
      });
      await qc.invalidateQueries({ queryKey: ['entities', type.key] });
      notify.success('Topic saved.');
      setEditing(false);
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Could not save the topic.');
    } finally {
      setSaving(false);
    }
  }

  const showBody = alwaysOpen || open || editing;

  return (
    <section
      aria-label="Topic"
      className="rounded-xl border border-border bg-neutral-50/70 px-4 py-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          {backLink}
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
              Topic
            </span>
            {status ? (
              <span className="rounded-full bg-neutral-200/70 px-2 py-0.5 text-[11px] capitalize text-neutral-600">
                {status.replace(/_/g, ' ')}
              </span>
            ) : null}
          </div>
          {topic ? (
            <h2 className="text-base font-semibold leading-snug text-neutral-900">{title}</h2>
          ) : (
            <p className="text-sm text-neutral-400">
              This draft is not linked to a topic.
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
          {canEdit && !editing ? (
            <button
              type="button"
              onClick={startEditing}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit topic
            </button>
          ) : null}
          {/* No collapse while editing — hiding a form would strand what was typed. */}
          {topic && !alwaysOpen && !editing ? (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={showBody}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100"
            >
              {showBody ? 'Hide topic' : 'Show topic'}
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${showBody ? 'rotate-180' : ''}`}
              />
            </button>
          ) : null}
        </div>
      </div>

      {topic && showBody && editing ? (
        <div className="mt-3 space-y-3">
          {fields.map((f) => (
            <div key={f.attr} className="space-y-1.5">
              <Label htmlFor={`topic-${f.attr}`}>{f.label}</Label>
              {f.multiline ? (
                <Textarea
                  id={`topic-${f.attr}`}
                  rows={4}
                  value={values[f.attr] ?? ''}
                  onChange={(e) => setValues((prev) => ({ ...prev, [f.attr]: e.target.value }))}
                />
              ) : (
                <Input
                  id={`topic-${f.attr}`}
                  value={values[f.attr] ?? ''}
                  onChange={(e) => setValues((prev) => ({ ...prev, [f.attr]: e.target.value }))}
                />
              )}
            </div>
          ))}
          <div className="flex items-center gap-2 pt-0.5">
            <Button onClick={save} disabled={saving || changes.length === 0}>
              {saving ? 'Saving…' : 'Save topic'}
            </Button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={saving}
              className="rounded border border-border px-3 py-1.5 text-sm hover:bg-neutral-100 disabled:opacity-50"
            >
              Cancel
            </button>
            {/* The kinds, the market and the decision are edited where they are
                decided — see lib/topic-edit.ts. Say so rather than leaving a
                reviewer hunting this form for them. */}
            <p className="text-xs text-neutral-500">
              Kind, market and status are changed from the topics table.
            </p>
          </div>
        </div>
      ) : null}

      {topic && showBody && !editing ? (
        <div className="mt-2 space-y-2">
          {subtitle ? <p className="text-sm text-neutral-600">{subtitle}</p> : null}
          {summary && summary !== subtitle ? (
            <p className="whitespace-pre-line text-sm leading-relaxed text-neutral-700">{summary}</p>
          ) : null}
          {chips.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {chips.map((c) => (
                <span
                  key={c.attr}
                  className="rounded-full bg-neutral-200/70 px-2 py-0.5 text-xs text-neutral-600"
                >
                  {c.attr === 'content_type' ? contentCategoryLabel(c.value) : c.value}
                </span>
              ))}
            </div>
          ) : null}
          {notes ? (
            <div className="rounded-md border-l-2 border-amber-300 bg-amber-50/70 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                What the reviewer asked for
              </p>
              <p className="mt-0.5 whitespace-pre-line text-sm text-amber-900">{notes}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/**
 * The back link the draft and story pages both render into the header. Separate
 * so the two pages cannot style it differently — and so `returnTarget` (which
 * decides the label WITH the href) stays the only place the wording is chosen.
 */
export function TopicBackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900"
    >
      &larr; {label}
    </Link>
  );
}
