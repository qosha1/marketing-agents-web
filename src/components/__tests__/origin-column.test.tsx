/**
 * What the "Created by" cell actually SHOWS (bd startsim-8hgmq.6).
 *
 * The pure derivation is covered in lib/__tests__/draft-origin.test.ts. This is
 * the other half, and it is not ceremony: the reviewer's complaint was about a
 * cell, the answer has to survive the render, and no live row can demonstrate it
 * — the `_trigger` stamp went live at 2026-09-07T21:31Z and the poller's last
 * tick was 19:00:39Z, so every draft in the tenant today is the unstamped case.
 * A browser check would show only that the old rendering is unchanged. These
 * four cases are the ones a screen check cannot reach yet.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { originColumn } from '../origin-column';
import type { EntityRecord } from '@/lib/foundry-api';

const WRITER = 'n8n-weekly-writer';
const SERVICE = 'svc:n8n-ogmc';
const REVIEWER = 'qa-marketing-agents@startsimpli.com';

function cellFor(data: Record<string, unknown>, over: Partial<EntityRecord> = {}) {
  const row: EntityRecord = {
    id: 1,
    entityType: 'draft',
    externalId: 'some-headline',
    name: 'Some headline',
    data,
    createdAt: '2026-09-07T19:02:28Z',
    ownerSub: SERVICE,
    ...over,
  };
  const { container } = render(<>{originColumn().cell!(row)}</>);
  return container.firstElementChild as HTMLElement;
}

describe('the Created-by cell', () => {
  it('says Scheduled for a run the 6-hourly poller started', () => {
    const cell = cellFor({ Origin: WRITER, Trigger: 'schedule', RunId: '12864' });
    expect(screen.getByText('Scheduled')).toBeInTheDocument();
    expect(cell.title).toMatch(/6-hourly schedule/i);
    expect(cell.title).toContain('Writer run 12864');
    // Nothing to attribute: nobody pressed anything.
    expect(cell.textContent).not.toContain('@');
  });

  it('says Generated AND names the person, in the cell as well as the tooltip', () => {
    const cell = cellFor({
      Origin: WRITER,
      Trigger: 'generate_button',
      TriggeredBy: REVIEWER,
      RunId: '12853',
    });
    expect(screen.getByText('Generated')).toBeInTheDocument();
    // Rendered WHOLE and truncated by CSS — the app never invents a short form
    // for a string the pipeline treats as opaque.
    expect(screen.getByText(REVIEWER)).toBeInTheDocument();
    expect(cell.title).toContain(REVIEWER);
  });

  it('says Generated without naming anybody when the record does not', () => {
    const cell = cellFor({ Origin: WRITER, Trigger: 'generate_button' });
    expect(screen.getByText('Generated')).toBeInTheDocument();
    expect(cell.textContent?.trim()).toBe('Generated');
    expect(cell.title).toMatch(/does not say who/i);
  });

  it('leaves the 153 unstamped rows reading exactly as they did', () => {
    // The rows written before the stamp carry no `_trigger` and can never be
    // back-attributed. They must not acquire an 'Unknown' pill, and must not be
    // guessed into either caller.
    const cell = cellFor({ Origin: WRITER });
    expect(screen.getByText('AI writer')).toBeInTheDocument();
    expect(cell.textContent?.trim()).toBe('AI writer');
    expect(cell.title).toMatch(/does not say which/i);
  });

  it('shows the person and the edited flag together, without collapsing either', () => {
    const cell = cellFor(
      { Origin: WRITER, Trigger: 'generate_button', TriggeredBy: REVIEWER },
      { humanEdited: { data: { blog: {}, review: {} } } },
    );
    expect(screen.getByText('Generated')).toBeInTheDocument();
    expect(screen.getByText(REVIEWER)).toBeInTheDocument();
    expect(screen.getByText('edited')).toBeInTheDocument();
    expect(cell.title).toContain('Edited through the app since: blog, review.');
  });
});
