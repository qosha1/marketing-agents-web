'use client';

/**
 * The topic, at the top of its draft (bd startsim-z384k).
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
 * FORK-LOCAL, like the rest of src/components/draft-review/*. Rule 9 asks
 * whether another foundry fork would want it; the honest answer is "probably,
 * once one exists", which is the same answer startsim-m7fdm.1 gave about the
 * edit log and resolved by extracting it when a second tenant actually wanted
 * it. The reusable half — the field map — is ALREADY shared; what is left here
 * is this tenant's arrangement of it.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { resolveReviewConfig } from '@startsimpli/ui/collection';
import type { EntityRecord, EntityTypeDef } from '@startsimpli/ui/collection';

import { readData } from '@/lib/board';
import { contentCategoryLabel } from '@/lib/content';
import { TOPIC_REVIEW_CONFIG } from '@/lib/review-vocabulary';

/** The attribute holding the one-line sub-heading, when the type declares one. */
const SUBTITLE_ATTR = 'subtitle';

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

  const data = topic?.data;
  const title = str(data, cfg.titleAttr) || topic?.name || '';
  const subtitle = str(data, SUBTITLE_ATTR);
  const summary = str(data, cfg.summaryAttr);
  const status = str(data, cfg.statusName);
  const notes = str(data, cfg.noteAttr);
  const chips = cfg.metaAttrs
    .map((a) => ({ attr: a, value: str(data, a) }))
    .filter((c) => c.value !== '');

  const showBody = alwaysOpen || open;

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
          {topic && !alwaysOpen ? (
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

      {topic && showBody ? (
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
