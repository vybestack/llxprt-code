/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { renderHook } from '../../../../test-utils/render.js';
import { MessageType } from '../../../types.js';
import { useMemoryRefreshAction } from './useMemoryRefreshAction.js';
import { loadHierarchicalLlxprtMemory } from '../../../../config/environmentLoader.js';

vi.mock('../../../../config/environmentLoader.js', () => ({
  loadHierarchicalLlxprtMemory: vi.fn(),
}));

describe('useMemoryRefreshAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses config.refreshMemory in jit mode instead of loadHierarchicalLlxprtMemory', async () => {
    const refreshMemoryResult = {
      memoryContent: 'jit memory',
      fileCount: 2,
      filePaths: ['/tmp/.llxprt/LLXPRT.md', '/tmp/sub/LLXPRT.md'],
    };

    const config = {
      isJitContextEnabled: vi.fn(() => true),
      refreshMemory: vi.fn().mockResolvedValue(refreshMemoryResult),
      setUserMemory: vi.fn(),
      setLlxprtMdFileCount: vi.fn(),
      setLlxprtMdFilePaths: vi.fn(),
      getDebugMode: vi.fn(() => false),
      getWorkingDir: vi.fn(() => '/tmp/workspace'),
      getWorkspaceContext: vi.fn(() => ({
        getDirectories: vi.fn(() => ['/tmp/workspace']),
      })),
      getFileService: vi.fn(),
      getExtensions: vi.fn(() => []),
      getFolderTrust: vi.fn(() => true),
      getFileFilteringOptions: vi.fn(() => ({
        respectGitIgnore: true,
        respectLlxprtIgnore: true,
      })),
    };

    const settings = {
      merged: {
        loadMemoryFromIncludeDirectories: false,
        ui: {
          memoryImportFormat: 'tree',
        },
      },
    };

    const addItem = vi.fn();
    const setLlxprtMdFileCount = vi.fn();

    const { result } = renderHook(() =>
      useMemoryRefreshAction({
        config: config as never,
        settings: settings as never,
        addItem,
        setLlxprtMdFileCount,
      }),
    );

    await act(async () => {
      await result.current();
    });

    expect(config.refreshMemory).toHaveBeenCalledTimes(1);
    expect(loadHierarchicalLlxprtMemory).not.toHaveBeenCalled();
    expect(config.setUserMemory).not.toHaveBeenCalled();
    expect(config.setLlxprtMdFileCount).not.toHaveBeenCalled();
    expect(config.setLlxprtMdFilePaths).not.toHaveBeenCalled();
    expect(setLlxprtMdFileCount).toHaveBeenCalledWith(2);

    expect(addItem).toHaveBeenCalledWith(
      {
        type: MessageType.INFO,
        text: 'Refreshing hierarchical memory (LLXPRT.md or other context files)...',
      },
      expect.any(Number),
    );

    expect(addItem).toHaveBeenCalledWith(
      {
        type: MessageType.INFO,
        text: 'Memory refreshed successfully. Loaded 10 characters from 2 file(s).',
      },
      expect.any(Number),
    );
  });

  it('uses loadHierarchicalLlxprtMemory and config setters when jit mode is disabled', async () => {
    vi.mocked(loadHierarchicalLlxprtMemory).mockResolvedValue({
      memoryContent: 'non-jit memory',
      fileCount: 3,
      filePaths: ['/tmp/a', '/tmp/b', '/tmp/c'],
    });

    const config = {
      isJitContextEnabled: vi.fn(() => false),
      refreshMemory: vi.fn(),
      setUserMemory: vi.fn(),
      setLlxprtMdFileCount: vi.fn(),
      setLlxprtMdFilePaths: vi.fn(),
      getDebugMode: vi.fn(() => false),
      getWorkingDir: vi.fn(() => '/tmp/workspace'),
      getWorkspaceContext: vi.fn(() => ({
        getDirectories: vi.fn(() => ['/tmp/workspace']),
      })),
      getFileService: vi.fn(() => 'file-service'),
      getExtensions: vi.fn(() => ['ext']),
      getFolderTrust: vi.fn(() => true),
      getFileFilteringOptions: vi.fn(() => ({
        respectGitIgnore: true,
        respectLlxprtIgnore: true,
      })),
    };

    const settings = {
      merged: {
        loadMemoryFromIncludeDirectories: false,
        ui: {
          memoryImportFormat: 'tree',
        },
      },
    };

    const addItem = vi.fn();
    const setLlxprtMdFileCount = vi.fn();

    const { result } = renderHook(() =>
      useMemoryRefreshAction({
        config: config as never,
        settings: settings as never,
        addItem,
        setLlxprtMdFileCount,
      }),
    );

    await act(async () => {
      await result.current();
    });

    expect(config.refreshMemory).not.toHaveBeenCalled();
    expect(loadHierarchicalLlxprtMemory).toHaveBeenCalledTimes(1);
    expect(config.setUserMemory).toHaveBeenCalledWith('non-jit memory');
    expect(config.setLlxprtMdFileCount).toHaveBeenCalledWith(3);
    expect(config.setLlxprtMdFilePaths).toHaveBeenCalledWith([
      '/tmp/a',
      '/tmp/b',
      '/tmp/c',
    ]);
    expect(setLlxprtMdFileCount).toHaveBeenCalledWith(3);

    expect(addItem).toHaveBeenCalledWith(
      {
        type: MessageType.INFO,
        text: 'Memory refreshed successfully. Loaded 14 characters from 3 file(s).',
      },
      expect.any(Number),
    );
  });
});
