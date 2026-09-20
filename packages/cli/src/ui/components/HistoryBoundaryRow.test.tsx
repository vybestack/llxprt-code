/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260917-ISSUE854.P03
 * @requirement G4
 *
 * Boundary-row expander contract (issue-854-design.md §4 P03): a row
 * rendered at a compression/rewind/density boundary shows the removal
 * reason and the removed-entry count, and expands on demand to show the
 * summary text. The text is a journal re-read: the supplied loader runs
 * ONLY when the row expands — never on render, never on collapse — and
 * the loaded text is dropped on collapse, so a re-expand re-reads. When
 * the row is purged from the resident set (scrollbackPager eviction drops
 * the element), the expansion state is dropped with it: a re-added row
 * mounts collapsed and re-reads on its next expand.
 */

import type React from 'react';
import { describe, it, expect, vi, beforeEach } from 'bun:test';
import { HistoryBoundaryRow } from './HistoryBoundaryRow.js';
import { renderWithProviders } from '../../test-utils/render.js';

const { waitFor } = await import('../../test-utils/render.js');

function noopToggle(): void {
  /* the parent wires the actual keystroke; tests pass a no-op */
}

describe('<HistoryBoundaryRow />', () => {
  let loadSummary: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    loadSummary = vi.fn(() => Promise.resolve('summary of the removed span'));
  });

  function rowElement(
    expanded: boolean,
    onToggle: () => void = noopToggle,
  ): React.JSX.Element {
    return (
      <HistoryBoundaryRow
        reason="compressed"
        count={6}
        expanded={expanded}
        onToggle={onToggle}
        loadSummary={loadSummary}
      />
    );
  }

  it('collapsed row renders the reason label and removed count without calling the loader', () => {
    const { lastFrame } = renderWithProviders(rowElement(false));
    expect(lastFrame()).toContain('compressed');
    expect(lastFrame()).toContain('6');
    expect(lastFrame()).not.toContain('summary of the removed span');
    expect(loadSummary).not.toHaveBeenCalled();
  });

  it('expand calls the loader exactly once and renders the summary text it returned', async () => {
    const { lastFrame, rerender } = renderWithProviders(rowElement(false));
    rerender(rowElement(true));
    await waitFor(() => {
      expect(lastFrame()).toContain('summary of the removed span');
    });
    expect(loadSummary).toHaveBeenCalledTimes(1);
  });

  it('collapse drops the loaded text without re-reading, and re-expand re-reads the journal', async () => {
    const { lastFrame, rerender } = renderWithProviders(rowElement(false));
    rerender(rowElement(true));
    await waitFor(() => {
      expect(loadSummary).toHaveBeenCalledTimes(1);
    });
    rerender(rowElement(false));
    expect(lastFrame()).not.toContain('summary of the removed span');
    expect(loadSummary).toHaveBeenCalledTimes(1);
    rerender(rowElement(true));
    await waitFor(() => {
      expect(loadSummary).toHaveBeenCalledTimes(2);
      expect(lastFrame()).toContain('summary of the removed span');
    });
  });

  it('purged row loses expansion state: re-added row mounts collapsed and re-reads on expand', async () => {
    // Purge half: the pager eviction unmounts the expanded row's element.
    const purged = renderWithProviders(rowElement(false));
    purged.rerender(rowElement(true));
    await waitFor(() => {
      expect(loadSummary).toHaveBeenCalledTimes(1);
    });
    purged.unmount();

    // Re-add half: the record is paged back in and the row remounts with
    // the same key — fresh state, collapsed, nothing loaded.
    const readded = renderWithProviders(rowElement(false));
    expect(readded.lastFrame()).not.toContain('summary of the removed span');
    expect(loadSummary).toHaveBeenCalledTimes(1);
    readded.rerender(rowElement(true));
    await waitFor(() => {
      expect(loadSummary).toHaveBeenCalledTimes(2);
    });
    readded.unmount();
  });
});
