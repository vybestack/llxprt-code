/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Mocked } from 'vitest';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

import type { CommandContext, SlashCommand } from './types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import type { GeminiClient } from '@vybestack/llxprt-code-core';

import * as fsPromises from 'fs/promises';
import { chatCommand } from './chatCommand.js';
import type { Stats } from 'fs';
import { createCompletionHandler } from './schema/index.js';

vi.mock('fs/promises', () => ({
  default: {
    stat: vi.fn(),
    readdir: vi.fn().mockResolvedValue(['file1.txt', 'file2.txt'] as string[]),
    writeFile: vi.fn().mockResolvedValue(undefined),
  },
  stat: vi.fn(),
  readdir: vi.fn().mockResolvedValue(['file1.txt', 'file2.txt'] as string[]),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

describe('chatCommand', () => {
  const mockFs = fsPromises as Mocked<typeof fsPromises>;

  let mockContext: CommandContext;
  let mockGetChat: ReturnType<typeof vi.fn>;
  let mockSaveCheckpoint: ReturnType<typeof vi.fn>;
  let mockLoadCheckpoint: ReturnType<typeof vi.fn>;
  let mockDeleteCheckpoint: ReturnType<typeof vi.fn>;
  let mockGetHistory: ReturnType<typeof vi.fn>;

  const getSubCommand = (
    name:
      | 'list'
      | 'save'
      | 'resume'
      | 'delete'
      | 'rename'
      | 'clear'
      | 'restore'
      | 'debug',
  ): SlashCommand => {
    const subCommand = chatCommand.subCommands?.find(
      (cmd) => cmd.name === name,
    );
    if (!subCommand) {
      throw new Error(`/chat ${name} command not found.`);
    }
    return subCommand;
  };

  beforeEach(() => {
    mockGetHistory = vi.fn().mockReturnValue([]);
    mockGetChat = vi.fn().mockReturnValue({
      getHistory: mockGetHistory,
      clearHistory: vi.fn(),
      addHistory: vi.fn(),
    });
    mockSaveCheckpoint = vi.fn().mockResolvedValue(undefined);
    mockLoadCheckpoint = vi.fn().mockResolvedValue({ history: [] });
    mockDeleteCheckpoint = vi.fn().mockResolvedValue(true);

    mockContext = createMockCommandContext({
      services: {
        config: {
          getProjectRoot: () => '/project/root',
          getGeminiClient: () =>
            ({
              getChat: mockGetChat,
              hasChatInitialized: vi.fn().mockReturnValue(true),
              getHistory: vi.fn().mockResolvedValue([]),
            }) as unknown as GeminiClient,
          storage: {
            getProjectTempDir: () => '/project/root/.gemini/tmp/mockhash',
          },
        },
        logger: {
          saveCheckpoint: mockSaveCheckpoint,
          loadCheckpoint: mockLoadCheckpoint,
          deleteCheckpoint: mockDeleteCheckpoint,
          initialize: vi.fn().mockResolvedValue(undefined),
        },
        settings: {
          merged: {
            // Disable fuzzy filtering for tests expecting prefix matching
            enableFuzzyFiltering: false,
          },
        },
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should have the correct main command definition', () => {
    expect(chatCommand.name).toBe('chat');
    expect(chatCommand.description).toBe('Manage conversation checkpoints');
    expect(chatCommand.subCommands).toHaveLength(8);
  });

  describe('list subcommand', () => {
    let listCommand: SlashCommand;

    beforeEach(() => {
      listCommand = getSubCommand('list');
    });

    it('should add a chat_list item to the UI', async () => {
      const fakeFiles = ['checkpoint-test1.json', 'checkpoint-test2.json'];
      const date1 = new Date();
      const date2 = new Date(date1.getTime() + 1000);

      mockFs.readdir.mockResolvedValue(fakeFiles);
      mockFs.stat.mockImplementation(async (path: string): Promise<Stats> => {
        if (path.endsWith('test1.json')) {
          return { mtime: date1 } as Stats;
        }
        return { mtime: date2 } as Stats;
      });

      await listCommand?.action?.(mockContext, '');

      expect(mockContext.ui.addItem).toHaveBeenCalledWith({
        type: 'chat_list',
        chats: [
          {
            name: 'test1',
            mtime: date1.toISOString(),
          },
          {
            name: 'test2',
            mtime: date2.toISOString(),
          },
        ],
      });
    });
  });
  describe('save subcommand', () => {
    let saveCommand: SlashCommand;
    const tag = 'my-tag';
    let mockCheckpointExists: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      saveCommand = getSubCommand('save');
      mockCheckpointExists = vi.fn().mockResolvedValue(false);
      mockContext.services.logger.checkpointExists = mockCheckpointExists;
    });

    it('should return an error if tag is missing', async () => {
      const result = await saveCommand?.action?.(mockContext, '  ');
      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'error',
        content: 'Missing tag. Usage: /chat save <tag>',
      });
    });

    it('should inform if conversation history is empty or only contains system context', async () => {
      mockGetHistory.mockReturnValue([]);
      let result = await saveCommand?.action?.(mockContext, tag);
      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'info',
        content: 'No conversation found to save.',
      });

      mockGetHistory.mockReturnValue([
        { role: 'user', parts: [{ text: 'context for our chat' }] },
      ]);
      result = await saveCommand?.action?.(mockContext, tag);
      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'info',
        content: 'No conversation found to save.',
      });

      mockGetHistory.mockReturnValue([
        { role: 'user', parts: [{ text: 'context for our chat' }] },
        { role: 'user', parts: [{ text: 'Hello, how are you?' }] },
        { role: 'model', parts: [{ text: 'I am doing well!' }] },
      ]);
      result = await saveCommand?.action?.(mockContext, tag);
      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'info',
        content: `Conversation checkpoint saved with tag: ${tag}.`,
      });
    });

    it('should return confirm_action if checkpoint already exists', async () => {
      mockCheckpointExists.mockResolvedValue(true);
      mockContext.invocation = {
        raw: `/chat save ${tag}`,
        name: 'save',
        args: tag,
      };

      const result = await saveCommand?.action?.(mockContext, tag);

      expect(mockCheckpointExists).toHaveBeenCalledWith(tag);
      expect(mockSaveCheckpoint).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        type: 'confirm_action',
        originalInvocation: { raw: `/chat save ${tag}` },
      });
      // Check that prompt is a React element
      expect(result).toHaveProperty('prompt');
    });

    it('should save the conversation if overwrite is confirmed', async () => {
      const history: Content[] = [
        { role: 'user', parts: [{ text: 'context for our chat' }] },
        { role: 'user', parts: [{ text: 'hello' }] },
        { role: 'model', parts: [{ text: 'Hi there!' }] },
      ];
      mockGetHistory.mockReturnValue(history);
      mockContext.overwriteConfirmed = true;

      const result = await saveCommand?.action?.(mockContext, tag);

      expect(mockCheckpointExists).not.toHaveBeenCalled(); // Should skip existence check
      expect(mockSaveCheckpoint).toHaveBeenCalledWith(history, tag);
      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'info',
        content: `Conversation checkpoint saved with tag: ${tag}.`,
      });
    });
  });
  describe('history boundary detection with INITIAL_HISTORY_LENGTH', () => {
    let saveCommand: SlashCommand;
    let clearCommand: SlashCommand;
    const tag = 'test-tag';

    beforeEach(() => {
      saveCommand = getSubCommand('save');
      clearCommand = getSubCommand('clear');
      mockContext.services.logger.checkpointExists = vi
        .fn()
        .mockResolvedValue(false);
    });

    it('should not save when only initial setup exists (1 message)', async () => {
      mockGetHistory.mockReturnValue([
        { role: 'user', parts: [{ text: 'system setup' }] },
      ]);
      const result = await saveCommand?.action?.(mockContext, tag);
      expect(result).toMatchObject({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('No conversation found'),
      });
    });

    it('should save when conversation beyond initial setup exists (>1 message)', async () => {
      mockGetHistory.mockReturnValue([
        { role: 'user', parts: [{ text: 'system setup' }] },
        { role: 'user', parts: [{ text: 'hello' }] },
        { role: 'model', parts: [{ text: 'hi' }] },
      ]);
      mockContext.services.logger.checkpointExists = vi
        .fn()
        .mockResolvedValue(false);
      const result = await saveCommand?.action?.(mockContext, tag);
      expect(result).toMatchObject({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('saved with tag'),
      });
    });

    it('should not clear when only initial setup exists (1 message)', async () => {
      mockGetHistory.mockReturnValue([
        { role: 'user', parts: [{ text: 'system setup' }] },
      ]);
      const result = await clearCommand?.action?.(mockContext, '');
      expect(result).toMatchObject({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('No conversation to clear'),
      });
    });

    it('should clear when conversation beyond initial setup exists (>1 message)', async () => {
      const mockClearHistory = vi.fn();
      const mockClear = vi.fn();
      const mockUpdateHistoryTokenCount = vi.fn();
      mockGetChat.mockReturnValue({
        getHistory: mockGetHistory,
        clearHistory: mockClearHistory,
      });
      mockContext.ui = {
        ...mockContext.ui,
        clear: mockClear,
        updateHistoryTokenCount: mockUpdateHistoryTokenCount,
      };
      mockGetHistory.mockReturnValue([
        { role: 'user', parts: [{ text: 'system setup' }] },
        { role: 'user', parts: [{ text: 'hello' }] },
        { role: 'model', parts: [{ text: 'hi' }] },
      ]);
      await clearCommand?.action?.(mockContext, '');
      expect(mockClearHistory).toHaveBeenCalled();
      expect(mockClear).toHaveBeenCalled();
    });
  });

  describe('resume subcommand', () => {
    const goodTag = 'good-tag';
    const badTag = 'bad-tag';

    let resumeCommand: SlashCommand;
    beforeEach(() => {
      resumeCommand = getSubCommand('resume');
    });

    it('should return an error if tag is missing', async () => {
      const result = await resumeCommand?.action?.(mockContext, '');

      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'error',
        content: 'Missing tag. Usage: /chat resume <tag>',
      });
    });

    it('should inform if checkpoint is not found', async () => {
      mockLoadCheckpoint.mockResolvedValue({ history: [] });

      const result = await resumeCommand?.action?.(mockContext, badTag);

      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'info',
        content: `No saved checkpoint found with tag: ${badTag}.`,
      });
    });

    it('should resume a conversation', async () => {
      const conversation: Content[] = [
        { role: 'user', parts: [{ text: 'hello gemini' }] },
        { role: 'model', parts: [{ text: 'hello world' }] },
      ];
      mockLoadCheckpoint.mockResolvedValue({ history: conversation });

      const result = await resumeCommand?.action?.(mockContext, goodTag);

      // Now returns LoadHistoryActionReturn to properly sync UI and client history
      expect(result).toStrictEqual({
        type: 'load_history',
        history: [
          { type: 'user', text: 'hello gemini' },
          { type: 'gemini', text: 'hello world' },
        ],
        clientHistory: conversation,
      });
    });

    describe('schema completion', () => {
      const runCompletion = async (partial: string): Promise<string[]> => {
        const handler = createCompletionHandler(resumeCommand.schema!);
        const result = await handler(
          mockContext,
          {
            args: partial,
            completedArgs: [],
            partialArg: partial,
            commandPathLength: 2,
          },
          `/chat resume ${partial}`,
        );
        return result.suggestions.map((option) => option.value);
      };

      it('should provide completion suggestions', async () => {
        const fakeFiles = ['checkpoint-alpha.json', 'checkpoint-beta.json'];
        mockFs.readdir.mockImplementation(
          (async (_: string): Promise<string[]> =>
            fakeFiles) as unknown as typeof fsPromises.readdir,
        );

        mockFs.stat.mockImplementation(
          (async (_: string): Promise<Stats> =>
            ({
              mtime: new Date(),
            }) as Stats) as unknown as typeof fsPromises.stat,
        );

        expect(await runCompletion('a')).toStrictEqual(['alpha']);
      });

      it('should suggest filenames sorted by modified time (newest first)', async () => {
        const fakeFiles = ['checkpoint-test1.json', 'checkpoint-test2.json'];
        const date = new Date();
        mockFs.readdir.mockImplementation(
          (async (_: string): Promise<string[]> =>
            fakeFiles) as unknown as typeof fsPromises.readdir,
        );
        mockFs.stat.mockImplementation((async (
          path: string,
        ): Promise<Stats> => {
          if (path.endsWith('test1.json')) {
            return { mtime: date } as Stats;
          }
          return { mtime: new Date(date.getTime() + 1000) } as Stats;
        }) as unknown as typeof fsPromises.stat);

        expect(await runCompletion('')).toStrictEqual(['test2', 'test1']);
      });
    });
  });

  describe('delete subcommand', () => {
    let deleteCommand: SlashCommand;
    const tag = 'my-tag';
    beforeEach(() => {
      deleteCommand = getSubCommand('delete');
    });

    it('should return an error if tag is missing', async () => {
      const result = await deleteCommand?.action?.(mockContext, '  ');
      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'error',
        content: 'Missing tag. Usage: /chat delete <tag>',
      });
    });

    it('should return confirmation prompt for checkpoint deletion', async () => {
      mockContext.invocation = {
        raw: `/chat delete ${tag}`,
        name: 'delete',
        args: tag,
      };
      const result = await deleteCommand?.action?.(mockContext, tag);
      expect(result).toMatchObject({
        type: 'confirm_action',
        originalInvocation: { raw: `/chat delete ${tag}` },
      });
      // Check that prompt is a React element
      expect(result).toHaveProperty('prompt');
    });

    it('should delete the conversation when confirmed', async () => {
      mockContext.overwriteConfirmed = true;
      const mockCheckpointExists = vi.fn().mockResolvedValue(true);
      mockContext.services.logger.checkpointExists = mockCheckpointExists;

      const result = await deleteCommand?.action?.(mockContext, tag);

      expect(mockDeleteCheckpoint).toHaveBeenCalledWith(tag);
      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'info',
        content: `Deleted checkpoint: ${tag}`,
      });
    });

    describe('schema completion', () => {
      it('should provide completion suggestions', async () => {
        const fakeFiles = ['checkpoint-alpha.json', 'checkpoint-beta.json'];
        mockFs.readdir.mockImplementation(
          (async (_: string): Promise<string[]> =>
            fakeFiles) as unknown as typeof fsPromises.readdir,
        );

        mockFs.stat.mockImplementation(
          (async (_: string): Promise<Stats> =>
            ({
              mtime: new Date(),
            }) as Stats) as unknown as typeof fsPromises.stat,
        );

        const handler = createCompletionHandler(deleteCommand.schema!);
        const result = await handler(
          mockContext,
          {
            args: 'a',
            completedArgs: [],
            partialArg: 'a',
            commandPathLength: 2,
          },
          '/chat delete a',
        );

        expect(result.suggestions.map((option) => option.value)).toStrictEqual([
          'alpha',
        ]);
      });
    });
  });

  describe('debug subcommand', () => {
    let debugCommand: SlashCommand;

    beforeEach(() => {
      debugCommand = getSubCommand('debug');
    });

    it('should show chat initialized and history when chat is active', async () => {
      const mockHistory = [
        { role: 'user', parts: [{ text: 'setup' }] },
        { role: 'user', parts: [{ text: 'hello' }] },
        { role: 'model', parts: [{ text: 'hi' }] },
      ];
      mockGetHistory.mockReturnValue(mockHistory);

      const result = await debugCommand?.action?.(mockContext, '');

      expect(result).toMatchObject({
        type: 'message',
        messageType: 'info',
      });
      expect(result?.content).toContain('Chat initialized: true');
      expect(result?.content).toContain('History entries: 3');
      expect(result?.content).toContain('Current model:');
      expect(result?.content).toContain('Checkpoint directory:');
    });

    it('should show chat not initialized when no chat exists', async () => {
      const mockContextNoChat = createMockCommandContext({
        services: {
          config: {
            getProjectRoot: () => '/project/root',
            getGeminiClient: () =>
              ({
                hasChatInitialized: vi.fn().mockReturnValue(false),
              }) as unknown as GeminiClient,
            getModel: () => 'test-model',
            storage: {
              getProjectTempDir: () => '/project/root/.gemini/tmp/mockhash',
            },
          },
          logger: {
            initialize: vi.fn().mockResolvedValue(undefined),
          },
        },
      });

      const result = await debugCommand?.action?.(mockContextNoChat, '');

      expect(result).toMatchObject({
        type: 'message',
        messageType: 'info',
      });
      expect(result?.content).toContain('Chat initialized: false');
      expect(result?.content).toContain(
        'History entries: 0 (chat not initialized)',
      );
    });

    it('should handle missing config gracefully', async () => {
      const mockContextNoConfig = createMockCommandContext({
        services: {
          config: null,
          logger: {
            initialize: vi.fn().mockResolvedValue(undefined),
          },
        },
      });

      const result = await debugCommand?.action?.(mockContextNoConfig, '');

      expect(result).toMatchObject({
        type: 'message',
        messageType: 'info',
      });
      expect(result?.content).toContain('Chat initialized: false');
      expect(result?.content).toContain(
        'Current model: unavailable (config not initialized)',
      );
      expect(result?.content).toContain('Checkpoint directory: unavailable');
    });
  });
});
