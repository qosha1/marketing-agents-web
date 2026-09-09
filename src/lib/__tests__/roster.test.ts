import { describe, it, expect } from 'vitest';
import {
  normalizeMembers,
  memberSub,
  memberEmail,
  memberDisplayName,
  initialsOf,
  isOperatorEmail,
  operatorSubs,
} from '../roster';
import type { MemberRow } from '../foundry-api';

function member(sub: string, email: string): MemberRow {
  return { id: 1, org: 'acme', user: { sub, email }, role: 'admin', createdAt: '2026-07-01' };
}

describe('normalizeMembers', () => {
  it('passes through a bare array', () => {
    const rows = [member('u1', 'a@x.com')];
    expect(normalizeMembers(rows)).toBe(rows);
  });
  it('unwraps a DRF page envelope', () => {
    const rows = [member('u1', 'a@x.com')];
    expect(normalizeMembers({ count: 1, next: null, previous: null, results: rows })).toBe(rows);
  });
});

describe('memberSub / memberEmail / memberDisplayName', () => {
  it('reads the nested user.sub / user.email', () => {
    const m = member('central-sub-1', 'nordby@ogmc.ai');
    expect(memberSub(m)).toBe('central-sub-1');
    expect(memberEmail(m)).toBe('nordby@ogmc.ai');
    expect(memberDisplayName(m)).toBe('nordby@ogmc.ai');
  });
  it('is "" when the member has no user object', () => {
    const m: MemberRow = { id: 1 };
    expect(memberSub(m)).toBe('');
    expect(memberEmail(m)).toBe('');
  });
});

describe('initialsOf', () => {
  it('takes the local-part word(s) of an email', () => {
    expect(initialsOf('nordby@ogmc.ai')).toBe('NO');
    expect(initialsOf('jane.doe@ogmc.ai')).toBe('JD');
    expect(initialsOf('jane_doe@ogmc.ai')).toBe('JD');
  });
  it('takes first+last initial of a plain name', () => {
    expect(initialsOf('Ada Lovelace')).toBe('AL');
  });
  it('is "" for an empty input', () => {
    expect(initialsOf('')).toBe('');
    expect(initialsOf('   ')).toBe('');
  });
});

/**
 * Telling the team that USES this tenant apart from the team that BUILT it
 * (bd startsim-onrb7).
 *
 * MEASURED on the live marketing-agents roster, 2026-09-09 — 11 members, and the
 * split is by email domain, not by role and not by membership. Both accounts
 * that own drafts in the customer's queue (`qa-marketing-agents@startsimpli.com`
 * as `admin`, `qa+ma@startsimpli.com` as `member`) are perfectly ordinary
 * members of the org, so "is a member" cannot be the test; four `@ogmc.ai`
 * people are the customer and everything on a platform domain is us.
 */
describe('isOperatorEmail', () => {
  it('is true for the accounts the platform team signs in with', () => {
    expect(isOperatorEmail('qa-marketing-agents@startsimpli.com')).toBe(true);
    expect(isOperatorEmail('qa+ma@startsimpli.com')).toBe(true);
    expect(isOperatorEmail('qosha@debugg.ai')).toBe(true);
    expect(isOperatorEmail('idf+marketing-agents@foundry.local')).toBe(true);
  });

  it('is false for the customer, whatever their role', () => {
    // schilder@ogmc.ai is the one person who has pressed "Generate drafts" on
    // this tenant. Her drafts are the product, not test data.
    expect(isOperatorEmail('schilder@ogmc.ai')).toBe(false);
    expect(isOperatorEmail('nordby@ogmc.ai')).toBe(false);
  });

  it('matches a subdomain but never a lookalike suffix', () => {
    expect(isOperatorEmail('bot@qa.startsimpli.com')).toBe(true);
    // `notstartsimpli.com` ends with the domain as a STRING and is somebody else.
    expect(isOperatorEmail('someone@notstartsimpli.com')).toBe(false);
  });

  it('treats anything that is not an email as not ours', () => {
    expect(isOperatorEmail(undefined)).toBe(false);
    expect(isOperatorEmail('')).toBe(false);
    expect(isOperatorEmail('svc:n8n-ogmc')).toBe(false);
    expect(isOperatorEmail(42)).toBe(false);
  });
});

describe('operatorSubs', () => {
  it('picks out the platform accounts and drops the customer', () => {
    const rows: MemberRow[] = [
      member('sub-qa', 'qa-marketing-agents@startsimpli.com'),
      member('sub-cust', 'schilder@ogmc.ai'),
      member('sub-owner', 'qosha@debugg.ai'),
    ];
    expect(operatorSubs(rows).sort()).toEqual(['sub-owner', 'sub-qa']);
  });

  it('is empty for an empty roster, so nothing is hidden when we cannot tell', () => {
    expect(operatorSubs([])).toEqual([]);
  });
});
