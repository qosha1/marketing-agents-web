import type { ReactNode } from 'react';

/** One title, one line under it, at most one action. Every Research page opens with this. */
export function ResearchHead({ title, sub, action }: { title: string; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-neutral-900">{title}</h1>
        {sub ? <p className="text-sm text-neutral-500">{sub}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
