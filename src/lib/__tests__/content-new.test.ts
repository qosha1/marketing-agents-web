/**
 * RED for adding content by hand (bd startsim-b15nt): Title, Type, optional
 * Based on topic, What should it say.
 */
import { describe, expect, it } from 'vitest';

import { CONTENT_TYPES, newContentInput, sharedScopePath, validateNewContent } from '@/lib/content-new';

describe('add content by hand', () => {
  it('offers more than one type', () => {
    expect(CONTENT_TYPES.map((t) => t.label)).toEqual(expect.arrayContaining(['Blog post', 'LinkedIn post']));
  });

  it('needs a title', () => {
    expect(validateNewContent({ title: '  ', type: 'linkedin', topicId: '', brief: '' })).toEqual({ title: 'Give it a title.' });
    expect(validateNewContent({ title: 'Hello', type: 'linkedin', topicId: '', brief: '' })).toEqual({});
  });

  it('creates a Draft with the text in the field its type edits', () => {
    const input = newContentInput({ title: ' Qatar note ', type: 'linkedin', topicId: '', brief: 'Say it short.' }, { scopePath: null });
    expect(input.entityType).toBe('draft');
    expect(input.name).toBe('Qatar note');
    expect(input.data).toMatchObject({ status: 'ready_for_review', linkedin: 'Say it short.', channel: 'linkedin' });
  });

  it('puts a blog post in the blog field', () => {
    const input = newContentInput({ title: 'T', type: 'blog', topicId: '', brief: 'Body' }, { scopePath: null });
    expect(input.data).toMatchObject({ blog: 'Body', channel: 'blog' });
  });

  it('Based on a topic is optional; when given it links the topic and inherits its scope', () => {
    const none = newContentInput({ title: 'T', type: 'blog', topicId: '', brief: '' }, { scopePath: null });
    expect(none.data).not.toHaveProperty('topic_ref');
    const input = newContentInput({ title: 'T', type: 'blog', topicId: 't9', brief: '' }, { scopePath: '/ogmc' });
    expect(input.data).toMatchObject({ topic_ref: 't9', scope_path: '/ogmc' });
  });

  it('never invents a scope path', () => {
    const input = newContentInput({ title: 'T', type: 'blog', topicId: '', brief: '' }, { scopePath: null });
    expect(input.data).not.toHaveProperty('scope_path');
  });
});

describe('the scope a new item takes when it has no topic or project', () => {
  it('is the one path every visible record shares', () => {
    expect(sharedScopePath(['/ogmc', '/ogmc', undefined])).toBe('/ogmc');
  });
  it('is none when the paths differ or there are none', () => {
    expect(sharedScopePath(['/ogmc', '/other'])).toBeNull();
    expect(sharedScopePath([])).toBeNull();
  });
});
