/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '../../test-utils/render.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { act } from 'react';
import { useSlashCompletion } from './useSlashCompletion.js';
import { SCHEMA_COMPLETION_DEBOUNCE_MS } from './slashCompletionEffect.js';
import type { CommandContext, SlashCommand } from '../commands/types.js';
import type { Config } from '@vybestack/llxprt-code-core';
import { FileDiscoveryService } from '@vybestack/llxprt-code-storage';
import { useTextBuffer } from '../components/shared/text-buffer.js';

describe('useSlashCompletion — schema completion debounce (issue #2620)', () => {
  let testRootDir: string;
  let mockConfig: Config;
  const mockCommandContext = {} as CommandContext;
  let testDirs: string[];

  beforeEach(async () => {
    testRootDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'slash-debounce-test-'),
    );
    testDirs = [testRootDir];
    mockConfig = {
      getTargetDir: () => testRootDir,
      getWorkspaceContext: () => ({
        getDirectories: () => testDirs,
      }),
      getProjectRoot: () => testRootDir,
      getFileFilteringOptions: vi.fn(() => ({
        respectGitIgnore: true,
        respectLlxprtIgnore: true,
      })),
      getEnableRecursiveFileSearch: vi.fn(() => true),
      getFileService: vi.fn(() => new FileDiscoveryService(testRootDir)),
    } as unknown as Config;

    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await fs.rm(testRootDir, { recursive: true, force: true });
  });

  it('debounces rapid schema-completion keystrokes so the completer is called far fewer times', async () => {
    const callCounter = { count: 0 };
    const availableKeys = ['alpha', 'alpine', 'azure'];
    const mockCompleter = vi.fn(
      async (_ctx: CommandContext, partialArg: string) => {
        callCounter.count += 1;
        return availableKeys
          .filter((k) => k.startsWith(partialArg))
          .map((k) => ({ value: k }));
      },
    );

    const slashCommands = [
      {
        name: 'key',
        description: 'Manage keys',
        schema: [
          {
            kind: 'literal',
            value: 'load',
            description: 'Load a saved key',
            next: [
              {
                kind: 'value',
                name: 'name',
                description: 'Saved key name',
                completer: mockCompleter,
              },
            ],
          },
        ],
      },
    ] as unknown as SlashCommand[];

    const { result } = renderHook(() => {
      const textBuffer = useTextBuffer({
        initialText: '/key load ',
        initialCursorOffset: '/key load '.length,
        viewport: { width: 80, height: 20 },
        isValidPath: () => false,
        onChange: () => {},
      });
      const completion = useSlashCompletion(
        textBuffer,
        testDirs,
        testRootDir,
        slashCommands,
        mockCommandContext,
        false,
        mockConfig,
      );
      return { completion, textBuffer };
    });

    // Let the initial completion settle past the debounce window.
    await act(async () => {
      vi.advanceTimersByTime(SCHEMA_COMPLETION_DEBOUNCE_MS + 50);
    });
    const baselineCalls = callCounter.count;

    // Simulate rapid typing: append characters one keystroke at a time,
    // advancing only a tiny amount of fake time so the debounce never fires
    // until we let the window elapse at the end. The 30ms step is well below
    // SCHEMA_COMPLETION_DEBOUNCE_MS, so the trailing edge never fires mid-burst.
    const typingSequence = ['a', 'l', 'p', 'h', 'a'];
    for (const ch of typingSequence) {
      await act(async () => {
        const current = result.current.textBuffer.text;
        result.current.textBuffer.setText(current + ch);
      });
      await act(async () => {
        vi.advanceTimersByTime(30);
      });
    }

    // Before the debounce window elapses, the completer must NOT have been
    // called at all: each keystroke resets the timer within 30ms, which is
    // less than SCHEMA_COMPLETION_DEBOUNCE_MS, so the trailing edge never
    // fires until the window is allowed to elapse below.
    const beforeSettle = callCounter.count - baselineCalls;
    expect(beforeSettle).toBe(0);

    // Let the debounce window elapse so the trailing coalesced call fires.
    await act(async () => {
      vi.advanceTimersByTime(SCHEMA_COMPLETION_DEBOUNCE_MS + 50);
    });

    // After settle, exactly one coalesced completer invocation should have
    // run for the whole burst of keystrokes.
    const afterSettle = callCounter.count - baselineCalls;
    expect(afterSettle).toBe(1);

    // Suggestions should reflect the final coalesced input ('/key load alpha').
    await waitFor(() => {
      const labels = result.current.completion.suggestions.map((s) => s.value);
      expect(labels).toContain('alpha');
    });
  });

  it('clears the pending debounce timer on unmount so the completer is not invoked afterward', async () => {
    const callCounter = { count: 0 };
    const availableKeys = ['alpha'];
    const mockCompleter = vi.fn(
      async (_ctx: CommandContext, partialArg: string) => {
        callCounter.count += 1;
        return availableKeys
          .filter((k) => k.startsWith(partialArg))
          .map((k) => ({ value: k }));
      },
    );

    const slashCommands = [
      {
        name: 'key',
        description: 'Manage keys',
        schema: [
          {
            kind: 'literal',
            value: 'load',
            description: 'Load a saved key',
            next: [
              {
                kind: 'value',
                name: 'name',
                description: 'Saved key name',
                completer: mockCompleter,
              },
            ],
          },
        ],
      },
    ] as unknown as SlashCommand[];

    const { result, unmount } = renderHook(() => {
      const textBuffer = useTextBuffer({
        initialText: '/key load ',
        initialCursorOffset: '/key load '.length,
        viewport: { width: 80, height: 20 },
        isValidPath: () => false,
        onChange: () => {},
      });
      const completion = useSlashCompletion(
        textBuffer,
        testDirs,
        testRootDir,
        slashCommands,
        mockCommandContext,
        false,
        mockConfig,
      );
      return { completion, textBuffer };
    });

    // Let the initial completion settle past the debounce window.
    await act(async () => {
      vi.advanceTimersByTime(SCHEMA_COMPLETION_DEBOUNCE_MS + 50);
    });
    const baselineCalls = callCounter.count;

    // Trigger a keystroke that starts a pending debounce timer.
    await act(async () => {
      result.current.textBuffer.setText(result.current.textBuffer.text + 'a');
    });

    // Unmount BEFORE the debounce window elapses; the effect cleanup must
    // clear the pending timer.
    unmount();

    // Advance timers past the debounce window. Because cleanup cleared the
    // timer, the completer must NOT have been called after unmount.
    await act(async () => {
      vi.advanceTimersByTime(SCHEMA_COMPLETION_DEBOUNCE_MS + 50);
    });

    expect(callCounter.count).toBe(baselineCalls);
  });
});
