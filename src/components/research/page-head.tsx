import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * The page head of every Research page (the wireframe's S-Page-Head): an optional
 * back link, the title with a quiet `meta` beside it, chips and a sub line, a
 * `note` under them, and on the right a `count` and at most one action.
 */
export function ResearchHead({
  title,
  meta,
  sub,
  note,
  count,
  action,
  back,
  chips,
}: {
  title: string;
  meta?: ReactNode;
  sub?: ReactNode;
  note?: ReactNode;
  count?: ReactNode;
  action?: ReactNode;
  back?: { href: string; label: string };
  chips?: string[];
}) {
  const hasSub = Boolean(sub) || Boolean(chips?.length);
  return (
    <div className="space-y-4">
      {back ? (
        <Link href={back.href} className="inline-flex items-center gap-1 text-[13px] text-neutral-500 hover:text-neutral-800">
          <ChevronLeft className="h-3.5 w-3.5" />
          {back.label}
        </Link>
      ) : null}
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-baseline gap-3">
            <h1 className="text-xl font-semibold text-neutral-900">{title}</h1>
            {meta ? <span className="text-sm text-neutral-500">{meta}</span> : null}
          </div>
          {hasSub ? (
            <div className="flex flex-wrap items-center gap-2">
              {chips?.map((c) => (
                <span key={c} className="inline-flex h-[22px] items-center rounded-full border border-border bg-white px-2 text-xs text-neutral-700">
                  {c}
                </span>
              ))}
              {sub ? <span className="text-[13px] text-neutral-500">{sub}</span> : null}
            </div>
          ) : null}
          {note ? <div className="text-[13px] text-neutral-500">{note}</div> : null}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {count ? <span className="text-sm text-neutral-500">{count}</span> : null}
          {action}
        </div>
      </div>
    </div>
  );
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
