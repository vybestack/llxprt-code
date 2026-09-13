/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Enable React's act() environment so component state updates driven through
// the act-wrapped stdin are flushed without warnings.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from 'bun:test';
import { act } from 'react';
import { renderWithProviders } from '../../test-utils/render.js';
import { LoadProfileDialog } from './LoadProfileDialog.js';

// A lone ESC byte only decodes to an 'escape' keypress after the
// KeypressProvider's escape timeout, so tests drive the synchronous kitty/CSI-u
// keycode instead (same convention as ModelDialog.test.tsx).
const ESCAPE_KEY = '\u001B[27u';
const DOWN_ARROW = '\u001B[B';

interface RenderResult {
  lastFrame: () => string | undefined;
  stdin: { write: (data: string) => void };
  onSelect: ReturnType<typeof vi.fn>;
  onClose: ReturnType<typeof vi.fn>;
}

function renderLoadProfileDialog(props: {
  profiles: string[];
  isLoading?: boolean;
}): RenderResult {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  const { lastFrame, stdin } = renderWithProviders(
    <LoadProfileDialog
      profiles={props.profiles}
      isLoading={props.isLoading ?? false}
      onSelect={onSelect}
      onClose={onClose}
    />,
  );
  return { lastFrame, stdin, onSelect, onClose };
}

describe('LoadProfileDialog', () => {
  it('renders the loading frame while profiles are in flight', () => {
    const { lastFrame, onSelect, onClose } = renderLoadProfileDialog({
      profiles: [],
      isLoading: true,
    });

    const frame = lastFrame() ?? '';
    expect(frame).toContain('Loading profiles...');
    // The selection UI must not be interactive while loading: the grid frame
    // with its header is absent entirely.
    expect(frame).not.toContain('Select Profile (');
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders the empty-state frame when no profiles are saved', () => {
    const { lastFrame, stdin, onSelect, onClose } = renderLoadProfileDialog({
      profiles: [],
    });

    const frame = lastFrame() ?? '';
    expect(frame).toContain('No saved profiles found');
    expect(frame).not.toContain('Loading profiles...');
    expect(frame).not.toContain('Select Profile (');

    // Navigation keys are ignored with zero profiles: the empty-state frame
    // stays rendered instead of crashing or switching to the grid.
    act(() => {
      stdin.write(DOWN_ARROW);
      stdin.write('\r');
    });
    expect(lastFrame() ?? '').toContain('No saved profiles found');

    // Escape still closes, and neither key path committed a selection.
    act(() => {
      stdin.write(ESCAPE_KEY);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('renders the profile grid with the first profile highlighted', () => {
    const { lastFrame } = renderLoadProfileDialog({
      profiles: ['alpha', 'beta'],
    });

    const frame = lastFrame() ?? '';
    expect(frame).toContain('Select Profile (');
    // Two columns: both profiles share one row; only the first carries the
    // selected marker.
    expect(frame).toContain('● alpha');
    expect(frame).toContain('○ beta');
  });

  it('moves the highlight down the grid and clamps at the last profile', () => {
    const { lastFrame, stdin } = renderLoadProfileDialog({
      profiles: ['alpha', 'beta'],
    });

    expect(lastFrame() ?? '').toContain('● alpha');

    // The grid has two columns, so 'down' from index 0 targets index 2 and
    // clamps to the last row item (index 1).
    act(() => {
      stdin.write(DOWN_ARROW);
    });
    const movedFrame = lastFrame() ?? '';
    expect(movedFrame).toContain('○ alpha');
    expect(movedFrame).toContain('● beta');

    // Pressing down again stays clamped at the last profile.
    act(() => {
      stdin.write(DOWN_ARROW);
    });
    const clampedFrame = lastFrame() ?? '';
    expect(clampedFrame).toContain('○ alpha');
    expect(clampedFrame).toContain('● beta');
  });

  it('closes on Escape without committing a selection', () => {
    const { stdin, onSelect, onClose } = renderLoadProfileDialog({
      profiles: ['alpha', 'beta'],
    });

    act(() => {
      stdin.write(ESCAPE_KEY);
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('loads the highlighted profile on Enter without closing', () => {
    const { stdin, onSelect, onClose } = renderLoadProfileDialog({
      profiles: ['alpha', 'beta'],
    });

    act(() => {
      stdin.write('\r');
    });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]).toBe('alpha');
    expect(onClose).not.toHaveBeenCalled();
  });
});
