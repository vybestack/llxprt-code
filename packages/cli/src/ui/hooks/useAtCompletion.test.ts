/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'bun:test';
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
      getResourceRegistry: () => ({ getAllResources: () => [] }),
      getSubagentManager: () => undefined,
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

      const values = result.current.suggestions.map((s) => s.value);
      // Exactly these entries match the pattern.
      expect([...values].sort()).toStrictEqual(
        [
          'src/',
          'src/components/',
          'src/index.js',
          'src/components/Button.tsx',
        ].sort(),
      );
      // Ranking that is actually specified: the directory itself first, and the
      // nested file last. `src/components/` and `src/index.js` are siblings
      // with equal scores, so their relative order comes from crawl order and
      // is not part of the contract.
      expect(values[0]).toBe('src/');
      expect(values[values.length - 1]).toBe('src/components/Button.tsx');
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
        useExtensionIgnore: false,
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
        useExtensionIgnore: true,
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

    it('recovers from an initialization error when the completion root changes', async (): Promise<void> => {
      testRootDir = await createTmpDir({ 'recovered result.txt': '' });
      const unavailableRoot = `${testRootDir}/unavailable`;
      const failingFileSearch: FileSearch = {
        initialize: async (): Promise<void> => {
          throw new Error('File search unavailable');
        },
        search: async (): Promise<string[]> => [],
      };
      const recoveredFileSearch = FileSearchFactory.create({
        projectRoot: testRootDir,
        ignoreDirs: [],
        useGitignore: false,
        useExtensionIgnore: false,
        cache: false,
        enableRecursiveFileSearch: true,
        enableFuzzySearch: true,
      });
      vi.spyOn(FileSearchFactory, 'create')
        .mockReturnValueOnce(failingFileSearch)
        .mockReturnValue(recoveredFileSearch);

      const { result, rerender } = renderHook(
        ({ cwd }: { readonly cwd: string }) =>
          useTestHarnessForAtCompletion(true, 'recovered', mockConfig, cwd),
        { initialProps: { cwd: unavailableRoot } },
      );

      await waitFor((): void => {
        expect(result.current.isLoadingSuggestions).toBe(false);
        expect(result.current.suggestions).toStrictEqual([]);
      });

      rerender({ cwd: testRootDir });

      await waitFor((): void => {
        expect(
          result.current.suggestions.map((item) => item.value),
        ).toStrictEqual(['recovered\\ result.txt']);
      });
      expect(result.current.isLoadingSuggestions).toBe(false);
    });
  });

  describe('ERROR recovery', () => {
    it('re-initializes and searches when a failed crawl retries on a pattern change (AC1)', async () => {
      testRootDir = await createTmpDir({ 'alpha.txt': '' });

      const realFileSearch = FileSearchFactory.create({
        projectRoot: testRootDir,
        ignoreDirs: [],
        useGitignore: true,
        useExtensionIgnore: true,
        cache: false,
        cacheTtl: 0,
        enableRecursiveFileSearch: true,
        enableFuzzySearch: true,
      });
      await realFileSearch.initialize();

      const failingSearcher: FileSearch = {
        initialize: vi.fn().mockRejectedValue(new Error('crawl failed')),
        search: vi.fn().mockResolvedValue([]),
      };

      let createCall = 0;
      vi.spyOn(FileSearchFactory, 'create').mockImplementation(() => {
        createCall += 1;
        return createCall === 1 ? failingSearcher : realFileSearch;
      });

      const { result, rerender } = renderHook(
        ({ pattern }: { pattern: string }) =>
          useTestHarnessForAtCompletion(true, pattern, mockConfig, testRootDir),
        { initialProps: { pattern: 'alp' } },
      );

      // The first crawl fails; the hook settles in ERROR.
      await waitFor(() => {
        expect(result.current.isLoadingSuggestions).toBe(false);
        expect(result.current.suggestions).toStrictEqual([]);
      });

      // A new pattern re-initializes against the same cwd and searches.
      rerender({ pattern: 'alph' });

      await waitFor(() => {
        expect(result.current.suggestions.map((s) => s.value)).toStrictEqual([
          'alpha.txt',
        ]);
      });
      expect(result.current.isLoadingSuggestions).toBe(false);
    });

    it('re-searches when a failed search retries on a pattern change (AC2)', async () => {
      testRootDir = await createTmpDir({ 'alpha.txt': '', 'beta.txt': '' });

      const realFileSearch = FileSearchFactory.create({
        projectRoot: testRootDir,
        ignoreDirs: [],
        useGitignore: true,
        useExtensionIgnore: true,
        cache: false,
        cacheTtl: 0,
        enableRecursiveFileSearch: true,
        enableFuzzySearch: true,
      });
      await realFileSearch.initialize();

      let rejectAlpSearch = (_error: Error): void => {
        throw new Error('Expected the alp search promise to be initialized');
      };
      const alpSearch = new Promise<string[]>((_resolve, reject) => {
        rejectAlpSearch = reject;
      });
      const stubFileSearch: FileSearch = {
        initialize: vi.fn().mockResolvedValue(undefined),
        search: vi.fn((searchPattern: string, options) => {
          if (searchPattern === 'alp') {
            return alpSearch;
          }
          return realFileSearch.search(searchPattern, options);
        }),
      };
      vi.spyOn(FileSearchFactory, 'create').mockReturnValue(stubFileSearch);

      const { result, rerender } = renderHook(
        ({ pattern }: { pattern: string }) =>
          useTestHarnessForAtCompletion(true, pattern, mockConfig, testRootDir),
        { initialProps: { pattern: 'alp' } },
      );

      // Drive the initial search to failure and let it settle in ERROR.
      await waitFor(() => {
        expect(stubFileSearch.search).toHaveBeenCalledWith(
          'alp',
          expect.any(Object),
        );
      });
      await act(async () => {
        rejectAlpSearch(new Error('search failed'));
        await Promise.resolve();
      });
      expect(result.current.isLoadingSuggestions).toBe(false);
      expect(result.current.suggestions).toStrictEqual([]);

      rerender({ pattern: 'bet' });

      await waitFor(() => {
        expect(result.current.suggestions.map((s) => s.value)).toStrictEqual([
          'beta.txt',
        ]);
      });
      expect(result.current.isLoadingSuggestions).toBe(false);
      // Exactly the two searches the user asked for: the retry must not replay
      // the pattern that already failed.
      expect(stubFileSearch.search).toHaveBeenCalledTimes(2);
    });

    it('still retries when a case-only edit cancels the pending retry (AC1)', async () => {
      testRootDir = await createTmpDir({ 'alpha.txt': '' });

      const realFileSearch = FileSearchFactory.create({
        projectRoot: testRootDir,
        ignoreDirs: [],
        useGitignore: true,
        useExtensionIgnore: true,
        cache: false,
        cacheTtl: 0,
        enableRecursiveFileSearch: true,
        enableFuzzySearch: true,
      });
      await realFileSearch.initialize();

      const failingSearcher: FileSearch = {
        initialize: vi.fn().mockRejectedValue(new Error('crawl failed')),
        search: vi.fn().mockResolvedValue([]),
      };

      let createCall = 0;
      vi.spyOn(FileSearchFactory, 'create').mockImplementation(() => {
        createCall += 1;
        return createCall === 1 ? failingSearcher : realFileSearch;
      });

      const { result, rerender } = renderHook(
        ({ pattern }: { pattern: string }) =>
          useTestHarnessForAtCompletion(true, pattern, mockConfig, testRootDir),
        { initialProps: { pattern: 'alp' } },
      );

      await waitFor(() => {
        expect(result.current.isLoadingSuggestions).toBe(false);
        expect(result.current.suggestions).toStrictEqual([]);
      });

      // The second edit lands inside the retry debounce and normalizes to the
      // same pattern, so it cancels the pending retry. Recovery must still
      // happen: that retry was never actually made.
      rerender({ pattern: 'alph' });
      rerender({ pattern: 'ALPH' });

      await waitFor(() => {
        expect(result.current.suggestions.map((s) => s.value)).toStrictEqual([
          'alpha.txt',
        ]);
      });
      expect(result.current.isLoadingSuggestions).toBe(false);
    });

    it('retries at most once per distinct normalized pattern (AC3)', async () => {
      testRootDir = await createTmpDir({});

      const failingSearcher: FileSearch = {
        initialize: vi.fn().mockRejectedValue(new Error('crawl failed')),
        search: vi.fn().mockResolvedValue([]),
      };
      const createSpy = vi
        .spyOn(FileSearchFactory, 'create')
        .mockReturnValue(failingSearcher);

      const { result, rerender } = renderHook(
        ({ pattern }: { pattern: string }) =>
          useTestHarnessForAtCompletion(true, pattern, mockConfig, testRootDir),
        { initialProps: { pattern: 'alp' } },
      );

      // The crawl fails; the hook settles in ERROR.
      await waitFor(() => {
        expect(result.current.isLoadingSuggestions).toBe(false);
        expect(result.current.suggestions).toStrictEqual([]);
      });

      expect(createSpy).toHaveBeenCalledTimes(1);

      // Same pattern and a case-variant of it normalize to the same value, so
      // no retry is scheduled. Drive the clock well past the 150ms retry
      // debounce to prove nothing fires late.
      vi.useFakeTimers();
      act(() => {
        rerender({ pattern: 'alp' });
        rerender({ pattern: 'ALP' });
        vi.advanceTimersByTime(1000);
      });

      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(result.current.isLoadingSuggestions).toBe(false);
      expect(result.current.suggestions).toStrictEqual([]);

      vi.useRealTimers();
    });

    it('does not loop when a retry fails again (AC4)', async () => {
      testRootDir = await createTmpDir({});

      const failingSearcher: FileSearch = {
        initialize: vi.fn().mockRejectedValue(new Error('crawl failed')),
        search: vi.fn().mockResolvedValue([]),
      };
      const createSpy = vi
        .spyOn(FileSearchFactory, 'create')
        .mockReturnValue(failingSearcher);

      const { result, rerender } = renderHook(
        ({ pattern }: { pattern: string }) =>
          useTestHarnessForAtCompletion(true, pattern, mockConfig, testRootDir),
        { initialProps: { pattern: 'alp' } },
      );

      await waitFor(() => {
        expect(result.current.isLoadingSuggestions).toBe(false);
        expect(result.current.suggestions).toStrictEqual([]);
      });

      // One retry fires on the new pattern... wait for it to actually attempt
      // (the retry is debounced, and ERROR already looks "settled").
      rerender({ pattern: 'alph' });
      await waitFor(() => {
        expect(createSpy).toHaveBeenCalledTimes(2);
      });

      // ...fails again, and settles in ERROR without spinning.
      await waitFor(() => {
        expect(result.current.isLoadingSuggestions).toBe(false);
        expect(result.current.suggestions).toStrictEqual([]);
      });

      // The failed retry recorded 'alph', so the unchanged pattern schedules
      // nothing more even once the retry debounce window has long passed.
      vi.useFakeTimers();
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(createSpy).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('keeps recovering when the retry runs its own failing search (AC2/AC3)', async () => {
      testRootDir = await createTmpDir({ 'alphabet.txt': '' });

      const realFileSearch = FileSearchFactory.create({
        projectRoot: testRootDir,
        ignoreDirs: [],
        useGitignore: true,
        useExtensionIgnore: true,
        cache: false,
        cacheTtl: 0,
        enableRecursiveFileSearch: true,
        enableFuzzySearch: true,
      });
      await realFileSearch.initialize();

      // Every search fails until the user has typed 'alphab'.
      const stubFileSearch: FileSearch = {
        initialize: vi.fn().mockResolvedValue(undefined),
        search: vi.fn((searchPattern: string, options) => {
          if (searchPattern !== 'alphab') {
            return Promise.reject(new Error('search failed'));
          }
          return realFileSearch.search(searchPattern, options);
        }),
      };
      vi.spyOn(FileSearchFactory, 'create').mockReturnValue(stubFileSearch);

      const { result, rerender } = renderHook(
        ({ pattern }: { pattern: string }) =>
          useTestHarnessForAtCompletion(true, pattern, mockConfig, testRootDir),
        { initialProps: { pattern: 'alp' } },
      );

      await waitFor(() => {
        expect(stubFileSearch.search).toHaveBeenCalledWith(
          'alp',
          expect.any(Object),
        );
      });

      // The retry for 'alpha' runs a search that fails too, so the hook lands
      // back in ERROR rather than getting stuck against the first failure.
      rerender({ pattern: 'alpha' });
      await waitFor(() => {
        expect(stubFileSearch.search).toHaveBeenCalledWith(
          'alpha',
          expect.any(Object),
        );
      });

      // A third pattern still recovers, which it could not do if a failing
      // retry stranded the hook.
      rerender({ pattern: 'alphab' });
      await waitFor(() => {
        expect(result.current.suggestions.map((s) => s.value)).toStrictEqual([
          'alphabet.txt',
        ]);
      });
      expect(result.current.isLoadingSuggestions).toBe(false);
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
        getResourceRegistry: () => ({ getAllResources: () => [] }),
        getSubagentManager: () => undefined,
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
