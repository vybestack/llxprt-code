/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const { mockProcessExit } = vi.hoisted(() => ({
  mockProcessExit: vi.fn((_code?: number): never => undefined as never),
}));

vi.mock('node:process', () => ({
  default: {
    exit: mockProcessExit,
  },
}));

const mockBuiltinLoadCommands = vi.fn();
vi.mock('../../services/BuiltinCommandLoader.js', () => ({
  BuiltinCommandLoader: vi.fn().mockImplementation(() => ({
    loadCommands: mockBuiltinLoadCommands,
  })),
}));

const mockFileLoadCommands = vi.fn();
vi.mock('../../services/FileCommandLoader.js', () => ({
  FileCommandLoader: vi.fn().mockImplementation(() => ({
    loadCommands: mockFileLoadCommands,
  })),
}));

vi.mock('node:fs/promises', async () => {
  const actual =
    await vi.importActual<typeof import('node:fs/promises')>(
      'node:fs/promises',
    );
  return {
    ...actual,
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
  };
});

const mockGetCliVersionFn = vi.fn(() => Promise.resolve('0.1.0'));
vi.mock('../../utils/version.js', () => ({
  getCliVersion: (...args: []) => mockGetCliVersionFn(...args),
}));

vi.mock('../contexts/SessionContext.js', () => ({
  useSessionStats: vi.fn(() => ({ stats: {} })),
}));

vi.mock('./useShowMemoryCommand.js', () => ({
  SHOW_MEMORY_COMMAND_NAME: '/memory show',
  createShowMemoryAction: vi.fn(() => vi.fn()),
}));

vi.mock('open', () => ({
  default: vi.fn(),
}));

vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@vybestack/llxprt-code-core')>();
  return {
    ...actual,
  };
});

import { act, renderHook, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, type Mock } from 'vitest';
import open from 'open';
import { useSlashCommandProcessor } from './slashCommandProcessor.js';
import { MessageType } from '../types.js';
import { Config } from '@vybestack/llxprt-code-core';
import { LoadedSettings } from '../../config/settings.js';
import * as ShowMemoryCommandModule from './useShowMemoryCommand.js';
import { CommandKind, SlashCommand } from '../commands/types.js';
import { BuiltinCommandLoader } from '../../services/BuiltinCommandLoader.js';

const createTestCommand = (
  overrides: Partial<SlashCommand>,
  kind: CommandKind = CommandKind.BUILT_IN,
): SlashCommand => ({
  name: 'test',
  description: 'Test command',
  kind,
  action: vi.fn(),
  ...overrides,
});

describe('useSlashCommandProcessor', () => {
  let mockAddItem: ReturnType<typeof vi.fn>;
  let mockClearItems: ReturnType<typeof vi.fn>;
  let mockLoadHistory: ReturnType<typeof vi.fn>;
  let mockRefreshStatic: ReturnType<typeof vi.fn>;
  let mockSetShowHelp: ReturnType<typeof vi.fn>;
  let mockOnDebugMessage: ReturnType<typeof vi.fn>;
  let mockOpenThemeDialog: ReturnType<typeof vi.fn>;
  let mockOpenAuthDialog: ReturnType<typeof vi.fn>;
  let mockOpenEditorDialog: ReturnType<typeof vi.fn>;
  let mockOpenProviderDialog: ReturnType<typeof vi.fn>;
  let mockOpenProviderModelDialog: ReturnType<typeof vi.fn>;
  let mockPerformMemoryRefresh: ReturnType<typeof vi.fn>;
  let mockSetQuittingMessages: ReturnType<typeof vi.fn>;
  let mockOpenPrivacyNotice: ReturnType<typeof vi.fn>;
  let mockConfig: Config;
  let mockSettings: LoadedSettings;
  let mockGeminiClient: ReturnType<typeof vi.fn>;

  beforeAll(() => {
    global.process.env = {
      GEMINI_SYSTEM_MD: '0',
    };
  });

  beforeEach(() => {
    vi.clearAllMocks();
    (vi.mocked(BuiltinCommandLoader) as Mock).mockClear();
    mockBuiltinLoadCommands.mockResolvedValue([]);
    mockFileLoadCommands.mockResolvedValue([]);

    mockAddItem = vi.fn();
    mockClearItems = vi.fn();
    mockLoadHistory = vi.fn();
    mockRefreshStatic = vi.fn();
    mockSetShowHelp = vi.fn();
    mockOnDebugMessage = vi.fn();
    mockOpenThemeDialog = vi.fn();
    mockOpenAuthDialog = vi.fn();
    mockOpenEditorDialog = vi.fn();
    mockOpenProviderDialog = vi.fn();
    mockOpenProviderModelDialog = vi.fn();
    mockPerformMemoryRefresh = vi.fn();
    mockSetQuittingMessages = vi.fn();
    mockOpenPrivacyNotice = vi.fn();

    mockGeminiClient = {
      getChat: vi.fn(() => ({
        getHistory: vi.fn(() => []),
      })),
      setHistory: vi.fn(),
    };

    mockConfig = {
      getModel: vi.fn(() => 'mock-model'),
      getProjectRoot: vi.fn(() => '/mock/project'),
      getProjectTempDir: vi.fn(() => '/mock/project/.llxprt'),
      getCheckpointingEnabled: vi.fn(() => false),
      getActiveExtensions: vi.fn(() => []),
      getMcpServers: vi.fn(() => ({})),
      getToolRegistry: vi.fn(() => ({
        getToolsByServer: vi.fn(() => []),
        getAllTools: vi.fn(() => []),
      })),
      getSessionId: vi.fn(() => 'mock-session-id'),
      getGeminiClient: vi.fn(() => mockGeminiClient),
      getBugCommand: vi.fn(),
      getCoreTools: vi.fn(() => []),
      getExcludeTools: vi.fn(() => []),
    } as unknown as Config;

    mockSettings = {} as LoadedSettings;

    (open as Mock).mockClear();
    mockProcessExit.mockClear();
    (ShowMemoryCommandModule.createShowMemoryAction as Mock).mockClear();
    process.env = { ...globalThis.process.env };
  });

  const setupProcessorHook = (
    builtinCommands: SlashCommand[] = [],
    fileCommands: SlashCommand[] = [],
  ) => {
    mockBuiltinLoadCommands.mockResolvedValue(builtinCommands);
    mockFileLoadCommands.mockResolvedValue(fileCommands);

    return renderHook(() =>
      useSlashCommandProcessor(
        mockConfig,
        mockSettings,
        mockAddItem,
        mockClearItems,
        mockLoadHistory,
        mockRefreshStatic,
        mockSetShowHelp,
        mockOnDebugMessage,
        mockOpenThemeDialog,
        mockOpenAuthDialog,
        mockOpenEditorDialog,
        mockOpenProviderDialog,
        mockOpenProviderModelDialog,
        mockPerformMemoryRefresh,
        mockSetQuittingMessages,
        mockOpenPrivacyNotice,
      ),
    );
  };

  describe('Command Loading', () => {
    it('should load builtin and file commands', async () => {
      const builtinCommand = createTestCommand({ name: 'builtin' });
      const fileCommand = createTestCommand({ name: 'file' });

      const { result } = setupProcessorHook([builtinCommand], [fileCommand]);

      await waitFor(() => {
        expect(result.current.slashCommands).toHaveLength(2);
      });

      expect(result.current.slashCommands).toContainEqual(
        expect.objectContaining({ name: 'builtin' }),
      );
      expect(result.current.slashCommands).toContainEqual(
        expect.objectContaining({ name: 'file' }),
      );
    });

    it('should handle deduplication with file commands overriding builtin', async () => {
      const builtinCommand = createTestCommand({
        name: 'test',
        description: 'Builtin version',
      });
      const fileCommand = createTestCommand({
        name: 'test',
        description: 'File version',
      });

      const { result } = setupProcessorHook([builtinCommand], [fileCommand]);

      await waitFor(() => {
        expect(result.current.slashCommands).toHaveLength(1);
      });

      expect(result.current.slashCommands[0]).toMatchObject({
        name: 'test',
        description: 'File version',
      });
    });
  });

  describe('Command Execution', () => {
    it('should execute a simple command', async () => {
      const mockAction = vi.fn().mockResolvedValue({
        type: 'message',
        messageType: 'info',
        content: 'Command executed',
      });

      const testCommand = createTestCommand({
        name: 'test',
        action: mockAction,
      });

      const { result } = setupProcessorHook([testCommand]);

      await waitFor(() => {
        expect(result.current.slashCommands).toHaveLength(1);
      });

      const commandResult = await result.current.handleSlashCommand('/test');

      expect(mockAddItem).toHaveBeenCalledWith(
        { type: MessageType.USER, text: '/test' },
        expect.any(Number),
      );

      expect(mockAction).toHaveBeenCalledWith(
        expect.objectContaining({
          invocation: {
            raw: '/test',
            name: 'test',
            args: '',
          },
        }),
        '',
      );

      expect(commandResult).toEqual({ type: 'handled' });
    });

    it('should handle command with arguments', async () => {
      const mockAction = vi.fn();
      const testCommand = createTestCommand({
        name: 'echo',
        action: mockAction,
      });

      const { result } = setupProcessorHook([testCommand]);

      await waitFor(() => {
        expect(result.current.slashCommands).toHaveLength(1);
      });

      await result.current.handleSlashCommand('/echo hello world');

      expect(mockAction).toHaveBeenCalledWith(
        expect.objectContaining({
          invocation: {
            raw: '/echo hello world',
            name: 'echo',
            args: 'hello world',
          },
        }),
        'hello world',
      );
    });

    it('should handle unknown commands', async () => {
      const { result } = setupProcessorHook([]);

      await waitFor(() => {
        expect(result.current.slashCommands).toHaveLength(0);
      });

      const commandResult = await result.current.handleSlashCommand('/unknown');

      expect(mockAddItem).toHaveBeenCalledWith(
        {
          type: MessageType.ERROR,
          text: 'Unknown command: /unknown',
        },
        expect.any(Number),
      );

      expect(commandResult).toEqual({ type: 'handled' });
    });

    it('should return false for non-command input', async () => {
      const { result } = setupProcessorHook([]);

      const commandResult =
        await result.current.handleSlashCommand('not a command');

      expect(commandResult).toBe(false);
      expect(mockAddItem).not.toHaveBeenCalled();
    });
  });

  describe('Dialog Commands', () => {
    it('should open help dialog', async () => {
      const helpCommand = createTestCommand({
        name: 'help',
        action: () => ({ type: 'dialog', dialog: 'help' }),
      });

      const { result } = setupProcessorHook([helpCommand]);

      await waitFor(() => {
        expect(result.current.slashCommands).toHaveLength(1);
      });

      await result.current.handleSlashCommand('/help');

      expect(mockSetShowHelp).toHaveBeenCalledWith(true);
    });

    it('should open auth dialog', async () => {
      const authCommand = createTestCommand({
        name: 'auth',
        action: () => ({ type: 'dialog', dialog: 'auth' }),
      });

      const { result } = setupProcessorHook([authCommand]);

      await waitFor(() => {
        expect(result.current.slashCommands).toHaveLength(1);
      });

      await result.current.handleSlashCommand('/auth');

      expect(mockOpenAuthDialog).toHaveBeenCalled();
    });
  });

  describe('Special Command Actions', () => {
    it('should handle quit command', async () => {
      const quitCommand = createTestCommand({
        name: 'quit',
        action: () => ({
          type: 'quit',
          messages: [{ id: '1', type: 'quit', duration: '1s' }],
        }),
      });

      const { result } = setupProcessorHook([quitCommand]);

      await waitFor(() => {
        expect(result.current.slashCommands).toHaveLength(1);
      });

      await act(async () => {
        await result.current.handleSlashCommand('/quit');
      });

      expect(mockSetQuittingMessages).toHaveBeenCalledWith([
        { id: '1', type: 'quit', duration: '1s' },
      ]);

      await waitFor(() => {
        expect(mockProcessExit).toHaveBeenCalledWith(0);
      });
    });

    it('should handle tool scheduling', async () => {
      const toolCommand = createTestCommand({
        name: 'tool',
        action: () => ({
          type: 'tool',
          toolName: 'test_tool',
          toolArgs: { arg: 'value' },
        }),
      });

      const { result } = setupProcessorHook([toolCommand]);

      await waitFor(() => {
        expect(result.current.slashCommands).toHaveLength(1);
      });

      const commandResult = await result.current.handleSlashCommand('/tool');

      expect(commandResult).toEqual({
        type: 'schedule_tool',
        toolName: 'test_tool',
        toolArgs: { arg: 'value' },
      });
    });

    it('should handle submit prompt', async () => {
      const submitCommand = createTestCommand({
        name: 'submit',
        action: () => ({
          type: 'submit_prompt',
          content: 'Generated prompt',
        }),
      });

      const { result } = setupProcessorHook([submitCommand]);

      await waitFor(() => {
        expect(result.current.slashCommands).toHaveLength(1);
      });

      const commandResult = await result.current.handleSlashCommand('/submit');

      expect(commandResult).toEqual({
        type: 'submit_prompt',
        content: 'Generated prompt',
      });
    });
  });

  describe('Subcommands', () => {
    it('should execute subcommands', async () => {
      const subAction = vi.fn().mockResolvedValue({
        type: 'message',
        messageType: 'info',
        content: 'Subcommand executed',
      });

      const parentCommand = createTestCommand({
        name: 'parent',
        subCommands: [
          createTestCommand({
            name: 'sub',
            action: subAction,
          }),
        ],
      });

      const { result } = setupProcessorHook([parentCommand]);

      await waitFor(() => {
        expect(result.current.slashCommands).toHaveLength(1);
      });

      await result.current.handleSlashCommand('/parent sub arg1 arg2');

      expect(subAction).toHaveBeenCalledWith(
        expect.objectContaining({
          invocation: {
            raw: '/parent sub arg1 arg2',
            name: 'sub',
            args: 'arg1 arg2',
          },
        }),
        'arg1 arg2',
      );
    });

    it('should show help for parent command without subcommand', async () => {
      const parentCommand: SlashCommand = {
        name: 'parent',
        description: 'a parent command',
        kind: CommandKind.BUILT_IN,
        subCommands: [
          {
            name: 'child1',
            description: 'First child.',
            kind: CommandKind.BUILT_IN,
          }
        ],
      };
      const { result } = setupProcessorHook([parentCommand]);
      await waitFor(() => expect(result.current.slashCommands).toHaveLength(1));

      await act(async () => {
        await result.current.handleSlashCommand('/parent');
      });

      expect(mockAddItem).toHaveBeenCalledTimes(2);
      expect(mockAddItem).toHaveBeenLastCalledWith(
        {
          type: MessageType.INFO,
          text: expect.stringContaining("Command '/parent' requires a subcommand."),
        },
        expect.any(Number)
      );
    });
  });

  describe('Alias Support', () => {
    it('should execute command using alias', async () => {
      const mockAction = vi.fn();
      const aliasCommand = createTestCommand({
        name: 'status',
        altNames: ['s', 'stat'],
        action: mockAction,
      });

      const { result } = setupProcessorHook([aliasCommand]);

      await waitFor(() => {
        expect(result.current.slashCommands).toHaveLength(1);
      });

      await result.current.handleSlashCommand('/s');

      expect(mockAction).toHaveBeenCalledWith(
        expect.objectContaining({
          invocation: {
            raw: '/s',
            name: 'status',
            args: '',
          },
        }),
        '',
      );
    });
  });
});
