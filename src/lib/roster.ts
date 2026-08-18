/**
 * Generic org-roster helpers (startsim-71z6) — turns the `orgMembers()`
 * response into what an assignee picker/chip needs. Pure so it's unit-tested
 * without a backend; the picker component just fetches and calls these.
 *
 * Wire shape (verified against the live `/api/v1/subtree/members/` serializer,
 * central `MemberSerializer`): `{ id, org, user: { sub, email }, role,
 * created_at }`, camelCased on arrival like every other response. There is no
 * `name` field — email is the only human-readable identity central hands back,
 * so it doubles as the "display name" until central adds one.
 */
import type { MemberRow, Paginated } from './foundry-api';

/** `orgMembers()` returns a bare array OR a DRF page envelope depending on
 *  deployment; this is the one place that knows which. */
export function normalizeMembers(res: MemberRow[] | Paginated<MemberRow>): MemberRow[] {
  return Array.isArray(res) ? res : res.results;
}

/** The member's central user id — what `assignee_sub` is stamped with. */
export function memberSub(m: MemberRow): string {
  const user = m.user as { sub?: unknown } | undefined;
  return String(user?.sub ?? m.sub ?? '');
}

/** The member's email — central has no separate display name field. */
export function memberEmail(m: MemberRow): string {
  const user = m.user as { email?: unknown } | undefined;
  return String(user?.email ?? m.email ?? '');
}

/** What `assignee_name` is stamped with — the email, since that's the only
 *  identity string central provides. */
export function memberDisplayName(m: MemberRow): string {
  return memberEmail(m);
}

/**
 * Up to 2 initials from a display name/email — "nordby@ogmc.ai" -> "NO",
 * "Ada Lovelace" -> "AL". '' in, '' out (the chip renders nothing rather than
 * a stray "?").
 */
export function initialsOf(nameOrEmail: string): string {
  const local = nameOrEmail.trim().split('@')[0] ?? '';
  const words = local.split(/[.\s_-]+/).filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
