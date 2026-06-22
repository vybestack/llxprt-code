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
import type { CommandContext, SlashCommand } from '../commands/types.js';
import type { Config } from '@vybestack/llxprt-code-core';
import { FileDiscoveryService } from '@vybestack/llxprt-code-storage';
import { useTextBuffer } from '../components/shared/text-buffer.js';

describe('useSlashCompletion', () => {
  let testRootDir: string;
  let mockConfig: Config;
  const mockCommandContext = {} as CommandContext;
  let testDirs: string[];

  function useTextBufferForTest(text: string, cursorOffset?: number) {
    return useTextBuffer({
      initialText: text,
      initialCursorOffset: cursorOffset ?? text.length,
      viewport: { width: 80, height: 20 },
      isValidPath: () => false,
      onChange: () => {},
    });
  }

  beforeEach(async () => {
    testRootDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'slash-completion-unit-test-'),
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

    vi.clearAllMocks();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(testRootDir, { recursive: true, force: true });
  });

  describe('Core Hook Behavior', () => {
    describe('State Management', () => {
      it('should initialize with default state', () => {
        const slashCommands = [
          { name: 'dummy', description: 'dummy' },
        ] as unknown as SlashCommand[];
        const { result } = renderHook(() =>
          useSlashCompletion(
            useTextBufferForTest(''),
            testDirs,
            testRootDir,
            slashCommands,
            mockCommandContext,
            false,
            mockConfig,
          ),
        );

        expect(result.current.suggestions).toStrictEqual([]);
        expect(result.current.activeSuggestionIndex).toBe(-1);
        expect(result.current.visibleStartIndex).toBe(0);
        expect(result.current.showSuggestions).toBe(false);
        expect(result.current.isLoadingSuggestions).toBe(false);
      });

      it('should not show suggestions for non-command text', () => {
        const slashCommands = [
          {
            name: 'help',
            altNames: ['?'],
            description: 'Show help',
            action: vi.fn(),
          },
          {
            name: 'history',
            description: 'Show history',
            action: vi.fn(),
          },
        ] as unknown as SlashCommand[];

        // Test with regular text (not a command)
        const { result } = renderHook(() =>
          useSlashCompletion(
            useTextBufferForTest('hello world'),
            testDirs,
            testRootDir,
            slashCommands,
            mockCommandContext,
            false,
            mockConfig,
          ),
        );

        expect(result.current.suggestions).toStrictEqual([]);
        expect(result.current.activeSuggestionIndex).toBe(-1);
        expect(result.current.visibleStartIndex).toBe(0);
        expect(result.current.showSuggestions).toBe(false);
        expect(result.current.isLoadingSuggestions).toBe(false);
      });

      it('should reset all state to default values', async () => {
        const slashCommands = [
          {
            name: 'help',
            description: 'Show help',
          },
        ] as unknown as SlashCommand[];

        const { result } = renderHook(() =>
          useSlashCompletion(
            useTextBufferForTest('/help'),
            testDirs,
            testRootDir,
            slashCommands,
            mockCommandContext,
            false,
            mockConfig,
          ),
        );

        act(() => {
          result.current.setActiveSuggestionIndex(5);
          result.current.setShowSuggestions(true);
        });

        act(() => {
          result.current.resetCompletionState();
        });

        // Wait for async suggestions clearing
        await waitFor(() => {
          expect(result.current.suggestions).toStrictEqual([]);
        });

        expect(result.current.suggestions).toStrictEqual([]);
        expect(result.current.activeSuggestionIndex).toBe(-1);
        expect(result.current.visibleStartIndex).toBe(0);
        expect(result.current.showSuggestions).toBe(false);
        expect(result.current.isLoadingSuggestions).toBe(false);
      });
    });

    describe('Navigation', () => {
      it('should handle navigateUp with no suggestions', () => {
        const slashCommands = [
          { name: 'dummy', description: 'dummy' },
        ] as unknown as SlashCommand[];
        const { result } = renderHook(() =>
          useSlashCompletion(
            useTextBufferForTest(''),
            testDirs,
            testRootDir,
            slashCommands,
            mockCommandContext,
            false,
            mockConfig,
          ),
        );

        act(() => {
          result.current.navigateUp();
        });

        expect(result.current.activeSuggestionIndex).toBe(-1);
      });

      it('should handle navigateDown with no suggestions', () => {
        const slashCommands = [
          { name: 'dummy', description: 'dummy' },
        ] as unknown as SlashCommand[];
        const { result } = renderHook(() =>
          useSlashCompletion(
            useTextBufferForTest(''),
            testDirs,
            testRootDir,
            slashCommands,
            mockCommandContext,
            false,

            mockConfig,
          ),
        );

        act(() => {
          result.current.navigateDown();
        });

        expect(result.current.activeSuggestionIndex).toBe(-1);
      });

      it('should navigate up through suggestions with wrap-around', () => {
        const slashCommands = [
          {
            name: 'help',
            description: 'Show help',
          },
        ] as unknown as SlashCommand[];
        const { result } = renderHook(() =>
          useSlashCompletion(
            useTextBufferForTest('/h'),
            testDirs,
            testRootDir,
            slashCommands,
            mockCommandContext,
            false,

            mockConfig,
          ),
        );

        expect(result.current.suggestions.length).toBe(1);
        expect(result.current.activeSuggestionIndex).toBe(0);

        act(() => {
          result.current.navigateUp();
        });

        expect(result.current.activeSuggestionIndex).toBe(0);
      });

      it('should navigate down through suggestions with wrap-around', () => {
        const slashCommands = [
          {
            name: 'help',
            description: 'Show help',
          },
        ] as unknown as SlashCommand[];
        const { result } = renderHook(() =>
          useSlashCompletion(
            useTextBufferForTest('/h'),
            testDirs,
            testRootDir,
            slashCommands,
            mockCommandContext,
            false,

            mockConfig,
          ),
        );

        expect(result.current.suggestions.length).toBe(1);
        expect(result.current.activeSuggestionIndex).toBe(0);

        act(() => {
          result.current.navigateDown();
        });

        expect(result.current.activeSuggestionIndex).toBe(0);
      });

      it('should handle navigation with multiple suggestions', () => {
        const slashCommands = [
          { name: 'help', description: 'Show help' },
          { name: 'stats', description: 'Show stats' },
          { name: 'clear', description: 'Clear screen' },
          { name: 'memory', description: 'Manage memory' },
          { name: 'chat', description: 'Manage chat' },
        ] as unknown as SlashCommand[];
        const { result } = renderHook(() =>
          useSlashCompletion(
            useTextBufferForTest('/'),
            testDirs,
            testRootDir,
            slashCommands,
            mockCommandContext,
            false,

            mockConfig,
          ),
        );

        expect(result.current.suggestions.length).toBe(5);
        expect(result.current.activeSuggestionIndex).toBe(0);

        act(() => {
          result.current.navigateDown();
        });
        expect(result.current.activeSuggestionIndex).toBe(1);

        act(() => {
          result.current.navigateDown();
        });
        expect(result.current.activeSuggestionIndex).toBe(2);

        act(() => {
          result.current.navigateUp();
        });
        expect(result.current.activeSuggestionIndex).toBe(1);

        act(() => {
          result.current.navigateUp();
        });
        expect(result.current.activeSuggestionIndex).toBe(0);

        act(() => {
          result.current.navigateUp();
        });
        expect(result.current.activeSuggestionIndex).toBe(4);
      });

      it('should handle navigation with large suggestion lists and scrolling', () => {
        const largeMockCommands = Array.from({ length: 15 }, (_, i) => ({
          name: `command${i}`,
          description: `Command ${i}`,
        })) as unknown as SlashCommand[];

        const { result } = renderHook(() =>
          useSlashCompletion(
            useTextBufferForTest('/command'),
            testDirs,
            testRootDir,
            largeMockCommands,
            mockCommandContext,
            false,

            mockConfig,
          ),
        );

        expect(result.current.suggestions.length).toBe(15);
        expect(result.current.activeSuggestionIndex).toBe(0);
        expect(result.current.visibleStartIndex).toBe(0);

        act(() => {
          result.current.navigateUp();
        });

        expect(result.current.activeSuggestionIndex).toBe(14);
        expect(result.current.visibleStartIndex).toBe(Math.max(0, 15 - 8));
      });
    });
  });
});
