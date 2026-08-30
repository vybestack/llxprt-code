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
import { createTmpDir, cleanupTmpDir } from '@vybestack/llxprt-code-test-utils';
import { useTestHarnessForAtCompletion } from './useAtCompletion-test-helpers.js';

/**
 * Error-recovery behaviour for the at-completion hook (issue #3373).
 *
 * Split out of useAtCompletion.test.ts: #2019 and #3373 both grew that file
 * and together they pushed it past the 800-line max-lines budget. The setup
 * below mirrors the parent suite so the two files stay independent.
 */
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

      // The crawl is in flight, so the wait below cannot pass on the value the
      // hook started with; only the ERROR dispatch clears the loading flag
      // while leaving suggestions empty.
      expect(result.current.isLoadingSuggestions).toBe(true);
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

      expect(result.current.isLoadingSuggestions).toBe(true);
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
      expect(result.current.isLoadingSuggestions).toBe(true);
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

      expect(result.current.isLoadingSuggestions).toBe(true);
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
});
