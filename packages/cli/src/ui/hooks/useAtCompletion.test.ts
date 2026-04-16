/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** @vitest-environment jsdom */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { act, useState } from 'react';
import { renderHook, waitFor } from '../../test-utils/render.js';
import { useAtCompletion } from './useAtCompletion.js';
import type { Config, FileSearch } from '@vybestack/llxprt-code-core';
import { FileSearchFactory } from '@vybestack/llxprt-code-core';
import type { FileSystemStructure } from '@vybestack/llxprt-code-test-utils';
import { createTmpDir, cleanupTmpDir } from '@vybestack/llxprt-code-test-utils';
import type { Suggestion } from '../components/SuggestionsDisplay.js';

// Test harness to capture the state from the hook's callbacks.
function useTestHarnessForAtCompletion(
  enabled: boolean,
  pattern: string,
  config: Config | undefined,
  cwd: string,
) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);

  useAtCompletion({
    enabled,
    pattern,
    config,
    cwd,
    setSuggestions,
    setIsLoadingSuggestions,
  });

  return { suggestions, isLoadingSuggestions };
}

describe('useAtCompletion', () => {
  let testRootDir: string;
  let mockConfig: Config;

  beforeEach(() => {
    mockConfig = {
      getFileFilteringOptions: vi.fn(() => ({
        respectGitIgnore: true,
        respectGeminiIgnore: true,
      })),
      getEnableRecursiveFileSearch: () => true,
      getFileFilteringDisableFuzzySearch: () => false,
    } as unknown as Config;
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (testRootDir) {
      await cleanupTmpDir(testRootDir);
    }
    vi.restoreAllMocks();
  });

  describe('File Search Logic', () => {
    it('should perform a recursive search for an empty pattern', async () => {
      const structure: FileSystemStructure = {
        'file.txt': '',
        src: {
          'index.js': '',
          components: ['Button.tsx', 'Button with spaces.tsx'],
        },
      };
      testRootDir = await createTmpDir(structure);

      const { result } = renderHook(() =>
        useTestHarnessForAtCompletion(true, '', mockConfig, testRootDir),
      );

      await waitFor(() => {
        expect(result.current.suggestions.length).toBeGreaterThan(0);
      });

      expect(result.current.suggestions.map((s) => s.value)).toStrictEqual([
        'src/',
        'src/components/',
        'file.txt',
        'src/components/Button\\ with\\ spaces.tsx',
        'src/components/Button.tsx',
        'src/index.js',
      ]);
    });

    it('should correctly filter the recursive list based on a pattern', async () => {
      const structure: FileSystemStructure = {
        'file.txt': '',
        src: {
          'index.js': '',
          components: {
            'Button.tsx': '',
          },
        },
      };
      testRootDir = await createTmpDir(structure);

      const { result } = renderHook(() =>
        useTestHarnessForAtCompletion(true, 'src/', mockConfig, testRootDir),
      );

      await waitFor(() => {
        expect(result.current.suggestions.length).toBeGreaterThan(0);
      });

      expect(result.current.suggestions.map((s) => s.value)).toStrictEqual([
        'src/',
        'src/components/',
        'src/index.js',
        'src/components/Button.tsx',
      ]);
    });

    it('should append a trailing slash to directory paths in suggestions', async () => {
      const structure: FileSystemStructure = {
        'file.txt': '',
        dir: {},
      };
      testRootDir = await createTmpDir(structure);

      const { result } = renderHook(() =>
        useTestHarnessForAtCompletion(true, '', mockConfig, testRootDir),
      );

      await waitFor(() => {
        expect(result.current.suggestions.length).toBeGreaterThan(0);
      });

      expect(result.current.suggestions.map((s) => s.value)).toStrictEqual([
        'dir/',
        'file.txt',
      ]);
    });

    it('should perform a case-insensitive search by lowercasing the pattern', async () => {
      testRootDir = await createTmpDir({ 'cRaZycAsE.txt': '' });

      const fileSearch = FileSearchFactory.create({
        projectRoot: testRootDir,
        ignoreDirs: [],
        useGitignore: false,
        useGeminiignore: false,
        cache: false,
        enableRecursiveFileSearch: true,
        enableFuzzySearch: true,
      });
      await fileSearch.initialize();

      vi.spyOn(FileSearchFactory, 'create').mockReturnValue(fileSearch);

      const { result } = renderHook(() =>
        useTestHarnessForAtCompletion(
          true,
          'CrAzYCaSe',
          mockConfig,
          testRootDir,
        ),
      );

      // The hook should find 'cRaZycAsE.txt' even though the pattern is 'CrAzYCaSe'.
      await waitFor(() => {
        expect(result.current.suggestions.map((s) => s.value)).toStrictEqual([
          'cRaZycAsE.txt',
        ]);
      });
    });
  });

  describe('UI State and Loading Behavior', () => {
    it('should be in a loading state during initial file system crawl', async () => {
      testRootDir = await createTmpDir({});
      const { result } = renderHook(() =>
        useTestHarnessForAtCompletion(true, '', mockConfig, testRootDir),
      );

      // It's initially true because the effect runs synchronously.
      expect(result.current.isLoadingSuggestions).toBe(true);

      // Wait for the loading to complete.
      await waitFor(() => {
        expect(result.current.isLoadingSuggestions).toBe(false);
      });
    });

    it('should NOT show a loading indicator for subsequent searches that complete under 200ms', async () => {
      const structure: FileSystemStructure = { 'a.txt': '', 'b.txt': '' };
      testRootDir = await createTmpDir(structure);

      const { result, rerender } = renderHook(
        ({ pattern }) =>
          useTestHarnessForAtCompletion(true, pattern, mockConfig, testRootDir),
        { initialProps: { pattern: 'a' } },
      );

      await waitFor(() => {
        expect(result.current.suggestions.map((s) => s.value)).toStrictEqual([
          'a.txt',
        ]);
      });
      expect(result.current.isLoadingSuggestions).toBe(false);

      rerender({ pattern: 'b' });

      // Wait for the final result
      await waitFor(() => {
        expect(result.current.suggestions.map((s) => s.value)).toStrictEqual([
          'b.txt',
        ]);
      });

      expect(result.current.isLoadingSuggestions).toBe(false);
    });

    it('should show a loading indicator and clear old suggestions for subsequent searches that take longer than 200ms', async () => {
      const structure: FileSystemStructure = { 'a.txt': '', 'b.txt': '' };
      testRootDir = await createTmpDir(structure);

      const realFileSearch = FileSearchFactory.create({
        projectRoot: testRootDir,
        ignoreDirs: [],
        useGitignore: true,
        useGeminiignore: true,
        cache: false,
        cacheTtl: 0,
        enableRecursiveFileSearch: true,
        enableFuzzySearch: true,
      });
      await realFileSearch.initialize();

      // Mock that returns results immediately but we'll control timing with fake timers
      const mockFileSearch: FileSearch = {
        initialize: vi.fn().mockResolvedValue(undefined),
        search: vi
          .fn()
          .mockImplementation(async (...args) =>
            realFileSearch.search(...args),
          ),
      };
      vi.spyOn(FileSearchFactory, 'create').mockReturnValue(mockFileSearch);

      const { result, rerender } = renderHook(
        ({ pattern }) =>
          useTestHarnessForAtCompletion(true, pattern, mockConfig, testRootDir),
        { initialProps: { pattern: 'a' } },
      );

      // Wait for the initial search to complete (using real timers)
      await waitFor(() => {
        expect(result.current.suggestions.map((s) => s.value)).toStrictEqual([
          'a.txt',
        ]);
      });

      // Now switch to fake timers for precise control of the loading behavior
      vi.useFakeTimers();

      // Trigger the second search
      act(() => {
        rerender({ pattern: 'b' });
      });

      // Initially, loading should be false (before 200ms timer)
      expect(result.current.isLoadingSuggestions).toBe(false);

      // Advance time by exactly 200ms to trigger the loading state
      act(() => {
        vi.advanceTimersByTime(200);
      });

      // Now loading should be true and suggestions should be cleared
      expect(result.current.isLoadingSuggestions).toBe(true);
      expect(result.current.suggestions).toStrictEqual([]);

      // Switch back to real timers for the final waitFor
      vi.useRealTimers();

      // Wait for the search results to be processed
      await waitFor(() => {
        expect(result.current.suggestions.map((s) => s.value)).toStrictEqual([
          'b.txt',
        ]);
      });

      expect(result.current.isLoadingSuggestions).toBe(false);
    });

    it('should abort the previous search when a new one starts', async () => {
      const structure: FileSystemStructure = { 'a.txt': '', 'b.txt': '' };
      testRootDir = await createTmpDir(structure);

      const abortSpy = vi.spyOn(AbortController.prototype, 'abort');
      const mockFileSearch: FileSearch = {
        initialize: vi.fn().mockResolvedValue(undefined),
        search: vi.fn().mockImplementation(async (pattern: string) => {
          const delay = pattern === 'a' ? 500 : 50;
          await new Promise((resolve) => setTimeout(resolve, delay));
          return [pattern];
        }),
      };
      vi.spyOn(FileSearchFactory, 'create').mockReturnValue(mockFileSearch);

      const { result, rerender } = renderHook(
        ({ pattern }) =>
          useTestHarnessForAtCompletion(true, pattern, mockConfig, testRootDir),
        { initialProps: { pattern: 'a' } },
      );

      // Wait for the hook to be ready (initialization is complete)
      await waitFor(() => {
        expect(mockFileSearch.search).toHaveBeenCalledWith(
          'a',
          expect.any(Object),
        );
      });

      // Now that the first search is in-flight, trigger the second one.
      act(() => {
        rerender({ pattern: 'b' });
      });

      // The abort should have been called for the first search.
      expect(abortSpy).toHaveBeenCalledTimes(1);

      // Wait for the final result, which should be from the second, faster search.
      await waitFor(
        () => {
          expect(result.current.suggestions.map((s) => s.value)).toStrictEqual([
            'b',
          ]);
        },
        { timeout: 1000 },
      );

      // The search spy should have been called for both patterns.
      expect(mockFileSearch.search).toHaveBeenCalledWith(
        'b',
        expect.any(Object),
      );
    });
  });

  describe('State Management', () => {
    it('should reset the state when disabled after being in a READY state', async () => {
      const structure: FileSystemStructure = { 'a.txt': '' };
      testRootDir = await createTmpDir(structure);

      const { result, rerender } = renderHook(
        ({ enabled }) =>
          useTestHarnessForAtCompletion(enabled, 'a', mockConfig, testRootDir),
        { initialProps: { enabled: true } },
      );

      // Wait for the hook to be ready and have suggestions
      await waitFor(() => {
        expect(result.current.suggestions.map((s) => s.value)).toStrictEqual([
          'a.txt',
        ]);
      });

      // Now, disable the hook
      rerender({ enabled: false });

      // The suggestions should be cleared immediately because of the RESET action
      expect(result.current.suggestions).toStrictEqual([]);
    });

    it('should reset the state when disabled after being in an ERROR state', async () => {
      testRootDir = await createTmpDir({});

      // Force an error during initialization
      const mockFileSearch: FileSearch = {
        initialize: vi
          .fn()
          .mockRejectedValue(new Error('Initialization failed')),
        search: vi.fn(),
      };
      vi.spyOn(FileSearchFactory, 'create').mockReturnValue(mockFileSearch);

      const { result, rerender } = renderHook(
        ({ enabled }) =>
          useTestHarnessForAtCompletion(enabled, '', mockConfig, testRootDir),
        { initialProps: { enabled: true } },
      );

      // Wait for the hook to enter the error state
      await waitFor(() => {
        expect(result.current.isLoadingSuggestions).toBe(false);
      });
      expect(result.current.suggestions).toStrictEqual([]); // No suggestions on error

      // Now, disable the hook
      rerender({ enabled: false });

      // The state should still be reset (though visually it's the same)
      // We can't directly inspect the internal state, but we can ensure it doesn't crash
      // and the suggestions remain empty.
      expect(result.current.suggestions).toStrictEqual([]);
    });
  });

  describe('Filtering and Configuration', () => {
    it('should respect .gitignore files', async () => {
      const gitignoreContent = ['dist/', '*.log'].join('\n');
      const structure: FileSystemStructure = {
        '.git': {},
        '.gitignore': gitignoreContent,
        dist: {},
        'test.log': '',
        src: {},
      };
      testRootDir = await createTmpDir(structure);

      const { result } = renderHook(() =>
        useTestHarnessForAtCompletion(true, '', mockConfig, testRootDir),
      );

      await waitFor(() => {
        expect(result.current.suggestions.length).toBeGreaterThan(0);
      });

      expect(result.current.suggestions.map((s) => s.value)).toStrictEqual([
        'src/',
        '.gitignore',
      ]);
    });

    it('should work correctly when config is undefined', async () => {
      const structure: FileSystemStructure = {
        node_modules: {},
        src: {},
      };
      testRootDir = await createTmpDir(structure);

      const { result } = renderHook(() =>
        useTestHarnessForAtCompletion(true, '', undefined, testRootDir),
      );

      await waitFor(() => {
        expect(result.current.suggestions.length).toBeGreaterThan(0);
      });

      expect(result.current.suggestions.map((s) => s.value)).toStrictEqual([
        'node_modules/',
        'src/',
      ]);
    });

    it('should reset and re-initialize when the cwd changes', async () => {
      const structure1: FileSystemStructure = { 'file1.txt': '' };
      const rootDir1 = await createTmpDir(structure1);
      const structure2: FileSystemStructure = { 'file2.txt': '' };
      const rootDir2 = await createTmpDir(structure2);

      const { result, rerender } = renderHook(
        ({ cwd, pattern }) =>
          useTestHarnessForAtCompletion(true, pattern, mockConfig, cwd),
        {
          initialProps: {
            cwd: rootDir1,
            pattern: 'file',
          },
        },
      );

      // Wait for initial suggestions from the first directory
      await waitFor(() => {
        expect(result.current.suggestions.map((s) => s.value)).toStrictEqual([
          'file1.txt',
        ]);
      });

      // Change the CWD
      act(() => {
        rerender({ cwd: rootDir2, pattern: 'file' });
      });

      // After CWD changes, suggestions should be cleared and it should load again.
      await waitFor(() => {
        expect(result.current.isLoadingSuggestions).toBe(true);
        expect(result.current.suggestions).toStrictEqual([]);
      });

      // Wait for the new suggestions from the second directory
      await waitFor(() => {
        expect(result.current.suggestions.map((s) => s.value)).toStrictEqual([
          'file2.txt',
        ]);
      });
      expect(result.current.isLoadingSuggestions).toBe(false);

      await cleanupTmpDir(rootDir1);
      await cleanupTmpDir(rootDir2);
    });

    it('should perform a non-recursive search when enableRecursiveFileSearch is false', async () => {
      const structure: FileSystemStructure = {
        'file.txt': '',
        src: {
          'index.js': '',
        },
      };
      testRootDir = await createTmpDir(structure);

      const nonRecursiveConfig = {
        getEnableRecursiveFileSearch: () => false,
        getFileFilteringOptions: vi.fn(() => ({
          respectGitIgnore: true,
          respectGeminiIgnore: true,
        })),
        getFileFilteringDisableFuzzySearch: () => false,
      } as unknown as Config;

      const { result } = renderHook(() =>
        useTestHarnessForAtCompletion(
          true,
          '',
          nonRecursiveConfig,
          testRootDir,
        ),
      );

      await waitFor(() => {
        expect(result.current.suggestions.length).toBeGreaterThan(0);
      });

      // Should only contain top-level items
      expect(result.current.suggestions.map((s) => s.value)).toStrictEqual([
        'src/',
        'file.txt',
      ]);
    });
  });

  it('should include MCP resource suggestions with serverName:uri format', async () => {
    testRootDir = await createTmpDir({});

    const resourceConfig = {
      ...mockConfig,
      getResourceRegistry: () => ({
        getAllResources: () => [
          {
            serverName: 'docs',
            uri: 'file:///docs/readme.md',
            name: 'README',
            discoveredAt: Date.now(),
          },
        ],
      }),
    } as unknown as Config;

    const { result } = renderHook(() =>
      useTestHarnessForAtCompletion(true, 'docs', resourceConfig, testRootDir),
    );

    await waitFor(() => {
      expect(
        result.current.suggestions.some(
          (s) => s.value === 'docs:file:///docs/readme.md',
        ),
      ).toBe(true);
    });
  });

  describe('Subagent Suggestions', () => {
    it('should include subagent names in suggestions when SubagentManager is available', async () => {
      testRootDir = await createTmpDir({});

      const subagentConfig = {
        ...mockConfig,
        getSubagentManager: () => ({
          listSubagents: () =>
            Promise.resolve([
              'codeanalyzer',
              'deepthinker',
              'typescriptexpert',
            ]),
        }),
      } as unknown as Config;

      const { result } = renderHook(() =>
        useTestHarnessForAtCompletion(true, '', subagentConfig, testRootDir),
      );

      await waitFor(() => {
        expect(result.current.suggestions.length).toBeGreaterThan(0);
      });

      const subagentSuggestions = result.current.suggestions.filter(
        (s) => s.description === 'subagent',
      );
      expect(subagentSuggestions.length).toBe(3);
      expect(subagentSuggestions.map((s) => s.value)).toStrictEqual(
        expect.arrayContaining([
          'codeanalyzer',
          'deepthinker',
          'typescriptexpert',
        ]),
      );
    });

    it('should filter subagent suggestions by pattern', async () => {
      testRootDir = await createTmpDir({});

      const subagentConfig = {
        ...mockConfig,
        getSubagentManager: () => ({
          listSubagents: () =>
            Promise.resolve([
              'codeanalyzer',
              'deepthinker',
              'typescriptexpert',
            ]),
        }),
      } as unknown as Config;

      const { result } = renderHook(() =>
        useTestHarnessForAtCompletion(
          true,
          'deep',
          subagentConfig,
          testRootDir,
        ),
      );

      await waitFor(() => {
        expect(result.current.suggestions.length).toBeGreaterThan(0);
      });

      const subagentSuggestions = result.current.suggestions.filter(
        (s) => s.description === 'subagent',
      );
      expect(subagentSuggestions.length).toBe(1);
      expect(subagentSuggestions[0].value).toBe('deepthinker');
    });

    it('should show subagent suggestions after file suggestions', async () => {
      const structure: FileSystemStructure = {
        'deep-file.txt': '',
      };
      testRootDir = await createTmpDir(structure);

      const subagentConfig = {
        ...mockConfig,
        getSubagentManager: () => ({
          listSubagents: () => Promise.resolve(['deepthinker']),
        }),
      } as unknown as Config;

      const { result } = renderHook(() =>
        useTestHarnessForAtCompletion(
          true,
          'deep',
          subagentConfig,
          testRootDir,
        ),
      );

      await waitFor(() => {
        expect(result.current.suggestions.length).toBeGreaterThan(0);
      });

      // File suggestions should appear before subagent suggestions
      const fileSuggestionIndex = result.current.suggestions.findIndex(
        (s) => s.value === 'deep-file.txt',
      );
      const subagentSuggestionIndex = result.current.suggestions.findIndex(
        (s) => s.value === 'deepthinker',
      );

      expect(fileSuggestionIndex).toBeGreaterThanOrEqual(0);
      expect(subagentSuggestionIndex).toBeGreaterThan(fileSuggestionIndex);
    });

    it('should not show subagent suggestions when SubagentManager is unavailable', async () => {
      testRootDir = await createTmpDir({});

      const { result } = renderHook(() =>
        useTestHarnessForAtCompletion(true, '', mockConfig, testRootDir),
      );

      await waitFor(() => {
        expect(result.current.suggestions.length).toBeGreaterThanOrEqual(0);
      });

      const subagentSuggestions = result.current.suggestions.filter(
        (s) => s.description === 'subagent',
      );
      expect(subagentSuggestions.length).toBe(0);
    });

    it('should handle gracefully when listSubagents() rejects', async () => {
      testRootDir = await createTmpDir({ 'file.txt': '' });

      const failingSubagentConfig = {
        ...mockConfig,
        getSubagentManager: () => ({
          listSubagents: () => Promise.reject(new Error('Failed to list')),
        }),
      } as unknown as Config;

      const { result } = renderHook(() =>
        useTestHarnessForAtCompletion(
          true,
          '',
          failingSubagentConfig,
          testRootDir,
        ),
      );

      await waitFor(() => {
        expect(result.current.suggestions.length).toBeGreaterThan(0);
      });

      // File suggestions should still work
      expect(
        result.current.suggestions.some((s) => s.value === 'file.txt'),
      ).toBe(true);

      // No subagent suggestions due to error
      const subagentSuggestions = result.current.suggestions.filter(
        (s) => s.description === 'subagent',
      );
      expect(subagentSuggestions.length).toBe(0);
    });
  });
});
