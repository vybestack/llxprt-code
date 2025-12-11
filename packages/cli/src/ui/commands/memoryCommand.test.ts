/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Mock } from 'vitest';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { memoryCommand } from './memoryCommand.js';
import type { SlashCommand, CommandContext } from './types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import { MessageType } from '../types.js';
import { LoadedSettings } from '../../config/settings.js';
import {
  getErrorMessage,
  loadServerHierarchicalMemory,
  type FileDiscoveryService,
  type LoadServerHierarchicalMemoryResponse,
} from '@vybestack/llxprt-code-core';

vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@vybestack/llxprt-code-core')>();
  return {
    ...original,
    getErrorMessage: vi.fn((error: unknown) => {
      if (error instanceof Error) return error.message;
      return String(error);
    }),
    loadServerHierarchicalMemory: vi.fn(),
  };
});

const mockLoadServerHierarchicalMemory = loadServerHierarchicalMemory as Mock;

describe('memoryCommand', () => {
  let mockContext: CommandContext;

  const getSubCommand = (
    name: 'show' | 'add' | 'refresh' | 'list',
  ): SlashCommand => {
    const subCommand = memoryCommand.subCommands?.find(
      (cmd) => cmd.name === name,
    );
    if (!subCommand) {
      throw new Error(`/memory ${name} command not found.`);
    }
    return subCommand;
  };

  describe('/memory show', () => {
    let showCommand: SlashCommand;
    let mockGetUserMemory: Mock;
    let mockGetLlxprtMdFileCount: Mock;

    beforeEach(() => {
      showCommand = getSubCommand('show');

      mockGetUserMemory = vi.fn();
      mockGetLlxprtMdFileCount = vi.fn();

      mockContext = createMockCommandContext({
        services: {
          config: {
            getUserMemory: mockGetUserMemory,
            getLlxprtMdFileCount: mockGetLlxprtMdFileCount,
          },
        },
      });
    });

    it('should display a message if memory is empty', async () => {
      if (!showCommand.action) throw new Error('Command has no action');

      mockGetUserMemory.mockReturnValue('');
      mockGetLlxprtMdFileCount.mockReturnValue(0);

      await showCommand.action(mockContext, '');

      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: 'Memory is currently empty.',
        },
        expect.any(Number),
      );
    });

    it('should display the memory content and file count if it exists', async () => {
      if (!showCommand.action) throw new Error('Command has no action');

      const memoryContent = 'This is a test memory.';

      mockGetUserMemory.mockReturnValue(memoryContent);
      mockGetLlxprtMdFileCount.mockReturnValue(1);

      await showCommand.action(mockContext, '');

      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: `Current memory content from 1 file(s):\n\n---\n${memoryContent}\n---`,
        },
        expect.any(Number),
      );
    });
  });

  describe('/memory add', () => {
    let addCommand: SlashCommand;

    beforeEach(() => {
      addCommand = getSubCommand('add');
      mockContext = createMockCommandContext();
    });

    it('should return an error message if no arguments are provided', () => {
      if (!addCommand.action) throw new Error('Command has no action');

      const result = addCommand.action(mockContext, '  ');
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'Usage: /memory add [--project|-p] <text to remember>',
      });

      expect(mockContext.ui.addItem).not.toHaveBeenCalled();
    });

    it('should return a tool action and add an info message when arguments are provided', () => {
      if (!addCommand.action) throw new Error('Command has no action');

      const fact = 'remember this';
      const result = addCommand.action(mockContext, `  ${fact}  `);

      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: `Attempting to save to memory: "${fact}"`,
        },
        expect.any(Number),
      );

      expect(result).toEqual({
        type: 'tool',
        toolName: 'save_memory',
        toolArgs: { fact },
      });
    });

    it('should return a tool action with scope "project" when --project flag is provided', () => {
      if (!addCommand.action) throw new Error('Command has no action');

      const fact = 'remember this for the project';
      const result = addCommand.action(mockContext, `--project ${fact}`);

      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: `Attempting to save to memory: "${fact}"`,
        },
        expect.any(Number),
      );

      expect(result).toEqual({
        type: 'tool',
        toolName: 'save_memory',
        toolArgs: { fact, scope: 'project' },
      });
    });

    it('should return a tool action with scope "project" when -p flag is provided', () => {
      if (!addCommand.action) throw new Error('Command has no action');

      const fact = 'remember this for the project';
      const result = addCommand.action(mockContext, `-p ${fact}`);

      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: `Attempting to save to memory: "${fact}"`,
        },
        expect.any(Number),
      );

      expect(result).toEqual({
        type: 'tool',
        toolName: 'save_memory',
        toolArgs: { fact, scope: 'project' },
      });
    });

    it('should handle --project flag at the end of arguments', () => {
      if (!addCommand.action) throw new Error('Command has no action');

      const fact = 'remember this for the project';
      const result = addCommand.action(mockContext, `${fact} --project`);

      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: `Attempting to save to memory: "${fact}"`,
        },
        expect.any(Number),
      );

      expect(result).toEqual({
        type: 'tool',
        toolName: 'save_memory',
        toolArgs: { fact, scope: 'project' },
      });
    });
  });

  describe('/memory refresh', () => {
    let refreshCommand: SlashCommand;
    let mockSetUserMemory: Mock;
    let mockSetLlxprtMdFileCount: Mock;
    let mockSetLlxprtMdFilePaths: Mock;

    beforeEach(() => {
      refreshCommand = getSubCommand('refresh');
      mockSetUserMemory = vi.fn();
      mockSetLlxprtMdFileCount = vi.fn();
      mockSetLlxprtMdFilePaths = vi.fn();

      const mockConfig = {
        setUserMemory: mockSetUserMemory,
        setLlxprtMdFileCount: mockSetLlxprtMdFileCount,
        setLlxprtMdFilePaths: mockSetLlxprtMdFilePaths,
        getWorkingDir: () => '/test/dir',
        getDebugMode: () => false,
        getFileService: () => ({}) as FileDiscoveryService,
        getExtensionContextFilePaths: () => [],
        shouldLoadMemoryFromIncludeDirectories: () => false,
        getWorkspaceContext: () => ({
          getDirectories: () => [],
        }),
        getFileFilteringOptions: () => ({
          ignore: [],
          include: [],
        }),
        getFolderTrust: () => false,
      };

      mockContext = createMockCommandContext({
        services: {
          config: mockConfig,
          settings: {
            merged: {
              memoryDiscoveryMaxDirs: 1000,
            },
          } as LoadedSettings,
        },
      });
      mockLoadServerHierarchicalMemory.mockClear();
    });

    it('should display success message when memory is refreshed with content', async () => {
      if (!refreshCommand.action) throw new Error('Command has no action');

      const refreshResult: LoadServerHierarchicalMemoryResponse = {
        memoryContent: 'new memory content',
        fileCount: 2,
        filePaths: ['/path/one/GEMINI.md', '/path/two/GEMINI.md'],
      };
      mockLoadServerHierarchicalMemory.mockResolvedValue(refreshResult);

      await refreshCommand.action(mockContext, '');

      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: 'Refreshing memory from source files...',
        },
        expect.any(Number),
      );

      expect(loadServerHierarchicalMemory).toHaveBeenCalledOnce();
      expect(mockSetUserMemory).toHaveBeenCalledWith(
        refreshResult.memoryContent,
      );
      expect(mockSetLlxprtMdFileCount).toHaveBeenCalledWith(
        refreshResult.fileCount,
      );
      expect(mockSetLlxprtMdFilePaths).toHaveBeenCalledWith(
        refreshResult.filePaths,
      );

      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: 'Memory refreshed successfully. Loaded 18 characters from 2 file(s).',
        },
        expect.any(Number),
      );
    });

    it('should display success message when memory is refreshed with no content', async () => {
      if (!refreshCommand.action) throw new Error('Command has no action');

      const refreshResult = { memoryContent: '', fileCount: 0, filePaths: [] };
      mockLoadServerHierarchicalMemory.mockResolvedValue(refreshResult);

      await refreshCommand.action(mockContext, '');

      expect(loadServerHierarchicalMemory).toHaveBeenCalledOnce();
      expect(mockSetUserMemory).toHaveBeenCalledWith('');
      expect(mockSetLlxprtMdFileCount).toHaveBeenCalledWith(0);
      expect(mockSetLlxprtMdFilePaths).toHaveBeenCalledWith([]);

      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: 'Memory refreshed successfully. No memory content found.',
        },
        expect.any(Number),
      );
    });

    it('should display an error message if refreshing fails', async () => {
      if (!refreshCommand.action) throw new Error('Command has no action');

      const error = new Error('Failed to read memory files.');
      mockLoadServerHierarchicalMemory.mockRejectedValue(error);

      await refreshCommand.action(mockContext, '');

      expect(loadServerHierarchicalMemory).toHaveBeenCalledOnce();
      expect(mockSetUserMemory).not.toHaveBeenCalled();
      expect(mockSetLlxprtMdFileCount).not.toHaveBeenCalled();
      expect(mockSetLlxprtMdFilePaths).not.toHaveBeenCalled();

      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        {
          type: MessageType.ERROR,
          text: `Error refreshing memory: ${error.message}`,
        },
        expect.any(Number),
      );

      expect(getErrorMessage).toHaveBeenCalledWith(error);
    });

    it('should not throw if config service is unavailable', async () => {
      if (!refreshCommand.action) throw new Error('Command has no action');

      const nullConfigContext = createMockCommandContext({
        services: { config: null },
      });

      await expect(
        refreshCommand.action(nullConfigContext, ''),
      ).resolves.toBeUndefined();

      expect(nullConfigContext.ui.addItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: 'Refreshing memory from source files...',
        },
        expect.any(Number),
      );

      expect(loadServerHierarchicalMemory).not.toHaveBeenCalled();
    });
  });

  describe('/memory list', () => {
    let listCommand: SlashCommand;
    let mockGetLlxprtMdFilePaths: Mock;

    beforeEach(() => {
      listCommand = getSubCommand('list');
      mockGetLlxprtMdFilePaths = vi.fn();
      mockContext = createMockCommandContext({
        services: {
          config: {
            getLlxprtMdFilePaths: mockGetLlxprtMdFilePaths,
          },
        },
      });
    });

    it('should display a message if no LLXPRT.md files are found', async () => {
      if (!listCommand.action) throw new Error('Command has no action');

      mockGetLlxprtMdFilePaths.mockReturnValue([]);

      await listCommand.action(mockContext, '');

      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: 'No LLXPRT.md files in use.',
        },
        expect.any(Number),
      );
    });

    it('should display the file count and paths if they exist', async () => {
      if (!listCommand.action) throw new Error('Command has no action');

      const filePaths = ['/path/one/LLXPRT.md', '/path/two/LLXPRT.md'];
      mockGetLlxprtMdFilePaths.mockReturnValue(filePaths);

      await listCommand.action(mockContext, '');

      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: `There are 2 LLXPRT.md file(s) in use:\n\n${filePaths.join('\n')}`,
        },
        expect.any(Number),
      );
    });
  });
});
