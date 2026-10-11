/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  WorkspaceFilesystemOwner,
  assembleWorkspaceMemory,
  Config,
} from '@vybestack/llxprt-code-core';
import { SessionInstructionOwner } from '../../../../agents/src/session/session-instruction-owner.js';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  type Mock,
} from 'bun:test';
import { memoryCommand } from './memoryCommand.js';
import type { SlashCommand, CommandContext } from './types.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { MessageType } from '../types.js';
import { loadHierarchicalLlxprtMemory } from '../../config/environmentLoader.js';
import { assertDefined } from '../../__tests__/assertions.js';

const original = { ...(await import('@vybestack/llxprt-code-core')) };
void vi.mock('@vybestack/llxprt-code-core', () => ({
  ...original,
  getErrorMessage: vi.fn((error: unknown) => {
    if (error instanceof Error) return error.message;
    return String(error);
  }),
  getGlobalCoreMemoryFilePath: vi.fn(() => '/mock/home/.llxprt/.LLXPRT_SYSTEM'),
  getProjectCoreMemoryFilePath: vi.fn(
    (dir: string) => `${dir}/.llxprt/.LLXPRT_SYSTEM`,
  ),
  MemoryTool: {
    ...original.MemoryTool,
    performAddMemoryEntry: vi.fn().mockResolvedValue(undefined),
  },
}));

const actualOriginal = {
  ...(await import('../../config/environmentLoader.js')),
};
const mockLoadHierarchicalLlxprtMemory =
  vi.fn<typeof loadHierarchicalLlxprtMemory>();
void vi.mock('../../config/environmentLoader.js', () => ({
  ...actualOriginal,
  loadHierarchicalLlxprtMemory: mockLoadHierarchicalLlxprtMemory,
}));

describe('memoryCommand', () => {
  let mockContext: CommandContext;

  const getSubCommand = (
    name: 'show' | 'add' | 'refresh' | 'list',
  ): SlashCommand => {
    const subCommand = memoryCommand.subCommands?.find(
      (cmd) => cmd.name === name,
    );
    assertDefined(subCommand);
    return subCommand;
  };

  describe('/memory show', () => {
    let showCommand: SlashCommand;
    let mockGetUserMemory: Mock<(...args: never[]) => unknown>;
    let mockGetLlxprtMdFileCount: Mock<(...args: never[]) => unknown>;

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
      mockGetUserMemory.mockReturnValue('');
      mockGetLlxprtMdFileCount.mockReturnValue(0);

      await showCommand.action!(mockContext, '');

      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: 'Memory is currently empty.',
        },
        expect.any(Number),
      );
    });

    it('should display the memory content and file count if it exists', async () => {
      const memoryContent = 'This is a test memory.';

      mockGetUserMemory.mockReturnValue(memoryContent);
      mockGetLlxprtMdFileCount.mockReturnValue(1);

      await showCommand.action!(mockContext, '');

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
      const result = addCommand.action!(mockContext, '  ');
      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'error',
        content:
          'Usage: /memory add <global|project|core.global|core.project> <text to remember>',
      });

      expect(mockContext.ui.addItem).not.toHaveBeenCalled();
    });

    it('should return an error message if only scope is provided without text', () => {
      const result = addCommand.action!(mockContext, 'global');
      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'error',
        content:
          'Usage: /memory add <global|project|core.global|core.project> <text to remember>',
      });

      expect(mockContext.ui.addItem).not.toHaveBeenCalled();
    });

    it('should return an error message if only "project" is provided without text', () => {
      const result = addCommand.action!(mockContext, 'project');
      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'error',
        content:
          'Usage: /memory add <global|project|core.global|core.project> <text to remember>',
      });

      expect(mockContext.ui.addItem).not.toHaveBeenCalled();
    });

    it('should default to global scope when no scope keyword is provided', () => {
      const fact = 'remember this';
      const result = addCommand.action!(mockContext, `  ${fact}  `);

      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: `Attempting to save to memory: "${fact}"`,
        },
        expect.any(Number),
      );

      expect(result).toStrictEqual({
        type: 'tool',
        toolName: 'save_memory',
        toolArgs: { fact },
      });
    });

    it('should return a tool action with scope "global" when "global" is specified', () => {
      const fact = 'remember this globally';
      const result = addCommand.action!(mockContext, `global ${fact}`);

      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: `Attempting to save to memory: "${fact}"`,
        },
        expect.any(Number),
      );

      expect(result).toStrictEqual({
        type: 'tool',
        toolName: 'save_memory',
        toolArgs: { fact, scope: 'global' },
      });
    });

    it('should return a tool action with scope "project" when "project" is specified', () => {
      const fact = 'remember this for the project';
      const result = addCommand.action!(mockContext, `project ${fact}`);

      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: `Attempting to save to memory: "${fact}"`,
        },
        expect.any(Number),
      );

      expect(result).toStrictEqual({
        type: 'tool',
        toolName: 'save_memory',
        toolArgs: { fact, scope: 'project' },
      });
    });

    it('should handle uppercase scope keywords', () => {
      const fact = 'test fact';
      const result = addCommand.action!(mockContext, `PROJECT ${fact}`);

      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: `Attempting to save to memory: "${fact}"`,
        },
        expect.any(Number),
      );

      expect(result).toStrictEqual({
        type: 'tool',
        toolName: 'save_memory',
        toolArgs: { fact, scope: 'project' },
      });
    });

    it('should handle mixed case scope keywords', () => {
      const fact = 'test fact';
      const result = addCommand.action!(mockContext, `Global ${fact}`);

      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: `Attempting to save to memory: "${fact}"`,
        },
        expect.any(Number),
      );

      expect(result).toStrictEqual({
        type: 'tool',
        toolName: 'save_memory',
        toolArgs: { fact, scope: 'global' },
      });
    });

    it('should treat non-scope first words as part of the fact', () => {
      const fact = 'globally important fact';
      const result = addCommand.action!(mockContext, fact);

      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: `Attempting to save to memory: "${fact}"`,
        },
        expect.any(Number),
      );

      expect(result).toStrictEqual({
        type: 'tool',
        toolName: 'save_memory',
        toolArgs: { fact },
      });
    });

    it('should return error when core.project is provided without content', () => {
      const result = addCommand.action!(mockContext, 'core.project');

      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'error',
        content: expect.stringContaining('Usage'),
      });
    });

    it('should return error when core.global is provided without content', () => {
      const result = addCommand.action!(mockContext, 'core.global');

      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'error',
        content: expect.stringContaining('Usage'),
      });
    });

    it('should handle core.project scope and write directly (async)', () => {
      mockContext = createMockCommandContext({
        services: {
          config: {
            getWorkingDir: vi.fn().mockReturnValue('/test/project'),
          },
        },
      });

      // core.project scope returns void (writes directly)
      const result = addCommand.action!(
        mockContext,
        'core.project Always use strict mode',
      );

      expect(result).toBeUndefined();
    });

    it('should handle core.global scope and write directly (async)', () => {
      mockContext = createMockCommandContext({
        services: {
          config: {
            getWorkingDir: vi.fn().mockReturnValue('/test/project'),
          },
        },
      });

      const result = addCommand.action!(
        mockContext,
        'core.global Prefer TypeScript',
      );

      expect(result).toBeUndefined();
    });
  });

  describe('/memory refresh', () => {
    let directory: string;
    let files: WorkspaceFilesystemOwner;
    let memory: ReturnType<typeof assembleWorkspaceMemory>;
    let instructions: SessionInstructionOwner;
    let previousHome: string | undefined;
    beforeEach(async () => {
      directory = await mkdtemp(join(tmpdir(), 'cli-memory-refresh-'));
      await mkdir(join(directory, '.git'));
      await mkdir(join(directory, 'global'));
      previousHome = process.env.LLXPRT_CONFIG_HOME;
      process.env.LLXPRT_CONFIG_HOME = join(directory, 'global');
      files = new WorkspaceFilesystemOwner({
        targetDir: directory,
        isTrusted: () => true,
      });
      const config = new Config({
        sessionId: 'memory-command',
        targetDir: directory,
        cwd: directory,
        debugMode: false,
        model: 'fake',
        jitContextEnabled: false,
        contextFileName: 'LLXPRT.md',
      });
      memory = assembleWorkspaceMemory(config, files, {
        isTrustedFolder: () => true,
        getIdeTrust: () => undefined,
      });
      instructions = new SessionInstructionOwner(
        memory.operations,
        '',
        false,
        async () => {},
      );
      const context = createMockCommandContext();
      if (!context.services.config)
        throw new Error('Missing command runtime fixture');
      mockContext = {
        ...context,
        services: {
          ...context.services,
          config: {
            ...context.services.config,
            refreshMemory: () =>
              instructions.memory.refresh().then((result) => ({
                ...result,
                filePaths: [...result.filePaths],
              })),
          },
        },
      };
    });
    afterEach(async () => {
      const results = await Promise.allSettled([instructions.dispose()]);
      results.push(...(await Promise.allSettled([memory.dispose()])));
      results.push(...(await Promise.allSettled([files.dispose()])));
      if (previousHome === undefined) delete process.env.LLXPRT_CONFIG_HOME;
      else process.env.LLXPRT_CONFIG_HOME = previousHome;
      await rm(directory, { recursive: true, force: true });
      const failures = results.flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : [],
      );
      if (failures.length > 0)
        throw new AggregateError(
          failures,
          'Command instruction cleanup failed',
        );
    });
    it('displays character and file counts after reloading real instructions', async () => {
      await writeFile(join(directory, 'LLXPRT.md'), 'new memory content');
      await getSubCommand('refresh').action!(mockContext, '');
      const snapshot = instructions.reads.snapshot();
      expect(snapshot.memoryContent).toContain('new memory content');
      expect(snapshot.fileCount).toBe(1);
      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: `Memory refreshed successfully. Loaded ${snapshot.memoryContent.length} characters from 1 file(s).`,
        },
        expect.any(Number),
      );
    });
    it('displays a successful empty discovery', async () => {
      await getSubCommand('refresh').action!(mockContext, '');
      expect(instructions.reads.snapshot().filePaths).toStrictEqual([]);
      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: 'Memory refreshed successfully. No memory content found.',
        },
        expect.any(Number),
      );
    });
    it('reports rejected publication without committing the new file state', async () => {
      await writeFile(join(directory, 'LLXPRT.md'), 'old instruction');
      await instructions.memory.refresh();
      await writeFile(join(directory, 'LLXPRT.md'), 'reject this instruction');
      const release = memory.operations.subscribe(() => {
        if (
          memory.operations
            .snapshot()
            .memoryContent.includes('reject this instruction')
        )
          throw new Error('Failed to publish memory files.');
      });
      try {
        await getSubCommand('refresh').action!(mockContext, '');
        expect(instructions.memory.getMemory()).toContain('old instruction');
        expect(mockContext.ui.addItem).toHaveBeenCalledWith(
          {
            type: MessageType.ERROR,
            text: 'Error refreshing memory: Failed to publish memory files.',
          },
          expect.any(Number),
        );
      } finally {
        release();
      }
    });
    it('does not throw when the config service is unavailable', async () => {
      const context = createMockCommandContext({ services: { config: null } });
      await expect(
        getSubCommand('refresh').action!(context, ''),
      ).resolves.toBeUndefined();
      expect(context.ui.addItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: 'Refreshing memory from source files...',
        },
        expect.any(Number),
      );
    });
    it('reloads physical instructions through the same operation with JIT enabled', async () => {
      const jit = new SessionInstructionOwner(
        memory.operations,
        '',
        true,
        async () => {},
      );
      await writeFile(join(directory, 'LLXPRT.md'), 'jit memory content');
      try {
        const result = await jit.memory.refresh();
        expect(result.memoryContent).toContain('jit memory content');
        expect(result.fileCount).toBe(1);
      } finally {
        await jit.dispose();
      }
    });
  });

  describe('/memory list', () => {
    let listCommand: SlashCommand;
    let mockGetLlxprtMdFilePaths: Mock<(...args: never[]) => unknown>;

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
      mockGetLlxprtMdFilePaths.mockReturnValue([]);

      await listCommand.action!(mockContext, '');

      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: 'No LLXPRT.md files in use.',
        },
        expect.any(Number),
      );
    });

    it('should display the file count and paths if they exist', async () => {
      const filePaths = ['/path/one/LLXPRT.md', '/path/two/LLXPRT.md'];
      mockGetLlxprtMdFilePaths.mockReturnValue(filePaths);

      await listCommand.action!(mockContext, '');

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
