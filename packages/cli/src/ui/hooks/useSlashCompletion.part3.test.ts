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
import type { Config } from '@vybestack/llxprt-code-core';
import { FileDiscoveryService } from '@vybestack/llxprt-code-storage';
import { useTextBuffer } from '../components/shared/text-buffer.js';

describe('useSlashCompletion', () => {
  let testRootDir: string;
  let mockConfig: Config;
  const mockCommandContext = {} as CommandContext;
  let testDirs: string[];

  async function createEmptyDir(...pathSegments: string[]): Promise<string> {
    const fullPath = path.join(testRootDir, ...pathSegments);
    await fs.mkdir(fullPath, { recursive: true });
    return fullPath;
  }

  async function createTestFile(
    content: string,
    ...pathSegments: string[]
  ): Promise<string> {
    const fullPath = path.join(testRootDir, ...pathSegments);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content);
    return fullPath;
  }

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
    describe('Argument Completion', () => {
      it('should call the schema completer for argument suggestions', async () => {
        const availableTags = [
          'my-chat-tag-1',
          'my-chat-tag-2',
          'another-channel',
        ];
        const mockCompleter = vi.fn(
          async (_context: CommandContext, partialArg: string) =>
            availableTags
              .filter((tag) => tag.startsWith(partialArg))
              .map((tag) => ({ value: tag })),
        );

        const slashCommands = [
          {
            name: 'chat',
            description: 'Manage chat history',
            subCommands: [
              {
                name: 'resume',
                description: 'Resume a saved chat',
                schema: [
                  {
                    kind: 'value',
                    name: 'tag',
                    description: 'Saved chat tag',
                    completer: mockCompleter,
                  },
                ],
              },
            ],
          },
        ] as unknown as SlashCommand[];

        const { result } = renderHook(() =>
          useSlashCompletion(
            useTextBufferForTest('/chat resume my-ch'),
            testDirs,
            testRootDir,
            slashCommands,
            mockCommandContext,
            false,
            mockConfig,
          ),
        );

        await waitFor(() => {
          expect(mockCompleter).toHaveBeenCalledWith(
            mockCommandContext,
            'my-ch',
            expect.objectContaining({ partialToken: 'my-ch' }),
          );
        });

        await waitFor(() => {
          expect(result.current.suggestions).toStrictEqual([
            {
              label: 'my-chat-tag-1',
              value: 'my-chat-tag-1',
              description: undefined,
            },
            {
              label: 'my-chat-tag-2',
              value: 'my-chat-tag-2',
              description: undefined,
            },
          ]);
        });
      });

      it('should call schema completer with an empty string when args start with a space', async () => {
        const mockCompleter = vi
          .fn()
          .mockResolvedValue([
            { value: 'my-chat-tag-1' },
            { value: 'my-chat-tag-2' },
            { value: 'my-channel' },
          ]);

        const slashCommands = [
          {
            name: 'chat',
            description: 'Manage chat history',
            subCommands: [
              {
                name: 'resume',
                description: 'Resume a saved chat',
                schema: [
                  {
                    kind: 'value',
                    name: 'tag',
                    description: 'Saved chat tag',
                    completer: mockCompleter,
                  },
                ],
              },
            ],
          },
        ] as unknown as SlashCommand[];

        const { result } = renderHook(() =>
          useSlashCompletion(
            useTextBufferForTest('/chat resume '),
            testDirs,
            testRootDir,
            slashCommands,
            mockCommandContext,
            false,
            mockConfig,
          ),
        );

        await waitFor(() => {
          expect(mockCompleter).toHaveBeenCalledWith(
            mockCommandContext,
            '',
            expect.objectContaining({ partialToken: '' }),
          );
        });
        await waitFor(() => {
          expect(result.current.suggestions).toHaveLength(3);
          expect(result.current.showSuggestions).toBe(true);
        });
      });

      it('should handle schema completer that returns an empty array', async () => {
        const completer = vi.fn().mockResolvedValue([]);
        const slashCommands = [
          {
            name: 'chat',
            description: 'Manage chat history',
            subCommands: [
              {
                name: 'resume',
                description: 'Resume a saved chat',
                schema: [
                  {
                    kind: 'value',
                    name: 'tag',
                    description: 'Saved chat tag',
                    completer,
                  },
                ],
              },
            ],
          },
        ] as unknown as SlashCommand[];

        const { result } = renderHook(() =>
          useSlashCompletion(
            useTextBufferForTest('/chat resume '),
            testDirs,
            testRootDir,
            slashCommands,
            mockCommandContext,
            false,

            mockConfig,
          ),
        );

        await waitFor(() => {
          expect(result.current.suggestions).toHaveLength(0);
          expect(result.current.showSuggestions).toBe(false);
        });
      });
    });
  });

  describe('File Path Completion (`@`)', () => {
    describe('Basic Completion', () => {
      it('should use glob for top-level @ completions when available', async () => {
        await createTestFile('', 'src', 'index.ts');
        await createTestFile('', 'derp', 'script.ts');
        await createTestFile('', 'README.md');

        const { result } = renderHook(() =>
          useSlashCompletion(
            useTextBufferForTest('@s'),
            testDirs,
            testRootDir,
            [],
            mockCommandContext,
            false,

            mockConfig,
          ),
        );

        await waitFor(() => {
          expect(result.current.suggestions).toHaveLength(2);
          expect(result.current.suggestions).toStrictEqual(
            expect.arrayContaining([
              {
                label: 'derp/script.ts',
                value: 'derp/script.ts',
              },
              { label: 'src', value: 'src' },
            ]),
          );
        });
      });

      it('should handle directory-specific completions with git filtering', async () => {
        await createEmptyDir('.git');
        await createTestFile('*.log', '.gitignore');
        await createTestFile('', 'src', 'component.tsx');
        await createTestFile('', 'src', 'temp.log');
        await createTestFile('', 'src', 'index.ts');

        const { result } = renderHook(() =>
          useSlashCompletion(
            useTextBufferForTest('@src/comp'),
            testDirs,
            testRootDir,
            [],
            mockCommandContext,
            false,

            mockConfig,
          ),
        );

        await waitFor(() => {
          // Should filter out .log files but include matching .tsx files
          expect(result.current.suggestions).toStrictEqual([
            { label: 'component.tsx', value: 'component.tsx' },
          ]);
        });
      });

      it('should include dotfiles in glob search when input starts with a dot', async () => {
        await createTestFile('', '.env');
        await createTestFile('', '.gitignore');
        await createTestFile('', 'src', 'index.ts');

        const { result } = renderHook(() =>
          useSlashCompletion(
            useTextBufferForTest('@.'),
            testDirs,
            testRootDir,
            [],
            mockCommandContext,
            false,

            mockConfig,
          ),
        );

        await waitFor(() => {
          expect(result.current.suggestions).toStrictEqual([
            { label: '.env', value: '.env' },
            { label: '.gitignore', value: '.gitignore' },
          ]);
        });
      });
    });

    describe('Configuration-based Behavior', () => {
      it('should not perform recursive search when disabled in config', async () => {
        const mockConfigNoRecursive = {
          ...mockConfig,
          getEnableRecursiveFileSearch: vi.fn(() => false),
        } as unknown as Config;

        await createEmptyDir('data');
        await createEmptyDir('dist');

        const { result } = renderHook(() =>
          useSlashCompletion(
            useTextBufferForTest('@d'),
            testDirs,
            testRootDir,
            [],
            mockCommandContext,
            false,

            mockConfigNoRecursive,
          ),
        );

        await waitFor(() => {
          expect(result.current.suggestions).toStrictEqual([
            { label: 'data/', value: 'data/' },
            { label: 'dist/', value: 'dist/' },
          ]);
        });
      });

      it('should work without config (fallback behavior)', async () => {
        await createEmptyDir('src');
        await createEmptyDir('node_modules');
        await createTestFile('', 'README.md');

        const { result } = renderHook(() =>
          useSlashCompletion(
            useTextBufferForTest('@'),
            testDirs,
            testRootDir,
            [],
            mockCommandContext,
            false,
            mockConfig,
          ),
        );

        await waitFor(() => {
          // Without config, should include all files
          expect(result.current.suggestions).toHaveLength(3);
          expect(result.current.suggestions).toStrictEqual(
            expect.arrayContaining([
              { label: 'src/', value: 'src/' },
              { label: 'node_modules/', value: 'node_modules/' },
              { label: 'README.md', value: 'README.md' },
            ]),
          );
        });
      });

      it('should handle git discovery service initialization failure gracefully', async () => {
        // Intentionally don't create a .git directory to cause an initialization failure.
        await createEmptyDir('src');
        await createTestFile('', 'README.md');

        const consoleSpy = vi
          .spyOn(console, 'warn')
          .mockImplementation(() => {});

        const { result } = renderHook(() =>
          useSlashCompletion(
            useTextBufferForTest('@'),
            testDirs,
            testRootDir,
            [],
            mockCommandContext,
            false,

            mockConfig,
          ),
        );

        await waitFor(() => {
          // Since we use centralized service, initialization errors are handled at config level
          // This test should verify graceful fallback behavior
          expect(result.current.suggestions.length).toBeGreaterThanOrEqual(0);
          // Should still show completions even if git discovery fails
          expect(result.current.suggestions.length).toBeGreaterThan(0);
        });

        consoleSpy.mockRestore();
      });
    });

    describe('Git-Aware Filtering', () => {
      it('should filter git-ignored entries from @ completions', async () => {
        await createEmptyDir('.git');
        await createTestFile('dist', '.gitignore');
        await createEmptyDir('data');

        const { result } = renderHook(() =>
          useSlashCompletion(
            useTextBufferForTest('@d'),
            testDirs,
            testRootDir,
            [],
            mockCommandContext,
            false,

            mockConfig,
          ),
        );

        // Wait for async operations to complete
        await waitFor(() => {
          expect(result.current.suggestions).toStrictEqual(
            expect.arrayContaining([{ label: 'data', value: 'data' }]),
          );
          expect(result.current.showSuggestions).toBe(true);
        });
      });

      it('should filter git-ignored directories from @ completions', async () => {
        await createEmptyDir('.git');
        await createTestFile('node_modules\ndist\n.env', '.gitignore');
        // gitignored entries
        await createEmptyDir('node_modules');
        await createEmptyDir('dist');
        await createTestFile('', '.env');

        // visible
        await createEmptyDir('src');
        await createTestFile('', 'README.md');

        const { result } = renderHook(() =>
          useSlashCompletion(
            useTextBufferForTest('@'),
            testDirs,
            testRootDir,
            [],
            mockCommandContext,
            false,

            mockConfig,
          ),
        );

        // Wait for async operations to complete
        await waitFor(() => {
          expect(result.current.suggestions).toStrictEqual([
            { label: 'README.md', value: 'README.md' },
            { label: 'src/', value: 'src/' },
          ]);
          expect(result.current.showSuggestions).toBe(true);
        });
      });

      it('should handle recursive search with git-aware filtering', async () => {
        await createEmptyDir('.git');
        await createTestFile('node_modules/\ntemp/', '.gitignore');
        await createTestFile('', 'data', 'test.txt');
        await createEmptyDir('dist');
        await createEmptyDir('node_modules');
        await createTestFile('', 'src', 'index.ts');
        await createEmptyDir('src', 'components');
        await createTestFile('', 'temp', 'temp.log');

        const { result } = renderHook(() =>
          useSlashCompletion(
            useTextBufferForTest('@t'),
            testDirs,
            testRootDir,
            [],
            mockCommandContext,
            false,

            mockConfig,
          ),
        );

        await waitFor(() => {
          // Should not include anything from node_modules or dist
          const suggestionLabels = result.current.suggestions.map(
            (s) => s.label,
          );
          expect(suggestionLabels).not.toContain('temp/');
          expect(suggestionLabels).not.toContain('node_modules/');
        });
      });
    });
  });
});
