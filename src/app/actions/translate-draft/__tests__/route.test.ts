/**
 * The translate route refuses a view-only reader BEFORE it answers 202
 * (bd startsim-whwxd.22, epic startsim-768w.71).
 *
 * A translation is a new draft written into the source draft's space with the
 * caller's own token. The tenant refuses that write for someone who cannot edit
 * the space (`space_not_editable`), but only at the END of a detached job: the
 * route had already answered 202, so the button reported "Translating…", and the
 * model call had already been paid for. So the refusal belongs here, read from
 * the draft's own `permissions` with the caller's bearer, like generate-drafts.
 *
 * Every refusal case asserts the provider was never asked and nothing was
 * POSTed, not merely that the status is 4xx.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const translate = vi.fn();

vi.mock('@/lib/tenant-fetch', () => ({ tenantFetch: vi.fn() }));
vi.mock('@startsimpli/llm', () => ({
  createAnthropicProvider: () => ({ isAvailable: () => true }),
  createOpenAIProvider: () => ({ isAvailable: () => true }),
}));
vi.mock('@startsimpli/llm/translation', () => ({
  resolveTranslationRoute: () => ({ provider: 'anthropic' }),
  createTranslationService: () => ({ translate }),
}));

import { tenantFetch } from '@/lib/tenant-fetch';
import { POST } from '../route';

const AUTH = 'Bearer test.token.value';
const DRAFT_ID = 'd-0ce14961';

/** A draft as DJANGO sends it: snake_case permissions, untouched by any transform. */
function draftWire(permissions?: Record<string, unknown>) {
  return {
    id: DRAFT_ID,
    entity_type: 'draft',
    name: 'A brief',
    data: { blog: 'Hello', lang: 'en', scope_path: '/qa-view-only' },
    ...(permissions ? { permissions } : {}),
  };
}

const VIEW_ONLY = { level: 'view', can_edit: false, can_comment: true, can_suggest: true };
const CAN_EDIT = { level: 'edit', can_edit: true, can_comment: true, can_suggest: true };

function stubTenant(draft: unknown) {
  vi.mocked(tenantFetch).mockImplementation(async (path: string, _auth: string, init?: { method?: string }) => {
    if (init?.method === 'POST') return { id: 'new-draft' } as never;
    if (path === `entities/${DRAFT_ID}`) return draft as never;
    if (path.startsWith('entities?') || path.startsWith('relationships')) return { count: 0 } as never;
    return { count: 0 } as never;
  });
}

function call(auth: string | null = AUTH) {
  return POST(
    new Request('http://localhost/actions/translate-draft', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
      body: JSON.stringify({ draftId: DRAFT_ID, targetLocale: 'ar' }),
    }),
  );
}

const posts = () =>
  vi.mocked(tenantFetch).mock.calls.filter(([, , init]) => (init as { method?: string })?.method === 'POST');

beforeEach(() => {
  vi.mocked(tenantFetch).mockReset();
  translate.mockReset();
  translate.mockResolvedValue({ translated: [{ id: 'blog', targetText: 'مرحبا' }], failed: [], providerCalls: 1 });
});

describe('a view-only reader', () => {
  it('is refused with 403 view_only, and nothing is translated or written', async () => {
    stubTenant(draftWire(VIEW_ONLY));
    const res = await call();
    expect(res.status).toBe(403);
    expect((await res.json()).reason).toBe('view_only');
    await new Promise((r) => setTimeout(r, 0));
    expect(translate).not.toHaveBeenCalled();
    expect(posts()).toEqual([]);
  });

  it('reads the draft with the caller’s own bearer', async () => {
    stubTenant(draftWire(VIEW_ONLY));
    await call();
    expect(vi.mocked(tenantFetch).mock.calls[0]?.[0]).toBe(`entities/${DRAFT_ID}`);
    expect(vi.mocked(tenantFetch).mock.calls[0]?.[1]).toBe(AUTH);
  });
});

describe('someone who can edit the draft', () => {
  it('gets 202 and the translation runs', async () => {
    stubTenant(draftWire(CAN_EDIT));
    const res = await call();
    expect(res.status).toBe(202);
    await vi.waitFor(() => expect(posts().length).toBeGreaterThan(0));
    expect(translate).toHaveBeenCalledTimes(1);
  });
});

describe('a tenant that sends no permissions yet', () => {
  it('keeps the old behaviour: 202', async () => {
    stubTenant(draftWire());
    const res = await call();
    expect(res.status).toBe(202);
  });
});

describe('a draft the caller cannot read', () => {
  it('is refused now (502, could not verify), not a 202 that fails later', async () => {
    vi.mocked(tenantFetch).mockRejectedValue(new Error(`tenant GET entities/${DRAFT_ID} responded 404`));
    const res = await call();
    expect(res.status).toBe(502);
    expect(translate).not.toHaveBeenCalled();
  });
});
