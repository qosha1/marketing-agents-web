'use client';

/**
 * DraftReviewLayout — the one-surface shell for the draft page (bd
 * startsim-m7fdm.27).
 *
 * Header (top) → the document (the only column) → an optional bar pinned to the
 * bottom. History is not a column: it slides over the document from the right
 * (full width on a phone) while `railOpen`, and closes on Escape or a click
 * outside.
 *
 * Presentational shell — slots only. All state + persistence live in the draft
 * page. Fork-local for now; extracted to a shared composer once confirmed.
 */
import * as React from 'react';
import { X } from 'lucide-react';

export interface DraftReviewLayoutProps {
  header: React.ReactNode;
  content: React.ReactNode;
  /** The history. Not a column: it slides over the document while `railOpen`. */
  rail: React.ReactNode;
  railOpen?: boolean;
  onRailClose?: () => void;
  /** The pinned bottom bar. Null or absent renders no bar at all. */
  decisionBar?: React.ReactNode;
  /** The rail's container, so the page can scroll it into view on narrow screens. */
  railRef?: React.Ref<HTMLDivElement>;
}

export function DraftReviewLayout({
  header,
  content,
  rail,
  railOpen = false,
  onRailClose,
  decisionBar,
  railRef,
}: DraftReviewLayoutProps) {
  React.useEffect(() => {
    if (!railOpen || !onRailClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onRailClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [railOpen, onRailClose]);

  return (
    <div className="flex flex-col gap-4 pb-4">
      <div className="mx-auto w-full max-w-4xl">{header}</div>

      {/* ONE column: the document. History is opened from the header. */}
      <div className="mx-auto w-full min-w-0 max-w-4xl">{content}</div>

      {railOpen ? (
        <>
          <button
            type="button"
            aria-label="Dismiss history"
            tabIndex={-1}
            onClick={onRailClose}
            className="fixed inset-0 z-30 cursor-default bg-black/20 lg:bg-transparent"
          />
          <aside
            ref={railRef as React.Ref<HTMLElement>}
            role="dialog"
            aria-label="History"
            className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-border bg-card shadow-xl sm:w-[26rem]"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="text-sm font-semibold text-neutral-800">History</span>
              <button
                type="button"
                aria-label="Close history"
                onClick={onRailClose}
                className="rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">{rail}</div>
          </aside>
        </>
      ) : null}

      {decisionBar ? (
        <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-neutral-200 bg-gray-50/95 px-4 py-3 sm:-mx-8 sm:px-8 backdrop-blur">
          {decisionBar}
        </div>
      ) : null}
    </div>
  );
}
