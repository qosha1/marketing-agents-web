import { describe, it, expect } from 'vitest';
import {
  matchTopicDrafts,
  topicIdForDraft,
  draftTitle,
  draftStatus,
  draftCandidateIndex,
  draftJudgeVerdict,
  buildStoryFromTopic,
  draftLang,
  matchDraftTranslations,
  originalOfTranslation,
  draftLanguageGroup,
  WRITTEN_FOR,
  TRANSLATION_OF,
} from '../topic-drafts';
import type { EntityRecord, RelationshipRecord } from '@/lib/foundry-api';

function draft(id: number, data: Record<string, unknown> = {}, name = 'd' + id): EntityRecord {
  return { id, entityType: 'draft', externalId: null, name, data, createdAt: '2026-07-01' };
}
function edge(id: number, relType: string, source: number, target: number): RelationshipRecord {
  return { id, relType, source, target };
}
function topic(id: number, data: Record<string, unknown> = {}, name = ''): EntityRecord {
  return { id, entityType: 'topic', externalId: null, name, data, createdAt: '2026-07-01' };
}

describe('matchTopicDrafts', () => {
  const drafts = [draft(10), draft(11), draft(12)];

  it('returns drafts whose written_for edge targets the topic', () => {
    const rels = [
      edge(1, WRITTEN_FOR, 10, 100),
      edge(2, WRITTEN_FOR, 11, 100),
      edge(3, WRITTEN_FOR, 12, 200), // written for a different topic
    ];
    expect(matchTopicDrafts(100, rels, drafts).map((d) => d.id)).toEqual([10, 11]);
  });

  it('ignores edges of a different rel type', () => {
    const rels = [edge(1, 'mentions', 10, 100), edge(2, WRITTEN_FOR, 11, 100)];
    expect(matchTopicDrafts(100, rels, drafts).map((d) => d.id)).toEqual([11]);
  });

  it('preserves the input order of drafts, not the edge order', () => {
    const rels = [edge(1, WRITTEN_FOR, 12, 100), edge(2, WRITTEN_FOR, 10, 100)];
    expect(matchTopicDrafts(100, rels, drafts).map((d) => d.id)).toEqual([10, 12]);
  });

  it('is empty when no edge targets the topic', () => {
    expect(matchTopicDrafts(999, [edge(1, WRITTEN_FOR, 10, 100)], drafts)).toEqual([]);
    expect(matchTopicDrafts(100, [], drafts)).toEqual([]);
  });

  it('skips edges whose source is not among the known draft records', () => {
    expect(matchTopicDrafts(100, [edge(1, WRITTEN_FOR, 55, 100)], drafts)).toEqual([]);
  });

  it('matches a draft by topic_ref even with no edge (camel + snake key)', () => {
    const refDrafts = [
      draft(20, { topicRef: '100' }),
      draft(21, { topic_ref: '100' }),
      draft(22, { topicRef: '200' }),
    ];
    expect(matchTopicDrafts(100, [], refDrafts).map((d) => d.id)).toEqual([20, 21]);
  });

  it('coerces a numeric topic_ref to compare against the topic id', () => {
    expect(matchTopicDrafts(100, [], [draft(30, { topicRef: 100 })]).map((d) => d.id)).toEqual([30]);
  });

  it('unions the edge and topic_ref paths without duplicating a draft', () => {
    const mixed = [draft(40, { topicRef: '100' }), draft(41)];
    const rels = [edge(1, WRITTEN_FOR, 40, 100), edge(2, WRITTEN_FOR, 41, 100)];
    expect(matchTopicDrafts(100, rels, mixed).map((d) => d.id)).toEqual([40, 41]);
  });

  // startsim-ka3j: topic_ref === topic.id is the PRIMARY live-verified signal;
  // written_for and topic_ref === topic.external_id are defensive fallbacks
  // only, the external_id one gated behind an explicit 4th arg.
  it('matches via topic_ref === topic.id with no edge and no external_id passed', () => {
    expect(matchTopicDrafts(100, [], [draft(50, { topicRef: '100' })]).map((d) => d.id)).toEqual([50]);
  });
  it('the external_id fallback only engages when topicExternalId is passed', () => {
    const extRefDraft = draft(60, { topicRef: 'ext-abc' });
    expect(matchTopicDrafts(100, [], [extRefDraft])).toEqual([]); // no 4th arg -> no match
    expect(matchTopicDrafts(100, [], [extRefDraft], 'ext-abc').map((d) => d.id)).toEqual([60]);
  });
  it('the external_id fallback never matches a mismatched external_id', () => {
    const extRefDraft = draft(61, { topicRef: 'ext-abc' });
    expect(matchTopicDrafts(100, [], [extRefDraft], 'ext-xyz')).toEqual([]);
  });
});

describe('topicIdForDraft (the reverse of matchTopicDrafts, startsim-4w76/n7s8)', () => {
  const t100 = topic(100, {}, 'Topic A');
  const t200 = topic(200, {}, 'Topic B');
  const extTopic = { ...topic(300, {}, 'Topic C'), externalId: 'ext-abc' };

  it('primary: matches by topic_ref === topic.id', () => {
    expect(topicIdForDraft(draft(1, { topicRef: '100' }), [], [t100, t200])).toBe(100);
  });
  it('fallback 1: matches by a written_for edge when there is no topic_ref hit', () => {
    const d = draft(2, {});
    const rels = [edge(1, WRITTEN_FOR, 2, 200)];
    expect(topicIdForDraft(d, rels, [t100, t200])).toBe(200);
  });
  it('fallback 2: matches by topic_ref === topic.external_id', () => {
    const d = draft(3, { topicRef: 'ext-abc' });
    expect(topicIdForDraft(d, [], [t100, extTopic])).toBe(300);
  });
  it('is null when the draft matches none of the given topics', () => {
    expect(topicIdForDraft(draft(4, { topicRef: 'nowhere' }), [], [t100, t200])).toBeNull();
  });
});

describe('draftCandidateIndex', () => {
  it('reads the candidate ordinal (camelCased blob key)', () => {
    expect(draftCandidateIndex(draft(1, { candidateIndex: 2 }))).toBe(2);
  });
  it('is 0 when unset or non-numeric', () => {
    expect(draftCandidateIndex(draft(1, {}))).toBe(0);
    expect(draftCandidateIndex(draft(1, { candidateIndex: 'x' }))).toBe(0);
  });
});

describe('draftJudgeVerdict', () => {
  it('reads verdict out of the judge_verdict object', () => {
    expect(draftJudgeVerdict(draft(1, { judgeVerdict: { verdict: 'accept' } }))).toBe('accept');
  });
  it('is empty when there is no verdict object', () => {
    expect(draftJudgeVerdict(draft(1, {}))).toBe('');
    expect(draftJudgeVerdict(draft(1, { judgeVerdict: 'nope' }))).toBe('');
  });
});

describe('buildStoryFromTopic', () => {
  it('maps a topic to the writer story payload', () => {
    const t = topic(
      42,
      {
        market: 'Oil & Gas',
        angle: 'Refinery margins are compressing',
        content_type: 'weekly_brief',
        source_1: 'https://a.example',
        source_2: 'https://b.example',
        source_3: 'https://c.example',
      },
      'Q3 refinery squeeze',
    );
    expect(buildStoryFromTopic(t)).toEqual({
      title: 'Q3 refinery squeeze',
      market: 'Oil & Gas',
      context: 'Refinery margins are compressing',
      sources: 'https://a.example\nhttps://b.example\nhttps://c.example',
      content_type: 'weekly_brief',
      topic_ref: '42',
      topic_title: 'Q3 refinery squeeze',
    });
  });

  it('drops empty sources and joins only the non-empty ones', () => {
    const t = topic(7, { source_1: 'https://a.example', source_2: '', source_3: 'https://c.example' }, 'x');
    expect(buildStoryFromTopic(t).sources).toBe('https://a.example\nhttps://c.example');
  });

  it('falls back to the title attribute when the record has no name', () => {
    const t = topic(9, { title: 'Fallback title' }, '');
    const story = buildStoryFromTopic(t);
    expect(story.title).toBe('Fallback title');
    expect(story.topic_title).toBe('Fallback title');
    expect(story.topic_ref).toBe('9');
  });

  it('reads camelCased data keys (content_type -> contentType)', () => {
    const t = topic(3, { contentType: 'lead_magnet' }, 'Guide');
    expect(buildStoryFromTopic(t).content_type).toBe('lead_magnet');
  });
});

describe('draftTitle', () => {
  it('prefers story_title (camelCased blob key)', () => {
    expect(draftTitle(draft(1, { storyTitle: 'Big News' }))).toBe('Big News');
  });
  it('reads the snake_case key too', () => {
    expect(draftTitle(draft(1, { story_title: 'Snake News' }))).toBe('Snake News');
  });
  it('falls back to the record name, then the id', () => {
    expect(draftTitle(draft(7, {}, 'Fallback Name'))).toBe('Fallback Name');
    expect(draftTitle(draft(7, {}, ''))).toBe('#7');
  });
});

describe('draftStatus', () => {
  it('reads the status blob value', () => {
    expect(draftStatus(draft(1, { status: 'ready' }))).toBe('ready');
  });
  it('is empty when unset', () => {
    expect(draftStatus(draft(1, {}))).toBe('');
  });
});

// startsim-ka3j: no live `translation_of` rows exist yet (no translations have
// been produced on the marketing-agents tenant), so these are exercised purely
// against fixtures — the language-switcher UI correctly renders "no
// translations yet" against real data today.
describe('draftLang', () => {
  it('reads the lang blob value', () => {
    expect(draftLang(draft(1, { lang: 'ar' }))).toBe('ar');
  });
  it('is empty when unset', () => {
    expect(draftLang(draft(1, {}))).toBe('');
  });
});

describe('matchDraftTranslations / originalOfTranslation / draftLanguageGroup', () => {
  const en = draft(1, { lang: 'en' }, 'English draft');
  const ar = draft(2, { lang: 'ar' }, 'Arabic draft');
  const unrelated = draft(3, { lang: 'en' }, 'Unrelated draft');
  // ar IS a translation_of en: source = the translation (ar), target = the original (en).
  const rels: RelationshipRecord[] = [edge(1, TRANSLATION_OF, 2, 1)];

  it('matchDraftTranslations: finds drafts whose translation_of edge targets this draft', () => {
    expect(matchDraftTranslations(1, rels, [en, ar, unrelated]).map((d) => d.id)).toEqual([2]);
    expect(matchDraftTranslations(2, rels, [en, ar, unrelated])).toEqual([]); // ar has no translations of its own
  });

  it('originalOfTranslation: follows a translation to what it is OF', () => {
    expect(originalOfTranslation(2, rels, [en, ar, unrelated])?.id).toBe(1);
    expect(originalOfTranslation(1, rels, [en, ar, unrelated])).toBeNull(); // en isn't a translation of anything
    expect(originalOfTranslation(3, rels, [en, ar, unrelated])).toBeNull();
  });

  it('draftLanguageGroup: opened from the original lists [original, ...translations]', () => {
    expect(draftLanguageGroup(en, rels, [en, ar, unrelated]).map((d) => d.id)).toEqual([1, 2]);
  });
  it('draftLanguageGroup: opened from a translation resolves back to the same group', () => {
    expect(draftLanguageGroup(ar, rels, [en, ar, unrelated]).map((d) => d.id)).toEqual([1, 2]);
  });
  it('draftLanguageGroup: a draft with no translations is a group of one (itself)', () => {
    expect(draftLanguageGroup(unrelated, rels, [en, ar, unrelated]).map((d) => d.id)).toEqual([3]);
  });
  it('draftLanguageGroup: empty relationships -> every draft is its own group', () => {
    expect(draftLanguageGroup(en, [], [en, ar, unrelated]).map((d) => d.id)).toEqual([1]);
  });
});
