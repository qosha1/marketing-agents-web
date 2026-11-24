'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';

/**
 * The wireframe's list toolbar (S-Toolbar): search first, then the filter menus,
 * and on the right the "Showing" range chips. Menus are native selects dressed as
 * the wireframe's menu buttons, so keyboard and screen readers work unchanged.
 */
export interface ToolbarMenu {
  /** Accessible name, e.g. "Source". Option labels carry the full text, e.g. "Source: all". */
  id: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}

export interface ToolbarChips {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}

export function ResearchToolbar({
  search,
  onSearch,
  placeholder,
  menus = [],
  chips,
}: {
  search: string;
  onSearch: (value: string) => void;
  placeholder: string;
  menus?: ToolbarMenu[];
  chips?: ToolbarChips;
}) {
  // The box keeps what was typed; the list only hears about it once typing pauses.
  const [text, setText] = useState(search);
  const sent = useRef(search);
  // A change from outside (Clear filters) replaces what the box shows.
  useEffect(() => {
    if (search !== sent.current) {
      sent.current = search;
      setText(search);
    }
  }, [search]);
  useEffect(() => {
    if (text === sent.current) return;
    const t = setTimeout(() => {
      sent.current = text;
      onSearch(text);
    }, 300);
    return () => clearTimeout(t);
  }, [text, onSearch]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-9 w-[380px] max-w-full items-center gap-2 rounded-md border border-border bg-white px-3 text-sm">
          <Search className="h-3.5 w-3.5 shrink-0 text-neutral-500" />
          <input
            type="search"
            aria-label={placeholder.replace(/…$/, '')}
            placeholder={placeholder}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-neutral-400"
          />
        </label>
        {menus.map((m) => (
          <label
            key={m.id}
            className="relative inline-flex h-8 items-center rounded-md border border-border bg-white text-[13px] font-medium text-neutral-900"
          >
            <select
              aria-label={m.id}
              value={m.value}
              onChange={(e) => m.onChange(e.target.value)}
              className="h-full cursor-pointer appearance-none rounded-md bg-transparent pl-3 pr-8 outline-none"
            >
              {m.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-neutral-500" />
          </label>
        ))}
      </div>
      {chips ? (
        <div className="flex items-center gap-1.5" role="group" aria-label={chips.label}>
          <span className="text-xs text-neutral-500">{chips.label}</span>
          {chips.options.map((o) => {
            const on = o.value === chips.value;
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={on}
                onClick={() => chips.onChange(o.value)}
                className={`inline-flex h-[22px] items-center rounded-full px-2.5 text-xs ${
                  on ? 'border border-indigo-200 bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
