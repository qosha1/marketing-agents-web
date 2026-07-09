'use client';

/**
 * TEMPORARY VENDORED COPY of @startsimpli/ui's RecordDetail (startsim-768w.17.4).
 * The canonical component lives in @startsimpli/ui (shipped in 0.4.44), but 0.4.44 is
 * currently uninstallable for standalone forks — it hard-depends on @startsimpli/realtime,
 * which is marked private and unpublished (added by a parallel session, PR #44). This
 * local copy unblocks the readable detail on the installable 0.4.43; switch the import to
 * `@startsimpli/ui` and delete this file once 0.4.44 (or a fixed version) installs. See bead.
 */
import * as React from 'react';

export type RecordFieldKind = 'text' | 'longtext' | 'url' | 'boolean' | 'json';

export interface RecordField {
  label: string;
  value: string;
  kind?: RecordFieldKind;
}

export interface RecordDetailProps {
  fields: RecordField[];
  emptyMessage?: string;
  className?: string;
}

const cn = (...c: Array<string | false | undefined>) => c.filter(Boolean).join(' ');
const URL_RE = /^https?:\/\//i;

export function RecordDetail({ fields, emptyMessage = 'No details.', className }: RecordDetailProps) {
  const present = fields.filter((f) => f.value != null && String(f.value).trim() !== '');
  const shorts = present.filter((f) => f.kind !== 'longtext' && f.kind !== 'json');
  const longs = present.filter((f) => f.kind === 'longtext');
  const jsons = present.filter((f) => f.kind === 'json');

  if (present.length === 0) {
    return <p className={cn('text-sm text-neutral-500', className)}>{emptyMessage}</p>;
  }

  return (
    <div className={cn('space-y-4', className)}>
      {shorts.length > 0 && (
        <dl className="space-y-1.5">
          {shorts.map((f, i) => {
            const isUrl = f.kind === 'url' || URL_RE.test(f.value);
            return (
              <div key={i} className="flex gap-2 text-sm">
                <dt className="w-28 shrink-0 capitalize text-neutral-400">{f.label}</dt>
                <dd className="min-w-0 flex-1 break-words">
                  {isUrl ? (
                    <a
                      href={f.value}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all text-blue-600 underline underline-offset-2 hover:no-underline"
                    >
                      {f.value}
                    </a>
                  ) : (
                    f.value
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      )}

      {longs.map((f, i) => (
        <section key={i} className="space-y-1.5">
          <h4 className="text-xs font-medium uppercase tracking-wide text-neutral-400">{f.label}</h4>
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-800">{f.value}</div>
        </section>
      ))}

      {jsons.map((f, i) => (
        <section key={i} className="space-y-1.5">
          <h4 className="text-xs font-medium uppercase tracking-wide text-neutral-400">{f.label}</h4>
          <pre className="overflow-x-auto rounded-md bg-neutral-100 p-3 text-xs leading-relaxed">{f.value}</pre>
        </section>
      ))}
    </div>
  );
}
