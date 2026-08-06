/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** @vitest-environment jsdom */

import { ExitCodes } from '@vybestack/llxprt-code-core';
import { renderWithProviders, waitFor } from '../../test-utils/render.js';
import { createDeferred } from '../../test-utils/async.js';
import { act, StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { FolderTrustDialog } from './FolderTrustDialog.js';

const mockedExit = vi.fn();
const KITTY_ESCAPE_SEQUENCE = '\u001b[27u';

vi.mock('node:process', async () => {
  const actual =
    await vi.importActual<typeof import('node:process')>('node:process');
  return {
    ...actual,
    exit: mockedExit,
  };
});

describe('FolderTrustDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render the dialog with title and description', () => {
    const { lastFrame } = renderWithProviders(
      <FolderTrustDialog
        workingDirectory="/home/user/project"
        onSelect={vi.fn()}
      />,
    );

    expect(lastFrame()).toContain('Do you trust this folder?');
    expect(lastFrame()).toContain(
      'Trusting a folder allows llxprt to execute commands it suggests.',
    );
  });

  it('uses the configured working directory for option labels', () => {
    const { lastFrame } = renderWithProviders(
      <FolderTrustDialog
        workingDirectory="/configured/workspace/project"
        onSelect={vi.fn()}
      />,
    );

    expect(lastFrame()).toContain('Trust folder (project)');
    expect(lastFrame()).toContain('Trust parent folder (workspace)');
  });

  it('should display exit message and call process.exit and not call onSelect when escape is pressed', async () => {
    const onSelect = vi.fn();
    const { lastFrame, stdin } = renderWithProviders(
      <FolderTrustDialog
        workingDirectory="/home/user/project"
        onSelect={onSelect}
      />,
    );

    act(() => {
      stdin.write(KITTY_ESCAPE_SEQUENCE); // Press kitty escape key
    });

    await waitFor(() => {
      expect(lastFrame()).toContain(
        'A folder trust level must be selected to continue. Exiting since escape was pressed.',
      );
    });
    await waitFor(() => {
      expect(mockedExit).toHaveBeenCalledWith(ExitCodes.FATAL_CONFIG_ERROR);
    });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('cancels the pending exit when the dialog unmounts', () => {
    vi.useFakeTimers();
    try {
      const { stdin, unmount } = renderWithProviders(
        <FolderTrustDialog
          workingDirectory="/home/user/project"
          onSelect={vi.fn()}
        />,
      );

      act(() => {
        stdin.write(KITTY_ESCAPE_SEQUENCE);
      });
      unmount();
      act(() => {
        vi.advanceTimersByTime(100);
      });

      expect(mockedExit).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('serializes an async selection and ignores Enter and Escape until it settles', async () => {
    const selection = createDeferred<void>();
    const onSelect = vi.fn(() => selection.promise);
    const { stdin } = renderWithProviders(
      <FolderTrustDialog
        workingDirectory="/home/user/project"
        onSelect={onSelect}
      />,
    );

    act(() => {
      stdin.write('\r');
      stdin.write('\r');
      stdin.write(KITTY_ESCAPE_SEQUENCE);
    });

    await waitFor(() => expect(onSelect).toHaveBeenCalledOnce());
    expect(mockedExit).not.toHaveBeenCalled();
    selection.resolve();
    await selection.promise;

    act(() => {
      stdin.write(KITTY_ESCAPE_SEQUENCE);
    });
    await waitFor(() => expect(mockedExit).toHaveBeenCalledOnce());
  });

  it('allows another selection after StrictMode replays the mount effect', async () => {
    const selection = createDeferred<void>();
    const onSelect = vi
      .fn()
      .mockReturnValueOnce(selection.promise)
      .mockResolvedValue(undefined);
    const { stdin } = renderWithProviders(
      <StrictMode>
        <FolderTrustDialog
          workingDirectory="/home/user/project"
          onSelect={onSelect}
        />
      </StrictMode>,
    );

    act(() => {
      stdin.write('\r');
    });
    await waitFor(() => expect(onSelect).toHaveBeenCalledOnce());

    selection.resolve();
    await act(async () => selection.promise);
    act(() => {
      stdin.write('\r');
    });

    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(2));
  });

  it('shows an actionable error when applying the selection fails', async () => {
    const selection = createDeferred<void>();
    const { lastFrame, stdin } = renderWithProviders(
      <FolderTrustDialog
        workingDirectory="/home/user/project"
        onSelect={() => selection.promise}
      />,
    );

    act(() => {
      stdin.write('\r');
    });
    selection.reject(new Error('disk full'));

    await waitFor(() => {
      expect(lastFrame()).toContain(
        'Failed to apply folder trust selection: disk full',
      );
    });
  });

  it('shows an actionable error when applying the selection throws synchronously', async () => {
    const { lastFrame, stdin } = renderWithProviders(
      <FolderTrustDialog
        workingDirectory="/home/user/project"
        onSelect={() => {
          throw new Error('synchronous failure');
        }}
      />,
    );

    act(() => {
      stdin.write('\r');
    });

    await waitFor(() => {
      expect(lastFrame()).toContain(
        'Failed to apply folder trust selection: synchronous failure',
      );
    });
  });

  describe('parentFolder display', () => {
    it('should correctly display the parent folder name for a nested directory', () => {
      const { lastFrame } = renderWithProviders(
        <FolderTrustDialog
          workingDirectory="/home/user/project"
          onSelect={vi.fn()}
        />,
      );
      expect(lastFrame()).toContain('Trust parent folder (user)');
    });

    it('should correctly display an empty parent folder name for a directory directly under root', () => {
      const { lastFrame } = renderWithProviders(
        <FolderTrustDialog workingDirectory="/project" onSelect={vi.fn()} />,
      );
      expect(lastFrame()).toContain('Trust parent folder ()');
    });
  });
});
