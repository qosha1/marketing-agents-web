import { describe, it, expect } from 'vitest';
import { parseDiffFiles } from '@startsimpli/ui';

import { diffLines, unifiedBlogDiff } from '../blog-diff';

describe('diffLines', () => {
  it('marks equal / deleted / inserted lines in output order', () => {
    const ops = diffLines(['a', 'b', 'c'], ['a', 'x', 'c']);
    expect(ops).toEqual([
      { type: 'eq', line: 'a' },
      { type: 'del', line: 'b' },
      { type: 'ins', line: 'x' },
      { type: 'eq', line: 'c' },
    ]);
  });
});

describe('unifiedBlogDiff', () => {
  it('returns "" for identical bodies', () => {
    expect(unifiedBlogDiff('same\ntext', 'same\ntext')).toBe('');
  });

  it('emits a git-style block the shared DiffViewer parser can read', () => {
    const diff = unifiedBlogDiff('Line one\nLine two\nLine three', 'Line one\nLine 2\nLine three');
    // Header + hunk marker + the change lines.
    expect(diff).toContain('diff --git a/blog.md b/blog.md');
    expect(diff).toMatch(/^@@ -\d+,\d+ \+\d+,\d+ @@$/m);
    expect(diff).toContain('-Line two');
    expect(diff).toContain('+Line 2');
    // The shared parser splits it into exactly one file block.
    const files = parseDiffFiles(diff);
    expect(files).toHaveLength(1);
    expect(files[0].filePath).toBe('blog.md');
  });

  it('keeps context lines but not the whole document', () => {
    const oldText = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
    const newText = oldText.replace('line 10', 'LINE TEN');
    const diff = unifiedBlogDiff(oldText, newText);
    // Change plus 3 lines of context each side — far fewer than 20 body lines.
    const bodyLines = diff.split('\n').filter((l) => /^[ +-]/.test(l) && !l.startsWith('+++') && !l.startsWith('---'));
    expect(bodyLines).toContain('-line 10');
    expect(bodyLines).toContain('+LINE TEN');
    expect(bodyLines).toContain(' line 7'); // context retained
    expect(bodyLines).not.toContain(' line 0'); // distant unchanged line dropped
  });

  it('honours a custom path in the header', () => {
    const diff = unifiedBlogDiff('a', 'b', 'linkedin.txt');
    expect(diff).toContain('diff --git a/linkedin.txt b/linkedin.txt');
  });
});
