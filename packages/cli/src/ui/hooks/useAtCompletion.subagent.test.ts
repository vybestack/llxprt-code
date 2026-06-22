/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { act } from 'react';
import { renderHook, waitFor } from '../../test-utils/render.js';
import type { Config, FileSearch } from '@vybestack/llxprt-code-core';
import {
  FileSearchFactory,
  DEFAULT_AUTOCOMPLETE_IGNORE_DIRS,
  DEFAULT_AUTOCOMPLETE_IGNORE_PATTERNS,
  DEFAULT_AUTOCOMPLETE_MAX_DEPTH,
} from '@vybestack/llxprt-code-core';
import type { FileSystemStructure } from '@vybestack/llxprt-code-test-utils';
import { createTmpDir, cleanupTmpDir } from '@vybestack/llxprt-code-test-utils';
import { useTestHarnessForAtCompletion } from './useAtCompletion-test-helpers.js';

describe('useAtCompletion (subagent/filtering/debounce)', () => {
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

  describe('Default Autocomplete Filtering', () => {
    it('should pass DEFAULT_AUTOCOMPLETE_IGNORE_DIRS to FileSearchFactory', async () => {
      testRootDir = await createTmpDir({ 'file.txt': '' });

      const createSpy = vi.spyOn(FileSearchFactory, 'create');

      renderHook(() =>
        useTestHarnessForAtCompletion(true, '', mockConfig, testRootDir),
      );

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          ignoreDirs: DEFAULT_AUTOCOMPLETE_IGNORE_DIRS,
        }),
      );
    });

    it('should pass DEFAULT_AUTOCOMPLETE_IGNORE_PATTERNS to FileSearchFactory', async () => {
      testRootDir = await createTmpDir({ 'file.txt': '' });

      const createSpy = vi.spyOn(FileSearchFactory, 'create');

      renderHook(() =>
        useTestHarnessForAtCompletion(true, '', mockConfig, testRootDir),
      );

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          ignorePatterns: DEFAULT_AUTOCOMPLETE_IGNORE_PATTERNS,
        }),
      );
    });

    it('should pass DEFAULT_AUTOCOMPLETE_MAX_DEPTH to FileSearchFactory', async () => {
      testRootDir = await createTmpDir({ 'file.txt': '' });

      const createSpy = vi.spyOn(FileSearchFactory, 'create');

      renderHook(() =>
        useTestHarnessForAtCompletion(true, '', mockConfig, testRootDir),
      );

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          maxDepth: DEFAULT_AUTOCOMPLETE_MAX_DEPTH,
        }),
      );
    });

    it('should exclude build output directories from autocomplete results', async () => {
      const structure: FileSystemStructure = {
        src: { 'main.rs': '' },
        target: { debug: { 'main.o': '', 'main.rlib': '' } },
        build: { 'app.o': '' },
        dist: { 'bundle.js': '' },
      };
      testRootDir = await createTmpDir(structure);

      const { result } = renderHook(() =>
        useTestHarnessForAtCompletion(true, '', mockConfig, testRootDir),
      );

      await waitFor(() => {
        expect(result.current.suggestions.length).toBeGreaterThan(0);
      });

      const values = result.current.suggestions.map((s) => s.value);
      expect(values).not.toContain('target/');
      expect(values).not.toContain('target/debug/');
      expect(values).not.toContain('build/');
      expect(values).not.toContain('dist/');
      expect(values).toContain('src/');
      expect(values).toContain('src/main.rs');
    });

    it('should exclude binary artifact files from autocomplete results', async () => {
      const structure: FileSystemStructure = {
        src: { 'main.rs': '' },
        'main.o': '',
        'app.dll': '',
        'program.exe': '',
      };
      testRootDir = await createTmpDir(structure);

      const { result } = renderHook(() =>
        useTestHarnessForAtCompletion(true, '', mockConfig, testRootDir),
      );

      await waitFor(() => {
        expect(result.current.suggestions.length).toBeGreaterThan(0);
      });

      const values = result.current.suggestions.map((s) => s.value);
      expect(values).not.toContain('main.o');
      expect(values).not.toContain('app.dll');
      expect(values).not.toContain('program.exe');
      expect(values).toContain('src/');
    });
  });

  describe('Debounce Behavior', () => {
    it('should not search for rapid pattern changes within the debounce window', async () => {
      testRootDir = await createTmpDir({});
      const searchSpy = vi.fn().mockResolvedValue(['abc.txt']);
      const mockFileSearch: FileSearch = {
        initialize: vi.fn().mockResolvedValue(undefined),
        search: searchSpy,
      };
      vi.spyOn(FileSearchFactory, 'create').mockReturnValue(mockFileSearch);

      const { result, rerender } = renderHook(
        ({ pattern }: { pattern: string }) =>
          useTestHarnessForAtCompletion(true, pattern, mockConfig, testRootDir),
        { initialProps: { pattern: '' } },
      );

      await waitFor(() => {
        expect(searchSpy).toHaveBeenCalledWith('', expect.any(Object));
      });
      searchSpy.mockClear();

      vi.useFakeTimers();

      act(() => {
        rerender({ pattern: 'a' });
        rerender({ pattern: 'ab' });
        vi.advanceTimersByTime(40);
        rerender({ pattern: 'abc' });
        vi.advanceTimersByTime(150);
      });

      await act(async () => {
        await vi.runOnlyPendingTimersAsync();
      });
      vi.useRealTimers();

      await waitFor(() => {
        expect(result.current.suggestions.map((s) => s.value)).toStrictEqual([
          'abc.txt',
        ]);
      });

      expect(searchSpy).not.toHaveBeenCalledWith('a', expect.any(Object));
      expect(searchSpy).not.toHaveBeenCalledWith('ab', expect.any(Object));
      expect(searchSpy).toHaveBeenCalledWith('abc', expect.any(Object));
    });

    it('should not publish stale results while the next pattern is debounced', async () => {
      testRootDir = await createTmpDir({});
      let resolveA = (_value: string[]): void => {
        throw new Error('Expected the a search promise to be initialized');
      };
      let resolveB = (_value: string[]): void => {
        throw new Error('Expected the b search promise to be initialized');
      };
      const aSearch = new Promise<string[]>((resolve) => {
        resolveA = resolve;
      });
      const bSearch = new Promise<string[]>((resolve) => {
        resolveB = resolve;
      });
      const searchSpy = vi.fn((searchPattern: string) => {
        if (searchPattern === 'a') {
          return aSearch;
        }
        if (searchPattern === 'b') {
          return bSearch;
        }
        return Promise.resolve([]);
      });
      const mockFileSearch: FileSearch = {
        initialize: vi.fn().mockResolvedValue(undefined),
        search: searchSpy,
      };
      vi.spyOn(FileSearchFactory, 'create').mockReturnValue(mockFileSearch);

      const { result, rerender } = renderHook(
        ({ pattern }: { pattern: string }) =>
          useTestHarnessForAtCompletion(true, pattern, mockConfig, testRootDir),
        { initialProps: { pattern: 'a' } },
      );

      await waitFor(() => {
        expect(searchSpy).toHaveBeenCalledWith('a', expect.any(Object));
      });

      vi.useFakeTimers();
      act(() => {
        rerender({ pattern: 'b' });
      });

      await act(async () => {
        resolveA(['a-stale.txt']);
        await Promise.resolve();
      });

      expect(result.current.suggestions.map((s) => s.value)).not.toContain(
        'a-stale.txt',
      );
      expect(searchSpy).not.toHaveBeenCalledWith('b', expect.any(Object));

      act(() => {
        vi.advanceTimersByTime(150);
      });
      expect(searchSpy).toHaveBeenCalledWith('b', expect.any(Object));

      await act(async () => {
        resolveB(['b-current.txt']);
        await Promise.resolve();
      });
      vi.useRealTimers();

      await waitFor(() => {
        expect(result.current.suggestions.map((s) => s.value)).toStrictEqual([
          'b-current.txt',
        ]);
      });
    });

    it('should not publish results after search timeout aborts during enrichment', async () => {
      vi.useFakeTimers();
      testRootDir = await createTmpDir({});
      let resolveSubagents = (_names: string[]): void => {
        throw new Error('Expected the subagent promise to be initialized');
      };
      const subagentPromise = new Promise<string[]>((resolve) => {
        resolveSubagents = resolve;
      });
      const mockFileSearch: FileSearch = {
        initialize: vi.fn().mockResolvedValue(undefined),
        search: vi.fn().mockResolvedValue(['file.txt']),
      };
      vi.spyOn(FileSearchFactory, 'create').mockReturnValue(mockFileSearch);

      const timeoutConfig = {
        ...mockConfig,
        getFileFilteringOptions: vi.fn(() => ({
          respectGitIgnore: true,
          respectLlxprtIgnore: true,
          searchTimeout: 1,
        })),
        getSubagentManager: () => ({
          listSubagents: () => subagentPromise,
        }),
      } as unknown as Config;

      const { result } = renderHook(() =>
        useTestHarnessForAtCompletion(true, '', timeoutConfig, testRootDir),
      );

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(mockFileSearch.search).toHaveBeenCalledWith(
        '',
        expect.any(Object),
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2);
        await Promise.resolve();
      });

      await act(async () => {
        resolveSubagents(['deepthinker']);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.suggestions).toStrictEqual([]);
      expect(result.current.isLoadingSuggestions).toBe(false);
    });

    it('should dispatch empty pattern immediately without debounce', async () => {
      const structure: FileSystemStructure = { 'a.txt': '' };
      testRootDir = await createTmpDir(structure);

      const { result } = renderHook(() =>
        useTestHarnessForAtCompletion(true, '', mockConfig, testRootDir),
      );

      await waitFor(() => {
        expect(result.current.suggestions.length).toBeGreaterThan(0);
      });

      expect(result.current.suggestions.map((s) => s.value)).toContain('a.txt');
    });
  });
});
