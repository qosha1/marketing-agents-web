/**
 * Where "their recent edits" goes, and how this app renders a link the shared
 * history components hand it (bd startsim-1pqb9).
 *
 * The Activity page owns its filters in the URL (`/activity?actor=<sub>`), so a
 * person's recent edits are a plain link to it — from a field's "edited by"
 * line, or anywhere else that names an actor. The value is the actor's SUB,
 * never their label: the feed filters on `actor_sub`.
 */
import { createElement, type ReactNode } from 'react';
import Link from 'next/link';

export const ACTIVITY_PATH = '/activity';

export function actorEditsHref(actorSub: string): string {
  return `${ACTIVITY_PATH}?${new URLSearchParams({ actor: actorSub })}`;
}

/**
 * The query param that opens one record's drawer on its table, so a link can
 * land ON a record of a type that has no page of its own (scope, source,
 * client, news item) instead of on the whole table (bd startsim-m7fdm.36).
 */
export const OPEN_RECORD_PARAM = 'open';

export function tableRecordHref(typeKey: string, id: string | number): string {
  return `/t/${encodeURIComponent(typeKey)}?${new URLSearchParams({ [OPEN_RECORD_PARAM]: String(id) })}`;
}

/** Soft navigation for links rendered inside @startsimpli/ui components. */
export function renderNextLink({
  href,
  className,
  children,
}: {
  href: string;
  className: string;
  children: ReactNode;
}): ReactNode {
  return createElement(Link, { href, className }, children);
}
