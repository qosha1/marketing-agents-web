import { describe, it, expect } from 'vitest';
import { normalizeMembers, memberSub, memberEmail, memberDisplayName, initialsOf } from '../roster';
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
