import { describe, it, expect } from 'vitest';
import { isTypingTarget, shouldIgnoreShortcut } from '../keyboard';

describe('isTypingTarget', () => {
  it('is true for the form controls on the review page', () => {
    // The rewrite-feedback box, the add-a-source input, the note-section select.
    expect(isTypingTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTypingTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isTypingTarget({ tagName: 'SELECT' })).toBe(true);
  });

  it('is true for a contenteditable host', () => {
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });

  it('is false for the page chrome a reviewer reads from', () => {
    expect(isTypingTarget({ tagName: 'BODY' })).toBe(false);
    expect(isTypingTarget({ tagName: 'BUTTON', isContentEditable: false })).toBe(false);
    expect(isTypingTarget({ tagName: 'DIV' })).toBe(false);
  });

  it('is false for a missing/odd target rather than throwing', () => {
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(undefined)).toBe(false);
    expect(isTypingTarget('body')).toBe(false);
    expect(isTypingTarget({})).toBe(false);
  });

  it('matches the tag case-insensitively', () => {
    expect(isTypingTarget({ tagName: 'textarea' })).toBe(true);
  });
});

describe('shouldIgnoreShortcut', () => {
  const body = { tagName: 'BODY' };

  it('lets a bare letter through when the reviewer is not typing', () => {
    expect(shouldIgnoreShortcut({ key: 'j', target: body })).toBe(false);
    expect(shouldIgnoreShortcut({ key: 'a', target: body })).toBe(false);
  });

  it('never fires while typing — an "a" in the feedback box must not approve', () => {
    expect(shouldIgnoreShortcut({ key: 'a', target: { tagName: 'TEXTAREA' } })).toBe(true);
    expect(shouldIgnoreShortcut({ key: 'x', target: { tagName: 'INPUT' } })).toBe(true);
  });

  it('defers to the browser/OS on cmd/ctrl/alt', () => {
    expect(shouldIgnoreShortcut({ key: 'r', metaKey: true, target: body })).toBe(true);
    expect(shouldIgnoreShortcut({ key: 'r', ctrlKey: true, target: body })).toBe(true);
    expect(shouldIgnoreShortcut({ key: 'j', altKey: true, target: body })).toBe(true);
  });

  it('allows shift so the legend’s ? (shift+/) still works', () => {
    expect(shouldIgnoreShortcut({ key: '?', target: body })).toBe(false);
  });
});
