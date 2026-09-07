/**
 * BlogSection's debounced autosave (bd startsim-mcoza / startsim-edb00).
 *
 * The draft editor holds a SUBSET of a draft's sections and merges each save
 * back into the whole, so a save that fires with the wrong text — or with a
 * stale writer — silently drops a section on the next write. That is not
 * something a type-check or a pure-function test can see: it lives in the
 * interaction between a controlled prop, a debounce timer, and the identity of
 * the handler the parent passes. These tests pin it, and they are what makes it
 * safe to move the `onSave` mirror out of the render body.
 */
import * as React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BlogSection } from '../BlogSection';

const noop = () => {};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Run the debounce forward and let the awaited save settle. */
async function tick(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

describe('BlogSection autosave', () => {
  it('does not save what it was given — only a change the writer made', async () => {
    const onSave = vi.fn();
    render(<BlogSection value="opening line" onChange={noop} onSave={onSave} />);

    await tick(5_000);

    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves the changed text once the writer stops typing', async () => {
    const onSave = vi.fn();
    const { rerender } = render(<BlogSection value="" onChange={noop} onSave={onSave} />);

    rerender(<BlogSection value="a first line" onChange={noop} onSave={onSave} />);
    await tick(1_199);
    expect(onSave).not.toHaveBeenCalled();

    await tick(1);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('a first line');
  });

  it('saves the text as it stands when the timer fires, not each keystroke on the way', async () => {
    const onSave = vi.fn();
    const { rerender } = render(<BlogSection value="" onChange={noop} onSave={onSave} />);

    rerender(<BlogSection value="a" onChange={noop} onSave={onSave} />);
    await tick(600);
    rerender(<BlogSection value="ab" onChange={noop} onSave={onSave} />);
    await tick(600);
    rerender(<BlogSection value="abc" onChange={noop} onSave={onSave} />);
    await tick(1_200);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('abc');
  });

  it('does not restart the debounce when the parent hands it a new writer', async () => {
    // This is what the `onSave` ref is for. The draft page passes an inline
    // arrow, so a new one arrives on every parent render — if the effect
    // depended on it, each of those renders would push the save further away and
    // a busy page would never autosave at all. The writer is captured when the
    // change lands; a later render swaps the prop but must not move the clock.
    const atChange = vi.fn();
    const later = vi.fn();
    const { rerender } = render(<BlogSection value="" onChange={noop} onSave={atChange} />);

    rerender(<BlogSection value="edited" onChange={noop} onSave={atChange} />);
    await tick(800);
    // Parent re-renders with a brand new handler, same text.
    rerender(<BlogSection value="edited" onChange={noop} onSave={later} />);
    await tick(400);

    // 1200ms after the change, not 1200ms after the re-render.
    expect(atChange).toHaveBeenCalledTimes(1);
    expect(atChange).toHaveBeenCalledWith('edited');
    expect(later).not.toHaveBeenCalled();
  });

  it('picks up the writer the parent swapped in, for the next change', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<BlogSection value="" onChange={noop} onSave={first} />);

    rerender(<BlogSection value="one" onChange={noop} onSave={first} />);
    await tick(1_200);
    expect(first).toHaveBeenCalledWith('one');

    rerender(<BlogSection value="two" onChange={noop} onSave={second} />);
    await tick(1_200);

    expect(second).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith('two');
    expect(first).toHaveBeenCalledTimes(1);
  });

  it('does not save the same text twice', async () => {
    const onSave = vi.fn();
    const { rerender } = render(<BlogSection value="" onChange={noop} onSave={onSave} />);

    rerender(<BlogSection value="settled" onChange={noop} onSave={onSave} />);
    await tick(1_200);
    expect(onSave).toHaveBeenCalledTimes(1);

    // A re-render with the text the save just persisted.
    rerender(<BlogSection value="settled" onChange={noop} onSave={onSave} />);
    await tick(5_000);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('reports the save it is doing, then the one it did', async () => {
    let release: (() => void) | undefined;
    const onSave = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const { rerender } = render(<BlogSection value="" onChange={noop} onSave={onSave} />);

    rerender(<BlogSection value="in flight" onChange={noop} onSave={onSave} />);
    await tick(1_200);
    expect(screen.getByRole('status')).toHaveTextContent('Saving…');

    await act(async () => {
      release?.();
    });
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });

  it('says so when the save fails, instead of claiming it saved', async () => {
    const onSave = vi.fn(() => Promise.reject(new Error('tenant rejected the write')));
    const { rerender } = render(<BlogSection value="" onChange={noop} onSave={onSave} />);

    rerender(<BlogSection value="doomed" onChange={noop} onSave={onSave} />);
    await tick(1_200);

    expect(screen.getByRole('status')).toHaveTextContent('Save failed');
  });
});

describe('BlogSection editing surface', () => {
  it('opens rendered, and only shows the textarea once the reviewer asks to edit', () => {
    render(<BlogSection value="# A headline" onChange={noop} />);

    // Locked decision #3 — the blog opens in the rendered (Read) view.
    expect(screen.queryByLabelText('Blog post markdown')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    expect(screen.getByLabelText('Blog post markdown')).toBeInTheDocument();
  });

  it('is controlled — a keystroke goes to the parent, not to local state', () => {
    const onChange = vi.fn();
    render(<BlogSection value="before" onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    fireEvent.change(screen.getByLabelText('Blog post markdown'), { target: { value: 'after' } });

    expect(onChange).toHaveBeenCalledWith('after');
    // Still showing what the parent gave it.
    expect(screen.getByLabelText('Blog post markdown')).toHaveValue('before');
  });
});
