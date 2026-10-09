/**
 * TrackedSection (was BlogSection): its debounced autosave (bd startsim-mcoza /
 * startsim-edb00) and, since bd startsim-q8sgy, the tracked surface it mounts.
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
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { EditorView } from '@codemirror/view';

import { TrackedSection as BlogSection } from '../TrackedSection';

function editorView(): EditorView {
  const el = document.querySelector('.cm-editor') as HTMLElement | null;
  if (!el) throw new Error('no editor mounted');
  return EditorView.findFromDOM(el)!;
}

const noop = () => {};

beforeAll(() => {
  // jsdom has no layout; CodeMirror measures text with these.
  const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON() {} };
  Range.prototype.getBoundingClientRect = () => rect as DOMRect;
  Range.prototype.getClientRects = () =>
    ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
});

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

  it('uses the writer that arrived WITH the change, not the one before it', async () => {
    // The case that pins the mechanism: `value` and `onSave` change in the same
    // render. The mirror is written by an effect declared before the autosave
    // effect, so it must already hold the new writer when the autosave effect
    // snapshots it in that same commit — which is what assigning during render
    // used to guarantee.
    const before = vi.fn();
    const withTheChange = vi.fn();
    const { rerender } = render(<BlogSection value="" onChange={noop} onSave={before} />);

    rerender(<BlogSection value="edited" onChange={noop} onSave={withTheChange} />);
    await tick(1_200);

    expect(before).not.toHaveBeenCalled();
    expect(withTheChange).toHaveBeenCalledTimes(1);
    expect(withTheChange).toHaveBeenCalledWith('edited');
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
    expect(screen.getByText('Saving…')).toBeInTheDocument();

    await act(async () => {
      release?.();
    });
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });

  it('says so when the save fails, instead of claiming it saved', async () => {
    const onSave = vi.fn(() => Promise.reject(new Error('tenant rejected the write')));
    const { rerender } = render(<BlogSection value="" onChange={noop} onSave={onSave} />);

    rerender(<BlogSection value="doomed" onChange={noop} onSave={onSave} />);
    await tick(1_200);

    expect(screen.getByText('Save failed')).toBeInTheDocument();
  });
});

describe('TrackedSection surface (bd startsim-q8sgy)', () => {
  beforeEach(() => vi.useRealTimers());

  it('opens the blog in the source editor with the caret in it: typing needs zero clicks (whwxd.17)', async () => {
    const onChange = vi.fn();
    render(<BlogSection value="# A headline" onChange={onChange} autoFocus />);

    // Quinn 2026-10-08: no Read-then-Edit-then-click-in before a key lands.
    expect(screen.getByTestId('tracked-text-editor')).toBeInTheDocument();
    expect(screen.queryByTestId('tracked-read-view')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Edit' })).toHaveAttribute('aria-selected', 'true');
    const view = editorView();
    expect(view.state.readOnly).toBe(false);
    expect(view.contentDOM.contains(document.activeElement)).toBe(true);

    act(() => {
      view.dispatch(view.state.replaceSelection('Hi. '), { userEvent: 'input.type' });
    });
    expect(onChange).toHaveBeenLastCalledWith('Hi. # A headline');

    // Read is still there, one choice away.
    fireEvent.click(screen.getByRole('tab', { name: 'Read' }));
    expect(screen.getByTestId('tracked-read-view')).toBeInTheDocument();
  });

  it('opening a draft saves nothing: no onChange, no autosave, no suggestion post (whwxd.17)', async () => {
    vi.useFakeTimers();
    for (const canEdit of [true, false]) {
      const onChange = vi.fn();
      const onSave = vi.fn();
      const client = {
        listSuggestions: vi.fn().mockResolvedValue({ offset_unit: 'utf16', version: 2, next_cursor: null, results: [] }),
        listComments: vi.fn().mockResolvedValue({ offset_unit: 'utf16', version: 2, next_cursor: null, results: [] }),
        propose: vi.fn().mockResolvedValue({}),
      };
      const props = { onChange, onSave, client, canEdit, currentActorSub: 'ada', autoFocus: true };
      const { rerender, unmount } = render(<BlogSection value="Body." stored="Body." version={2} {...props} />);
      // The stored text and version move under it (annotations load, a save
      // echo, an accept elsewhere) while nobody types. A change to `value`
      // itself is the page's to gate (editSeq, #96), not this card's.
      rerender(<BlogSection value="Body." stored="Body. More." version={3} {...props} />);
      await tick(10_000);
      fireEvent.blur(editorView().contentDOM);
      await tick(10_000);
      unmount();
      await tick(10_000);
      expect(onChange).not.toHaveBeenCalled();
      expect(onSave).not.toHaveBeenCalled();
      expect(client.propose).not.toHaveBeenCalled();
    }
  });

  it('opens LinkedIn in the source editor, plain text', () => {
    render(<BlogSection field="linkedin" label="LinkedIn post" language="plain" value="A post" onChange={noop} />);
    expect(screen.getByTestId('tracked-text-editor')).toBeInTheDocument();
  });

  it('gives a view-only reviewer Suggest instead of Edit, and no Accept', async () => {
    const client = {
      listSuggestions: vi.fn().mockResolvedValue({
        offset_unit: 'utf16',
        version: 2,
        next_cursor: null,
        results: [
          {
            id: 's1',
            field: 'blog',
            status: 'open',
            anchor: { from: 0, to: 6, quote: 'Before' },
            position: { state: 'mapped', from: 0, to: 6, version: 2 },
            replacement: 'After',
            author: { sub: 'vee', label: 'vee@x.io', kind: 'person' },
          },
        ],
      }),
      accept: vi.fn(),
    };
    render(<BlogSection value="Before text" version={2} client={client} canEdit={false} currentActorSub="vee" onChange={noop} />);
    expect(await screen.findByTestId('rail-suggestion')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Suggest' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Suggesting' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('tab', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
  });

  it('draws what the server has stored, not the unsaved typing', async () => {
    render(<BlogSection value="typed but not saved" stored="as stored" onChange={noop} />);
    expect(editorView().state.doc.toString()).toBe('as stored');
    // The word count is the reviewer's own text.
    expect(screen.getByText('4 words')).toBeInTheDocument();
  });
});
