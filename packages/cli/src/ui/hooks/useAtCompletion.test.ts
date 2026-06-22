/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '../../test-utils/render.js';
import { act } from 'react';
import type { Config, FileSearch } from '@vybestack/llxprt-code-core';
import { FileSearchFactory } from '@vybestack/llxprt-code-core';
import type { FileSystemStructure } from '@vybestack/llxprt-code-test-utils';
import { createTmpDir, cleanupTmpDir } from '@vybestack/llxprt-code-test-utils';
import { useTestHarnessForAtCompletion } from './useAtCompletion-test-helpers.js';

describe('useAtCompletion', () => {
  let testRootDir: string;
  let mockConfig: Config;

  beforeEach(() => {
    mockConfig = {
      getFileFilteringOptions: vi.fn(() => ({
        respectGitIgnore: true,
        respectLlxprtIgnore: true,
      })),
      getEnableRecursiveFileSearch: () => true,
      getFileFilteringDisableFuzzySearch: () => false,
    } as unknown as Config;
    vi.clearAllMocks();
  });

  afterEach(async () => {
    vi.useRealTimers();

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

      await waitFor(() => {
        expect(result.current.suggestions.map((s) => s.value)).toStrictEqual([
          'a.txt',
        ]);
      });

      vi.useFakeTimers();

      act(() => {
        rerender({ pattern: 'b' });
        vi.advanceTimersByTime(150);
      });

      expect(result.current.isLoadingSuggestions).toBe(false);

      act(() => {
        vi.advanceTimersByTime(200);
      });

      expect(result.current.isLoadingSuggestions).toBe(true);
      expect(result.current.suggestions).toStrictEqual([]);

      vi.useRealTimers();
    });

    it('should abort the previous search when a new one starts', async () => {
      testRootDir = await createTmpDir({});

      const abortSpy = vi.spyOn(AbortController.prototype, 'abort');
      const mockFileSearch: FileSearch = {
        initialize: vi.fn().mockResolvedValue(undefined),
        search: vi.fn().mockImplementation((pattern: string) => {
          const delay = pattern === 'a' ? 500 : 50;
          return new Promise((resolve) => {
            setTimeout(() => resolve([pattern]), delay);
          });
        }),
      };
      vi.spyOn(FileSearchFactory, 'create').mockReturnValue(mockFileSearch);

      const { rerender } = renderHook(
        ({ pattern }) =>
          useTestHarnessForAtCompletion(true, pattern, mockConfig, testRootDir),
        { initialProps: { pattern: 'a' } },
      );

      await waitFor(() => {
        expect(mockFileSearch.search).toHaveBeenCalledWith(
          'a',
          expect.any(Object),
        );
      });

      vi.useFakeTimers();
      act(() => {
        rerender({ pattern: 'b' });
        vi.advanceTimersByTime(150);
      });

      expect(abortSpy).toHaveBeenCalled();
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

      await waitFor(() => {
        expect(result.current.suggestions.map((s) => s.value)).toStrictEqual([
          'a.txt',
        ]);
      });

      rerender({ enabled: false });

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

    it('should reset when disabled during initialization', async () => {
      testRootDir = await createTmpDir({});
      const mockFileSearch: FileSearch = {
        initialize: vi.fn(() => new Promise<void>(() => undefined)),
        search: vi.fn(),
      };
      vi.spyOn(FileSearchFactory, 'create').mockReturnValue(mockFileSearch);

      const { result, rerender } = renderHook(
        ({ enabled }) =>
          useTestHarnessForAtCompletion(enabled, '', mockConfig, testRootDir),
        { initialProps: { enabled: true } },
      );

      expect(result.current.isLoadingSuggestions).toBe(true);

      rerender({ enabled: false });

      expect(result.current.isLoadingSuggestions).toBe(false);
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
          respectLlxprtIgnore: true,
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

    it('should respect llxprt ignore when git ignore is disabled', async () => {
      const structure: FileSystemStructure = {
        '.gitignore': '*.txt',
        '.llxprtignore': '*.log',
        'kept.txt': '',
        'ignored.log': '',
      };
      testRootDir = await createTmpDir(structure);

      const configWithGitIgnoreDisabled = {
        ...mockConfig,
        getFileFilteringOptions: vi.fn(() => ({
          respectGitIgnore: false,
          respectLlxprtIgnore: true,
        })),
      } as unknown as Config;

      const { result } = renderHook(() =>
        useTestHarnessForAtCompletion(
          true,
          '',
          configWithGitIgnoreDisabled,
          testRootDir,
        ),
      );

      await waitFor(() => {
        expect(result.current.suggestions.length).toBeGreaterThan(0);
      });

      const values = result.current.suggestions.map((s) => s.value);
      expect(values).toContain('kept.txt');
      expect(values).not.toContain('ignored.log');
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
});
