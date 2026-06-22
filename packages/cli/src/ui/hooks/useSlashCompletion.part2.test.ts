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
import { useSlashCompletion } from './useSlashCompletion.js';
import type { CommandContext, SlashCommand } from '../commands/types.js';
import { CommandKind } from '../commands/types.js';
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

  describe('Slash Command Completion ( (split)', () => {
    describe('Top-Level Commands', () => {
      it('should suggest all top-level commands for the root slash', async () => {
        const slashCommands = [
          {
            name: 'help',
            altNames: ['?'],
            description: 'Show help',
          },
          {
            name: 'stats',
            altNames: ['usage'],
            description:
              'check session stats. Usage: /stats [session|model|tools|cache|buckets|quota|lb]',
          },
          {
            name: 'clear',
            description: 'Clear the screen',
          },
          {
            name: 'memory',
            description: 'Manage memory',
            subCommands: [
              {
                name: 'show',
                description: 'Show memory',
              },
            ],
          },
          {
            name: 'chat',
            description: 'Manage chat history',
          },
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

        expect(result.current.suggestions.length).toBe(slashCommands.length);
        expect(result.current.suggestions.map((s) => s.label)).toStrictEqual(
          expect.arrayContaining(['help', 'clear', 'memory', 'chat', 'stats']),
        );
      });

      it('should filter commands based on partial input', async () => {
        const slashCommands = [
          {
            name: 'memory',
            description: 'Manage memory',
          },
        ] as unknown as SlashCommand[];
        const { result } = renderHook(() =>
          useSlashCompletion(
            useTextBufferForTest('/mem'),
            testDirs,
            testRootDir,
            slashCommands,
            mockCommandContext,
            false,
            mockConfig,
          ),
        );

        expect(result.current.suggestions).toStrictEqual([
          { label: 'memory', value: 'memory', description: 'Manage memory' },
        ]);
        expect(result.current.showSuggestions).toBe(true);
      });

      it('should suggest commands based on partial altNames', async () => {
        const slashCommands = [
          {
            name: 'stats',
            altNames: ['usage'],
            description:
              'check session stats. Usage: /stats [session|model|tools|cache|buckets|quota|lb]',
          },
        ] as unknown as SlashCommand[];
        const { result } = renderHook(() =>
          useSlashCompletion(
            useTextBufferForTest('/usag'), // partial alt name "usage"
            testDirs,
            testRootDir,
            slashCommands,
            mockCommandContext,
            false,
            mockConfig,
          ),
        );

        expect(result.current.suggestions).toStrictEqual([
          {
            label: 'stats',
            value: 'stats',
            description:
              'check session stats. Usage: /stats [session|model|tools|cache|buckets|quota|lb]',
          },
        ]);
      });

      it('should provide suggestions even for a perfectly typed command that is a leaf node', async () => {
        const slashCommands = [
          {
            name: 'clear',
            description: 'Clear the screen',
            action: vi.fn(),
          },
        ] as unknown as SlashCommand[];
        const { result } = renderHook(() =>
          useSlashCompletion(
            useTextBufferForTest('/clear'), // No trailing space
            testDirs,
            testRootDir,
            slashCommands,
            mockCommandContext,
            false,
            mockConfig,
          ),
        );

        await waitFor(() => {
          expect(result.current.suggestions).toHaveLength(1);
          expect(result.current.suggestions[0].label).toBe('clear');
          expect(result.current.isPerfectMatch).toBe(true);
        });
      });

      it.each([['/?'], ['/usage']])(
        'should suggest commands even when altNames is fully typed',
        async (query) => {
          const mockSlashCommands = [
            {
              name: 'help',
              altNames: ['?'],
              description: 'Show help',
              action: vi.fn(),
            },
            {
              name: 'stats',
              altNames: ['usage'],
              description:
                'check session stats. Usage: /stats [session|model|tools|cache|buckets|quota|lb]',
              action: vi.fn(),
            },
          ] as unknown as SlashCommand[];

          const { result } = renderHook(() =>
            useSlashCompletion(
              useTextBufferForTest(query),
              testDirs,
              testRootDir,
              mockSlashCommands,
              mockCommandContext,
            ),
          );

          await waitFor(() => {
            expect(result.current.suggestions).toHaveLength(1);
            expect(result.current.isPerfectMatch).toBe(true);
          });
        },
      );

      it('should show all matching suggestions even when one is a perfect match', async () => {
        const slashCommands = [
          {
            name: 'review',
            description: 'Review code',
            action: vi.fn(),
          },
          {
            name: 'review-frontend',
            description: 'Review frontend code',
            action: vi.fn(),
          },
          {
            name: 'review-backend',
            description: 'Review backend code',
            action: vi.fn(),
          },
        ] as unknown as SlashCommand[];

        const { result } = renderHook(() =>
          useSlashCompletion(
            useTextBufferForTest('/review'),
            testDirs,
            testRootDir,
            slashCommands,
            mockCommandContext,
            false,
            mockConfig,
          ),
        );

        await waitFor(() => {
          // All three should match 'review' as prefix/exact
          expect(result.current.suggestions.length).toBe(3);
          // 'review' should be first because it is an exact match
          expect(result.current.suggestions[0].label).toBe('review');

          const labels = result.current.suggestions.map((s) => s.label);
          expect(labels).toContain('review');
          expect(labels).toContain('review-frontend');
          expect(labels).toContain('review-backend');
          expect(result.current.isPerfectMatch).toBe(true);
        });
      });

      it('should sort exact altName matches to the top', async () => {
        const slashCommands = [
          {
            name: 'help',
            altNames: ['?'],
            description: 'Show help',
            action: vi.fn(),
          },
          {
            name: 'question-mark',
            description: 'Alternative name for help',
            action: vi.fn(),
          },
        ] as unknown as SlashCommand[];

        const { result } = renderHook(() =>
          useSlashCompletion(
            useTextBufferForTest('/?'),
            testDirs,
            testRootDir,
            slashCommands,
            mockCommandContext,
            false,
            mockConfig,
          ),
        );

        await waitFor(() => {
          // 'help' should be first because '?' is an exact altName match
          expect(result.current.suggestions[0].label).toBe('help');
          expect(result.current.isPerfectMatch).toBe(true);
        });
      });

      it('should suggest subcommands when a parent command is fully typed without a trailing space', async () => {
        const slashCommands = [
          {
            name: 'chat',
            description: 'Manage chat history',
            subCommands: [
              {
                name: 'list',
                description: 'List chats',
                action: vi.fn(),
              },
              {
                name: 'save',
                description: 'Save chat',
                action: vi.fn(),
              },
            ],
          },
        ] as unknown as SlashCommand[];

        const { result } = renderHook(() =>
          useSlashCompletion(
            useTextBufferForTest('/chat'),
            testDirs,
            testRootDir,
            slashCommands,
            mockCommandContext,
            false,
            mockConfig,
          ),
        );

        await waitFor(() => {
          // Should show subcommands of 'chat'
          expect(result.current.suggestions).toHaveLength(2);
          expect(result.current.suggestions.map((s) => s.label)).toStrictEqual(
            expect.arrayContaining(['list', 'save']),
          );
        });
      });

      it('should not provide suggestions for a fully typed command that has no sub-commands or argument completion', async () => {
        const slashCommands = [
          {
            name: 'clear',
            description: 'Clear the screen',
          },
        ] as unknown as SlashCommand[];
        const { result } = renderHook(() =>
          useSlashCompletion(
            useTextBufferForTest('/clear '),
            testDirs,
            testRootDir,
            slashCommands,
            mockCommandContext,
            false,
            mockConfig,
          ),
        );

        expect(result.current.suggestions).toHaveLength(0);
        expect(result.current.showSuggestions).toBe(false);
      });

      it('should not provide suggestions for an unknown command', async () => {
        const slashCommands = [
          {
            name: 'help',
            description: 'Show help',
          },
        ] as unknown as SlashCommand[];
        const { result } = renderHook(() =>
          useSlashCompletion(
            useTextBufferForTest('/unknown-command'),
            testDirs,
            testRootDir,
            slashCommands,
            mockCommandContext,
            false,
            mockConfig,
          ),
        );

        expect(result.current.suggestions).toHaveLength(0);
        expect(result.current.showSuggestions).toBe(false);
      });
    });

    describe('Sub-Commands', () => {
      it('should suggest sub-commands for a parent command', async () => {
        const slashCommands = [
          {
            name: 'memory',
            description: 'Manage memory',
            subCommands: [
              {
                name: 'show',
                description: 'Show memory',
              },
              {
                name: 'add',
                description: 'Add to memory',
              },
            ],
          },
        ] as unknown as SlashCommand[];

        const { result } = renderHook(() =>
          useSlashCompletion(
            useTextBufferForTest('/memory '), // Note: trailing space indicates wanting subcommands
            testDirs,
            testRootDir,
            slashCommands,
            mockCommandContext,
            false,
            mockConfig,
          ),
        );

        // Assert that suggestions for sub-commands are shown immediately
        expect(result.current.suggestions).toHaveLength(2);
        expect(result.current.suggestions).toStrictEqual(
          expect.arrayContaining([
            { label: 'show', value: 'show', description: 'Show memory' },
            { label: 'add', value: 'add', description: 'Add to memory' },
          ]),
        );
        expect(result.current.showSuggestions).toBe(true);
      });

      it('should suggest parent command (and siblings) instead of sub-commands when no trailing space', async () => {
        const slashCommands = [
          {
            name: 'memory',
            kind: CommandKind.BUILT_IN,
            description: 'Manage memory',
            subCommands: [
              {
                name: 'show',
                kind: CommandKind.BUILT_IN,
                description: 'Show memory',
              },
            ],
          },
          {
            name: 'memory-leak',
            kind: CommandKind.BUILT_IN,
            description: 'Debug memory leaks',
          },
        ] as unknown as SlashCommand[];

        const { result } = renderHook(() =>
          useSlashCompletion(
            useTextBufferForTest('/memory'),
            testDirs,
            testRootDir,
            slashCommands,
            mockCommandContext,
            false,
            mockConfig,
          ),
        );

        // Should verify that we see BOTH 'memory' and 'memory-leak'
        await waitFor(() => {
          expect(result.current.suggestions).toHaveLength(2);
          expect(result.current.suggestions).toStrictEqual(
            expect.arrayContaining([
              {
                label: 'memory',
                value: 'memory',
                description: 'Manage memory',
              },
              {
                label: 'memory-leak',
                value: 'memory-leak',
                description: 'Debug memory leaks',
              },
            ]),
          );
        });
      });

      it('should suggest all sub-commands when the query ends with the parent command and a space', async () => {
        const slashCommands = [
          {
            name: 'memory',
            description: 'Manage memory',
            subCommands: [
              {
                name: 'show',
                description: 'Show memory',
              },
              {
                name: 'add',
                description: 'Add to memory',
              },
            ],
          },
        ] as unknown as SlashCommand[];
        const { result } = renderHook(() =>
          useSlashCompletion(
            useTextBufferForTest('/memory '),
            testDirs,
            testRootDir,
            slashCommands,
            mockCommandContext,
            false,
            mockConfig,
          ),
        );

        expect(result.current.suggestions).toHaveLength(2);
        expect(result.current.suggestions).toStrictEqual(
          expect.arrayContaining([
            { label: 'show', value: 'show', description: 'Show memory' },
            { label: 'add', value: 'add', description: 'Add to memory' },
          ]),
        );
      });

      it('should filter sub-commands by prefix', async () => {
        const slashCommands = [
          {
            name: 'memory',
            description: 'Manage memory',
            subCommands: [
              {
                name: 'show',
                description: 'Show memory',
              },
              {
                name: 'add',
                description: 'Add to memory',
              },
            ],
          },
        ] as unknown as SlashCommand[];
        const { result } = renderHook(() =>
          useSlashCompletion(
            useTextBufferForTest('/memory a'),
            testDirs,
            testRootDir,
            slashCommands,
            mockCommandContext,
            false,
            mockConfig,
          ),
        );

        expect(result.current.suggestions).toStrictEqual([
          { label: 'add', value: 'add', description: 'Add to memory' },
        ]);
      });

      it('should provide no suggestions for an invalid sub-command', async () => {
        const slashCommands = [
          {
            name: 'memory',
            description: 'Manage memory',
            subCommands: [
              {
                name: 'show',
                description: 'Show memory',
              },
              {
                name: 'add',
                description: 'Add to memory',
              },
            ],
          },
        ] as unknown as SlashCommand[];
        const { result } = renderHook(() =>
          useSlashCompletion(
            useTextBufferForTest('/memory dothisnow'),
            testDirs,
            testRootDir,
            slashCommands,
            mockCommandContext,
            false,
            mockConfig,
          ),
        );

        expect(result.current.suggestions).toHaveLength(0);
        expect(result.current.showSuggestions).toBe(false);
      });
    });
  });
});
