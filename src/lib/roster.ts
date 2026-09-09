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

/**
 * The email domains of the people who BUILD and operate this tenant, as opposed
 * to the team that uses it (bd startsim-onrb7).
 *
 * A DOMAIN LIST RATHER THAN A ROLE OR A MEMBERSHIP CHECK, and that is forced by
 * the data. On the live marketing-agents roster (11 members, read 2026-09-09)
 * `qa-marketing-agents@startsimpli.com` is an `admin` and `qa+ma@startsimpli.com`
 * is a `member` — both perfectly ordinary members of the customer's own org,
 * because that is how a QA account gets to sign in at all. Neither role nor
 * membership separates them from `schilder@ogmc.ai`. The domain does.
 *
 * Kept generic on purpose (rule 9): it names OUR domains, not the customer's, so
 * a second tenant needs no second list and adding a customer never needs a code
 * change.
 */
export const OPERATOR_EMAIL_DOMAINS = ['startsimpli.com', 'debugg.ai', 'foundry.local'];

/**
 * True when an email belongs to the platform team rather than the customer.
 *
 * Matches the domain and its subdomains, never a lookalike suffix:
 * `bot@qa.startsimpli.com` is ours, `someone@notstartsimpli.com` is not — which
 * a bare `endsWith` would get wrong.
 */
export function isOperatorEmail(email: unknown): boolean {
  if (typeof email !== 'string') return false;
  const domain = email.trim().toLowerCase().split('@')[1] ?? '';
  if (!domain) return false;
  return OPERATOR_EMAIL_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

/**
 * The central user ids of every roster member on a platform domain — what a row's
 * `owner_sub` is stamped with when one of us creates a record.
 *
 * An empty roster gives an empty list, and every caller must treat that as "we
 * could not tell who is who" rather than "nobody is ours": a queue that hides
 * rows it cannot justify hiding is the worse of the two failures.
 */
export function operatorSubs(members: MemberRow[]): string[] {
  return members.filter((m) => isOperatorEmail(memberEmail(m))).map(memberSub).filter(Boolean);
}
