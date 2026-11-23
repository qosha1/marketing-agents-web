/**
 * One main surface, history built in (bd startsim-m7fdm.27): the document is the
 * only column; History is opened from the header and slides over it instead of
 * being a permanent third/fourth column.
 */
import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DraftReviewLayout } from '../DraftReviewLayout';

const base = { header: <div>HEAD</div>, content: <div>DOC</div>, rail: <div>RAIL</div> };

describe('DraftReviewLayout', () => {
  it('renders no history column while History is closed', () => {
    const { container } = render(<DraftReviewLayout {...base} railOpen={false} onRailClose={vi.fn()} />);
    expect(screen.getByText('DOC')).toBeInTheDocument();
    expect(screen.queryByText('RAIL')).toBeNull();
    expect(container.querySelector('[class*="grid-cols"]')).toBeNull();
  });

  it('opens History as a dialog over the document, and closes it', () => {
    const onRailClose = vi.fn();
    render(<DraftReviewLayout {...base} railOpen onRailClose={onRailClose} />);
    const dialog = screen.getByRole('dialog', { name: /history/i });
    expect(dialog).toHaveTextContent('RAIL');
    fireEvent.click(screen.getByRole('button', { name: /close history/i }));
    expect(onRailClose).toHaveBeenCalled();
  });

  it('closes on Escape', () => {
    const onRailClose = vi.fn();
    render(<DraftReviewLayout {...base} railOpen onRailClose={onRailClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onRailClose).toHaveBeenCalled();
  });
});
