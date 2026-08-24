/**
 * A translated record must not be half English (bd startsim-wn2p.21).
 *
 * MEASURED on the live zh translation (draft f6a2d629, 2026-08-24), field by
 * field against its English source:
 *
 *   name                  中国—海湾科技扩张引发入局者对执行的疑问     translated
 *   blog                  855 CJK chars                             translated
 *   linkedin              364 CJK chars                             translated
 *   seo.meta_description  中国企业正在海湾科技走廊…                  translated
 *   story_title           "China-Gulf Tech Expansion Raises…"       ENGLISH
 *   angle                 "Risks and what to watch: execution…"     ENGLISH
 *
 * `story_title` is the one that shows: `draftTitle()` reads it FIRST and only
 * falls back to `name`, so the drawer's draft list and the topic header label
 * the Chinese piece with its English headline.
 */
import { describe, expect, it } from 'vitest';

import { applyDraftTranslations, draftSegments } from '@/lib/draft-translation';
import type { EntityRecord } from '@/lib/foundry-api';

// `as unknown as` because EntityRecord declares `id: number` while the tenant
// actually returns UUID strings — every consumer already does String(record.id).
// Filed separately; not widened here.
const SOURCE = {
  id: 'src-1',
  entityType: 'draft',
  externalId: 'china-gulf-tech',
  name: 'China-Gulf Tech Expansion Raises Execution Questions',
  data: {
    blog: 'Reporting from Arabian Business suggests the corridor is entering a new phase.',
    linkedin: 'As Gulf-Asia trade grows, the biggest risk may be assuming it is easy.',
    seo: { meta_description: 'Chinese firms are expanding across the Gulf tech corridor.' },
    story_title: 'China-Gulf Tech Expansion Raises Execution Questions',
    angle: 'Risks and what to watch: execution, compliance and overgeneralisation.',
    topic_title: 'How Chinese Firms Are Anchoring Into the Gulf Tech Corridor',
    topic_ref: 'topic-9',
    sources: ['https://arabianbusiness.com/x'],
  },
  createdAt: '2026-08-19',
} as unknown as EntityRecord;

describe('draftSegments — what the translator is shown', () => {
  const ids = draftSegments(SOURCE).map((s) => s.id);

  it('sends the reader-facing title and the editorial angle', () => {
    expect(ids).toContain('story_title');
    expect(ids).toContain('angle');
  });

  it('still sends the prose it always did', () => {
    expect(ids).toEqual(expect.arrayContaining(['name', 'blog', 'linkedin', 'seo.meta_description']));
  });

  it('does NOT send topic_title — that names the English topic record', () => {
    // Provenance, not content: it says WHICH topic this was written for, and the
    // topic it points at keeps its English name. Translating it would leave the
    // draft claiming a topic that does not exist under that title.
    expect(ids).not.toContain('topic_title');
  });

  it('never sends URLs, ids or machine state', () => {
    expect(ids).not.toContain('sources');
    expect(ids).not.toContain('topic_ref');
  });

  it('skips a field that is blank at source rather than sending empty text', () => {
    const bare = { ...SOURCE, data: { ...SOURCE.data, angle: '   ', story_title: '' } } as EntityRecord;
    const bareIds = draftSegments(bare).map((s) => s.id);
    expect(bareIds).not.toContain('angle');
    expect(bareIds).not.toContain('story_title');
  });
});

describe('applyDraftTranslations — what lands on the record', () => {
  const translations = new Map([
    ['name', '中国—海湾科技扩张引发入局者对执行的疑问'],
    ['blog', '来自《Arabian Business》的报道显示'],
    ['linkedin', '随着海湾-亚洲贸易增长'],
    ['seo.meta_description', '中国企业正在海湾科技走廊加速扩张'],
    ['story_title', '中国—海湾科技扩张引发入局者对执行的疑问'],
    ['angle', '风险与关注点：执行、合规与过度概括。'],
  ]);

  it('writes the translated title and angle onto the new record', () => {
    const out = applyDraftTranslations(SOURCE, translations, 'zh');
    expect(out.data.story_title).toBe('中国—海湾科技扩张引发入局者对执行的疑问');
    expect(out.data.angle).toBe('风险与关注点：执行、合规与过度概括。');
  });

  it('keeps topic_title in the source language, as provenance', () => {
    const out = applyDraftTranslations(SOURCE, translations, 'zh');
    expect(out.data.topic_title).toBe('How Chinese Firms Are Anchoring Into the Gulf Tech Corridor');
  });

  it('gives story_title the SAME text as name when the source had them equal', () => {
    // The source's name and story_title are the same string, and two independent
    // translations of one headline drift. Whatever the model returns for `name`
    // is what the title becomes, so the record cannot disagree with itself.
    const out = applyDraftTranslations(SOURCE, new Map([['name', '标题甲'], ['story_title', '标题乙']]), 'zh');
    expect(out.name).toBe('标题甲');
    expect(out.data.story_title).toBe('标题甲');
  });

  it('translates story_title on its own when the source really did differ', () => {
    const differing = {
      ...SOURCE,
      data: { ...SOURCE.data, story_title: 'A genuinely different display title' },
    } as EntityRecord;
    const out = applyDraftTranslations(differing, new Map([['name', '标题甲'], ['story_title', '标题乙']]), 'zh');
    expect(out.data.story_title).toBe('标题乙');
  });

  it('leaves a field the model skipped in its source language, never blank', () => {
    const out = applyDraftTranslations(SOURCE, new Map([['name', '标题']]), 'zh');
    expect(out.data.angle).toBe('Risks and what to watch: execution, compliance and overgeneralisation.');
  });
});
