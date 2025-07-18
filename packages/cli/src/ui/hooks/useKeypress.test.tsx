/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderHook, waitFor } from '@testing-library/react';
import { EventEmitter } from 'events';
import { Key, useKeypress } from './useKeypress.js';
import { vi } from 'vitest';

// Mock ink module at the top level
vi.mock('ink', () => ({
  useStdin: vi.fn(),
}));

describe('useKeypress', () => {
  let stdin: EventEmitter & {
    isTTY: boolean;
    setRawMode: (mode: boolean) => void;
    resume: () => void;
    pause: () => void;
  };
  let setRawMode: (mode: boolean) => void;
  let onKeypress: (key: Key) => void;

  beforeEach(async () => {
    stdin = Object.assign(new EventEmitter(), {
      isTTY: true,
      setRawMode: vi.fn(),
      resume: vi.fn(),
      pause: vi.fn(),
    });
    setRawMode = vi.fn();
    onKeypress = vi.fn();

    // Update the mock implementation for this test
    const { useStdin } = await import('ink');
    vi.mocked(useStdin).mockReturnValue({ stdin, setRawMode });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('paste functionality', () => {
    it('should handle multi-line paste with bracketed paste mode', async () => {
      renderHook(
        ({ onKeypress, isActive }) => useKeypress(onKeypress, { isActive }),
        {
          initialProps: { onKeypress, isActive: true },
        },
      );

      // Simulate paste-start event
      stdin.emit('keypress', undefined, {
        name: 'paste-start',
        ctrl: false,
        meta: false,
        shift: false,
        paste: false,
        sequence: '',
      });

      // Simulate pasted content (line 1)
      stdin.emit('keypress', undefined, {
        name: '',
        ctrl: false,
        meta: false,
        shift: false,
        paste: false,
        sequence: 'First line of paste',
      });

      // Simulate newline in paste
      stdin.emit('keypress', undefined, {
        name: 'return',
        ctrl: false,
        meta: false,
        shift: false,
        paste: false,
        sequence: '\n',
      });

      // Simulate pasted content (line 2)
      stdin.emit('keypress', undefined, {
        name: '',
        ctrl: false,
        meta: false,
        shift: false,
        paste: false,
        sequence: 'Second line of paste',
      });

      // Simulate paste-end event
      stdin.emit('keypress', undefined, {
        name: 'paste-end',
        ctrl: false,
        meta: false,
        shift: false,
        paste: false,
        sequence: '',
      });

      await waitFor(() => {
        expect(onKeypress).toHaveBeenCalledWith({
          name: '',
          ctrl: false,
          meta: false,
          shift: false,
          paste: true,
          sequence: 'First line of paste\nSecond line of paste',
        });
      });

      // Verify that only one call was made for the entire paste
      expect(onKeypress).toHaveBeenCalledTimes(1);
    });

    it('should handle raw data paste with escape sequences', async () => {
      // Mock Node version < 20 to test raw paste handling
      const originalNodeVersion = process.versions.node;
      Object.defineProperty(process.versions, 'node', {
        value: '18.0.0',
        configurable: true,
      });

      renderHook(
        ({ onKeypress, isActive }) => useKeypress(onKeypress, { isActive }),
        {
          initialProps: { onKeypress, isActive: true },
        },
      );

      // Simulate bracketed paste with raw data
      const pasteData = Buffer.concat([
        Buffer.from('\x1B[200~'),
        Buffer.from('Line 1\nLine 2\nLine 3'),
        Buffer.from('\x1B[201~'),
      ]);

      stdin.emit('data', pasteData);

      await waitFor(() => {
        expect(onKeypress).toHaveBeenCalledWith({
          name: '',
          ctrl: false,
          meta: false,
          shift: false,
          paste: true,
          sequence: 'Line 1\nLine 2\nLine 3',
        });
      });

      // Restore Node version
      Object.defineProperty(process.versions, 'node', {
        value: originalNodeVersion,
        configurable: true,
      });
    });

    it('should handle paste cleanup on unmount', async () => {
      const { unmount } = renderHook(
        ({ onKeypress, isActive }) => useKeypress(onKeypress, { isActive }),
        {
          initialProps: { onKeypress, isActive: true },
        },
      );

      // Start a paste but don't end it
      stdin.emit('keypress', undefined, {
        name: 'paste-start',
        ctrl: false,
        meta: false,
        shift: false,
        paste: false,
        sequence: '',
      });

      stdin.emit('keypress', undefined, {
        name: '',
        ctrl: false,
        meta: false,
        shift: false,
        paste: false,
        sequence: 'Incomplete paste',
      });

      // Unmount without paste-end
      unmount();

      // Should have sent the incomplete paste
      expect(onKeypress).toHaveBeenCalledWith({
        name: '',
        ctrl: false,
        meta: false,
        shift: false,
        paste: true,
        sequence: 'Incomplete paste',
      });
    });
  });
});
