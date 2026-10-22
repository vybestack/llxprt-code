/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { installWorkspaceRuntimeHook } from '../../__tests__/workspace-runtime-fixture.js';

import { describe, it, expect, beforeEach, vi, afterEach } from 'bun:test';
import { renderHook, waitFor } from '../../__tests__/render.js';
import type { Config, FileSearch } from '@vybestack/llxprt-code-core';
import { FileSearchFactory } from '@vybestack/llxprt-code-core';
import { createTmpDir, cleanupTmpDir } from '@vybestack/llxprt-code-test-utils';
import { useTestHarnessForAtCompletion } from './__tests__/useAtCompletion-test-helpers.js';

/**
 * MCP resource candidates never touch the filesystem, so a slow or failing
 * file crawl/search must not hide them.
 */
describe('useAtCompletion resource candidates', () => {
  let testRootDir: string;
  const useFixtureRuntime = installWorkspaceRuntimeHook(
    () => testRootDir || process.cwd(),
  );
  let mockConfig: Config;

  beforeEach(() => {
    mockConfig = {
      getMcpServers: () => undefined,
      getFileFilteringOptions: vi.fn(() => ({
        respectGitIgnore: true,
        respectLlxprtIgnore: true,
      })),
      getEnableRecursiveFileSearch: () => true,
      getFileFilteringDisableFuzzySearch: () => false,
      listResources: () => [
        {
          serverName: 'physical',
          uri: 'fixture:///quantity',
          name: 'quantity',
          discoveredAt: Date.now(),
        },
      ],
      getSubagentManager: () => undefined,
    } as unknown as Config;
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await useFixtureRuntime.dispose();
    vi.useRealTimers();
    if (testRootDir) {
      await cleanupTmpDir(testRootDir);
    }
    vi.restoreAllMocks();
  });

  function renderCompletion() {
    return renderHook(() =>
      useTestHarnessForAtCompletion(
        true,
        'physical:fixture',
        useFixtureRuntime(mockConfig),
        testRootDir,
      ),
    );
  }

  it('keeps resources when the file crawl fails', async () => {
    testRootDir = await createTmpDir({ 'alpha.txt': '' });
    const failingSearcher: FileSearch = {
      initialize: vi.fn().mockRejectedValue(new Error('crawl failed')),
      search: vi.fn().mockResolvedValue([]),
    };
    vi.spyOn(FileSearchFactory, 'create').mockReturnValue(failingSearcher);

    const { result } = renderCompletion();

    await waitFor(() => {
      expect(result.current.isLoadingSuggestions).toBe(false);
      expect(result.current.suggestions.map((s) => s.value)).toStrictEqual([
        'physical:fixture:///quantity',
      ]);
    });
  });

  it('shows resources while the file crawl is still running', async () => {
    testRootDir = await createTmpDir({ 'alpha.txt': '' });
    let finishCrawl = (): void => {
      throw new Error('Expected the crawl promise to be initialized');
    };
    const crawl = new Promise<void>((resolve) => {
      finishCrawl = resolve;
    });
    const pendingSearcher: FileSearch = {
      initialize: vi.fn(() => crawl),
      search: vi.fn().mockResolvedValue([]),
    };
    vi.spyOn(FileSearchFactory, 'create').mockReturnValue(pendingSearcher);

    const { result } = renderCompletion();
    try {
      await waitFor(() => {
        expect(result.current.suggestions.map((s) => s.value)).toStrictEqual([
          'physical:fixture:///quantity',
        ]);
      });
      expect(result.current.isLoadingSuggestions).toBe(true);
    } finally {
      finishCrawl();
    }
  });

  it('keeps resources when the file search fails', async () => {
    testRootDir = await createTmpDir({ 'alpha.txt': '' });
    const failingSearch: FileSearch = {
      initialize: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockRejectedValue(new Error('search failed')),
    };
    vi.spyOn(FileSearchFactory, 'create').mockReturnValue(failingSearch);

    const { result } = renderCompletion();

    await waitFor(() => {
      expect(failingSearch.search).toHaveBeenCalled();
      expect(result.current.isLoadingSuggestions).toBe(false);
      expect(result.current.suggestions.map((s) => s.value)).toStrictEqual([
        'physical:fixture:///quantity',
      ]);
    });
  });
});
