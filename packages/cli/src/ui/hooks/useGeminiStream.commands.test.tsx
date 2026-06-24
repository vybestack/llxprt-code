/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** @vitest-environment jsdom */

import type { Mock } from 'vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { renderHook } from '../../test-utils/render.js';
import { waitFor } from '../../test-utils/async.js';
import { useGeminiStream } from './geminiStream/index.js';
import * as atCommandProcessor from './atCommandProcessor.js';
import type {
  TrackedToolCall,
  TrackedCompletedToolCall,
  TrackedCancelledToolCall,
} from './useReactToolScheduler.js';
import { useReactToolScheduler } from './useReactToolScheduler.js';
import type {
  Config,
  EditorType,
  AnyToolInvocation,
  AnyDeclarativeTool,
  ToolRegistry,
} from '@vybestack/llxprt-code-core';
import { ApprovalMode } from '@vybestack/llxprt-code-core';
import type { PartListUnion } from '@google/genai';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';
import type { SlashCommandProcessorResult } from '../types.js';
import type { LoadedSettings } from '../../config/settings.js';

// --- MOCKS ---
const mockSendMessageStream = vi
  .fn()
  .mockReturnValue((async function* () {})());
const mockStartChat = vi.fn();

const MockedAgentClientClass = vi.hoisted(() =>
  vi.fn().mockImplementation(function (
    this: Record<string, unknown>,
    _config: unknown,
  ) {
    // _config
    this.startChat = mockStartChat;
    this.sendMessageStream = mockSendMessageStream;
    this.addHistory = vi.fn();
    this.getChat = vi.fn().mockReturnValue({
      recordCompletedToolCalls: vi.fn(),
    });
  }),
);

const MockedUserPromptEvent = vi.hoisted(() =>
  vi.fn().mockImplementation(() => {}),
);
const mockParseAndFormatApiError = vi.hoisted(() => vi.fn());

vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const actualCoreModule = await importOriginal<Record<string, unknown>>();
  return {
    ...actualCoreModule,
    GitService: vi.fn(),
    AgentClient: MockedAgentClientClass,
    UserPromptEvent: MockedUserPromptEvent,
    parseAndFormatApiError: mockParseAndFormatApiError,
    tokenLimit: vi.fn().mockReturnValue(100), // Mock tokenLimit
  };
});

const mockUseReactToolScheduler = useReactToolScheduler as Mock;
vi.mock('./useReactToolScheduler.js', async (importOriginal) => {
  const actualSchedulerModule = await importOriginal<Record<string, unknown>>();
  return {
    ...actualSchedulerModule,
    useReactToolScheduler: vi.fn(),
  };
});

vi.mock('./useKeypress.js', () => ({
  useKeypress: vi.fn(),
}));

vi.mock('./shellCommandProcessor.js', () => ({
  useShellCommandProcessor: vi.fn().mockReturnValue({
    handleShellCommand: vi.fn(),
  }),
}));

vi.mock('./atCommandProcessor.js');

vi.mock('../utils/markdownUtilities.js', () => ({
  findLastSafeSplitPoint: vi.fn((s: string) => s.length),
}));

vi.mock('./useStateAndRef.js', () => ({
  useStateAndRef: vi.fn((initial) => {
    let val = initial;
    const ref = { current: val };
    const setVal = vi.fn((updater) => {
      if (typeof updater === 'function') {
        val = updater(val);
      } else {
        val = updater;
      }
      ref.current = val;
    });
    return [val, ref, setVal];
  }),
}));

vi.mock('./useLogger.js', () => ({
  useLogger: vi.fn().mockReturnValue({
    logMessage: vi.fn().mockResolvedValue(undefined),
  }),
}));

const mockStartNewPrompt = vi.fn();
const mockAddUsage = vi.fn();
vi.mock('../contexts/SessionContext.js', () => ({
  useSessionStats: vi.fn(() => ({
    startNewPrompt: mockStartNewPrompt,
    addUsage: mockAddUsage,
    getPromptCount: vi.fn(() => 5),
  })),
}));

vi.mock('./slashCommandProcessor.js', () => ({
  handleSlashCommand: vi.fn().mockReturnValue(false),
}));

// --- END MOCKS ---

// --- Tests for useGeminiStream Hook ---
describe('useGeminiStream', () => {
  let mockAddItem: Mock;
  let mockConfig: Config;
  let mockOnDebugMessage: Mock;
  let mockHandleSlashCommand: Mock;
  let mockScheduleToolCalls: Mock;
  let mockCancelAllToolCalls: Mock;
  let mockMarkToolsAsDisplayCleared: Mock;

  beforeEach(() => {
    vi.clearAllMocks(); // Clear mocks before each test

    mockAddItem = vi.fn();
    // Define the mock for getAgentClient
    const _mockGetAgentClient = vi.fn().mockImplementation(() => {
      // MockedAgentClientClass is defined in the module scope by the previous change.
      // It will use the mockStartChat and mockSendMessageStream that are managed within beforeEach.
      const clientInstance = new MockedAgentClientClass(mockConfig);
      return clientInstance;
    });

    const contentGeneratorConfig = {
      model: 'test-model',
      apiKey: 'test-key',
      vertexai: false,
    };

    mockConfig = {
      apiKey: 'test-api-key',
      model: 'gemini-pro',
      sandbox: false,
      targetDir: '/test/dir',
      debugMode: false,
      question: undefined,

      coreTools: [],
      toolDiscoveryCommand: undefined,
      toolCallCommand: undefined,
      mcpServerCommand: undefined,
      mcpServers: undefined,
      userAgent: 'test-agent',
      userMemory: '',
      geminiMdFileCount: 0,
      alwaysSkipModificationConfirmation: false,
      vertexai: false,
      showMemoryUsage: false,
      contextFileName: undefined,
      getToolRegistry: vi.fn(
        () =>
          ({ getToolSchemaList: vi.fn(() => []) }) as unknown as ToolRegistry,
      ),
      getProjectRoot: vi.fn(() => '/test/dir'),
      getCheckpointingEnabled: vi.fn(() => false),
      getApprovalMode: () => ApprovalMode.DEFAULT,
      getUsageStatisticsEnabled: () => true,
      getDebugMode: () => false,
      addHistory: vi.fn(),
      getSessionId() {
        return 'test-session-id';
      },
      setQuotaErrorOccurred: vi.fn(),
      getQuotaErrorOccurred: vi.fn(() => false),
      getModel: vi.fn(() => 'gemini-2.5-pro'),
      getContentGeneratorConfig: vi
        .fn()
        .mockReturnValue(contentGeneratorConfig),
      getUseSmartEdit: () => false,
      getUseModelRouter: () => false,
    } as unknown as Config;
    mockOnDebugMessage = vi.fn();
    mockHandleSlashCommand = vi.fn().mockResolvedValue(false);

    // Mock return value for useReactToolScheduler
    mockScheduleToolCalls = vi.fn();
    mockCancelAllToolCalls = vi.fn();
    mockMarkToolsAsDisplayCleared = vi.fn();

    // Default mock for useReactToolScheduler to prevent toolCalls being undefined initially
    mockUseReactToolScheduler.mockReturnValue([
      [], // Default to empty array for toolCalls
      mockScheduleToolCalls,
      mockMarkToolsAsDisplayCleared,
      mockCancelAllToolCalls,
      0,
      true,
    ]);

    // Reset mocks for AgentClient instance methods (startChat and sendMessageStream)
    // The AgentClient constructor itself is mocked at the module level.
    mockStartChat.mockClear().mockResolvedValue({
      sendMessageStream: mockSendMessageStream,
    } as unknown as Awaited<ReturnType<typeof mockStartChat>>);
    mockSendMessageStream
      .mockClear()
      .mockReturnValue((async function* () {})());
    vi.spyOn(atCommandProcessor, 'handleAtCommand');
  });

  const mockLoadedSettings: LoadedSettings = {
    merged: { preferredEditor: 'vscode' },
    user: { path: '/user/settings.json', settings: {} },
    workspace: { path: '/workspace/.gemini/settings.json', settings: {} },
    errors: [],
    forScope: vi.fn(),
    setValue: vi.fn(),
  } as unknown as LoadedSettings;

  const renderTestHook = (
    initialToolCalls: TrackedToolCall[] = [],
    agentClient?: unknown,
  ) => {
    const client = agentClient ?? mockConfig.getAgentClient();

    const initialProps = {
      client,
      history: [],
      addItem: mockAddItem as unknown as UseHistoryManagerReturn['addItem'],
      config: mockConfig,
      onDebugMessage: mockOnDebugMessage,
      handleSlashCommand: mockHandleSlashCommand as unknown as (
        cmd: PartListUnion,
      ) => Promise<SlashCommandProcessorResult | false>,
      shellModeActive: false,
      loadedSettings: mockLoadedSettings,
      toolCalls: initialToolCalls,
    };

    const { result, rerender } = renderHook(
      (props: typeof initialProps) => {
        // Create a stateful mock for cancellation that updates the toolCalls state.
        const statefulCancelAllToolCalls = vi.fn((...args) => {
          // Call the original spy so `toHaveBeenCalled` checks still work.
          mockCancelAllToolCalls(...args);

          const newToolCalls = props.toolCalls.map((tc) => {
            // Only cancel tools that are in a cancellable state.
            if (
              tc.status === 'awaiting_approval' ||
              tc.status === 'executing' ||
              tc.status === 'scheduled' ||
              tc.status === 'validating'
            ) {
              // A real cancelled tool call has a response object.
              // We need to simulate this to avoid type errors downstream.
              return {
                ...tc,
                status: 'cancelled',
                response: {
                  callId: tc.request.callId,
                  responseParts: [],
                  resultDisplay: 'Request cancelled.',
                },
                displayCleared: true, // Cleared from display
              } as unknown as TrackedCancelledToolCall;
            }
            return tc;
          });
          rerender({ ...props, toolCalls: newToolCalls });
        });

        mockUseReactToolScheduler.mockImplementation(() => [
          props.toolCalls,
          mockScheduleToolCalls,
          mockMarkToolsAsDisplayCleared,
          statefulCancelAllToolCalls, // Use the stateful mock
          0,
          true,
        ]);

        return useGeminiStream(
          props.client,
          props.history,
          props.addItem,
          props.config,
          props.loadedSettings,
          props.onDebugMessage,
          props.handleSlashCommand,
          props.shellModeActive,
          () => 'vscode' as EditorType,
          () => {},
          () => Promise.resolve(),
          false,
          () => {},
          () => {},
          () => {},
          80,
          24,
        );
      },
      {
        initialProps,
      },
    );
    return {
      result,
      rerender,
      mockMarkToolsAsDisplayCleared,
      mockSendMessageStream,
      client,
    };
  };

  // Helper to create mock tool calls - reduces boilerplate

  // Helper to render hook with default parameters - reduces boilerplate

  describe('Slash Command Handling', () => {
    it('should schedule a tool call when the command processor returns a schedule_tool action', async () => {
      const clientToolRequest: SlashCommandProcessorResult = {
        type: 'schedule_tool',
        toolName: 'save_memory',
        toolArgs: { fact: 'test fact' },
      };
      mockHandleSlashCommand.mockResolvedValue(clientToolRequest);

      const { result } = renderTestHook();

      await act(async () => {
        await result.current.submitQuery('/memory add "test fact"');
      });

      await waitFor(() => {
        expect(mockScheduleToolCalls).toHaveBeenCalledWith(
          [
            expect.objectContaining({
              name: 'save_memory',
              args: { fact: 'test fact' },
              isClientInitiated: true,
            }),
          ],
          expect.any(AbortSignal),
        );
        expect(mockSendMessageStream).not.toHaveBeenCalled();
      });
    });

    it('should stop processing and not call Gemini when a command is handled without a tool call', async () => {
      const uiOnlyCommandResult: SlashCommandProcessorResult = {
        type: 'handled',
      };
      mockHandleSlashCommand.mockResolvedValue(uiOnlyCommandResult);

      const { result } = renderTestHook();

      await act(async () => {
        await result.current.submitQuery('/help');
      });

      await waitFor(() => {
        expect(mockHandleSlashCommand).toHaveBeenCalledWith('/help');
        expect(mockScheduleToolCalls).not.toHaveBeenCalled();
        expect(mockSendMessageStream).not.toHaveBeenCalled(); // No LLM call made
      });
    });

    it('should call Gemini with prompt content when slash command returns a `submit_prompt` action', async () => {
      const customCommandResult: SlashCommandProcessorResult = {
        type: 'submit_prompt',
        content: 'This is the actual prompt from the command file.',
      };
      mockHandleSlashCommand.mockResolvedValue(customCommandResult);

      const { result, mockSendMessageStream: localMockSendMessageStream } =
        renderTestHook();

      await act(async () => {
        await result.current.submitQuery('/my-custom-command');
      });

      await waitFor(() => {
        expect(mockHandleSlashCommand).toHaveBeenCalledWith(
          '/my-custom-command',
        );

        expect(localMockSendMessageStream).not.toHaveBeenCalledWith(
          '/my-custom-command',
          expect.anything(),
          expect.anything(),
        );

        expect(localMockSendMessageStream).toHaveBeenCalledWith(
          'This is the actual prompt from the command file.',
          expect.any(AbortSignal),
          expect.any(String),
        );

        expect(mockScheduleToolCalls).not.toHaveBeenCalled();
      });
    });

    it('should correctly handle a submit_prompt action with empty content', async () => {
      const emptyPromptResult: SlashCommandProcessorResult = {
        type: 'submit_prompt',
        content: '',
      };
      mockHandleSlashCommand.mockResolvedValue(emptyPromptResult);

      const { result, mockSendMessageStream: localMockSendMessageStream } =
        renderTestHook();

      await act(async () => {
        await result.current.submitQuery('/emptycmd');
      });

      await waitFor(() => {
        expect(mockHandleSlashCommand).toHaveBeenCalledWith('/emptycmd');
        expect(localMockSendMessageStream).toHaveBeenCalledWith(
          '',
          expect.any(AbortSignal),
          expect.any(String),
        );
      });
    });

    it('should not call handleSlashCommand for line comments', async () => {
      const { result, mockSendMessageStream: localMockSendMessageStream } =
        renderTestHook();

      await act(async () => {
        await result.current.submitQuery('// This is a line comment');
      });

      await waitFor(() => {
        expect(mockHandleSlashCommand).not.toHaveBeenCalled();
        expect(localMockSendMessageStream).toHaveBeenCalledWith(
          '// This is a line comment',
          expect.any(AbortSignal),
          expect.any(String),
        );
      });
    });

    it('should not call handleSlashCommand for block comments', async () => {
      const { result, mockSendMessageStream: localMockSendMessageStream } =
        renderTestHook();

      await act(async () => {
        await result.current.submitQuery('/* This is a block comment */');
      });

      await waitFor(() => {
        expect(mockHandleSlashCommand).not.toHaveBeenCalled();
        expect(localMockSendMessageStream).toHaveBeenCalledWith(
          '/* This is a block comment */',
          expect.any(AbortSignal),
          expect.any(String),
        );
      });
    });

    it('should not call handleSlashCommand is shell mode is active', async () => {
      const { result } = renderHook(() =>
        useGeminiStream(
          new MockedAgentClientClass(mockConfig),
          [],
          mockAddItem,
          mockConfig,
          mockLoadedSettings,
          () => {},
          mockHandleSlashCommand,
          true,
          () => 'vscode' as EditorType,
          () => {},
          () => Promise.resolve(),
          false,
          () => {},
          () => {},
          () => {},
          80,
          24,
        ),
      );

      await act(async () => {
        await result.current.submitQuery('/about');
      });

      await waitFor(() => {
        expect(mockHandleSlashCommand).not.toHaveBeenCalled();
      });
    });
  });

  describe('Memory Refresh on save_memory', () => {
    it('should call performMemoryRefresh when a save_memory tool call completes successfully', async () => {
      const mockPerformMemoryRefresh = vi.fn();
      const completedToolCall: TrackedCompletedToolCall = {
        request: {
          callId: 'save-mem-call-1',
          name: 'save_memory',
          args: { fact: 'test' },
          isClientInitiated: true,
          prompt_id: 'prompt-id-6',
        },
        status: 'success',
        displayCleared: false,
        response: {
          callId: 'save-mem-call-1',
          responseParts: [{ text: 'Memory saved' }],
          resultDisplay: 'Success: Memory saved',
          error: undefined,
          errorType: undefined, // FIX: Added missing property
        },
        tool: {
          name: 'save_memory',
          displayName: 'save_memory',
          description: 'Saves memory',
          build: vi.fn(),
        } as unknown as AnyDeclarativeTool,
        invocation: {
          getDescription: () => `Mock description`,
        } as unknown as AnyToolInvocation,
      };

      // Capture the onComplete callback
      let capturedOnComplete:
        | ((
            schedulerId: symbol,
            completedTools: TrackedToolCall[],
            metadata: { isPrimary: boolean },
          ) => Promise<void>)
        | null = null;

      mockUseReactToolScheduler.mockImplementation((onComplete) => {
        capturedOnComplete = onComplete;
        return [
          [],
          mockScheduleToolCalls,
          mockMarkToolsAsDisplayCleared,
          mockCancelAllToolCalls,
          0,
          true,
        ];
      });

      renderHook(() =>
        useGeminiStream(
          new MockedAgentClientClass(mockConfig),
          [],
          mockAddItem,
          mockConfig,
          mockLoadedSettings,
          mockOnDebugMessage,
          mockHandleSlashCommand,
          false,
          () => 'vscode' as EditorType,
          () => {},
          mockPerformMemoryRefresh,
          false,
          () => {},
          () => {},
          () => {},
          80,
          24,
        ),
      );

      // Trigger the onComplete callback with the completed save_memory tool
      await act(async () => {
        if (capturedOnComplete) {
          await capturedOnComplete(
            Symbol('test-scheduler'),
            [completedToolCall],
            {
              isPrimary: true,
            },
          );
        }
      });

      await waitFor(() => {
        expect(mockPerformMemoryRefresh).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('Error Handling', () => {
    it('should call parseAndFormatApiError with the correct model on stream initialization failure', async () => {
      mockParseAndFormatApiError.mockClear();
      mockSendMessageStream.mockReturnValue(
        (async function* () {
          yield { type: 'content', value: '' };
          throw mockError;
        })(),
      );

      const testConfig = {
        ...mockConfig,
        getContentGeneratorConfig: vi.fn(() => ({})),
        getModel: vi.fn(() => 'gemini-2.5-pro'),
      } as unknown as Config;

      const { result } = renderHook(() =>
        useGeminiStream(
          new MockedAgentClientClass(testConfig),
          [],
          mockAddItem,
          testConfig,
          mockLoadedSettings,
          mockOnDebugMessage,
          mockHandleSlashCommand,
          false,
          () => 'vscode' as EditorType,
          () => {},
          () => Promise.resolve(),
          false,
          () => {},
          () => {},
          () => {},
          80,
          24,
        ),
      );

      // 2. Action
      await act(async () => {
        await result.current.submitQuery('test query');
      });

      // 3. Assertion
      await waitFor(() => {
        expect(mockParseAndFormatApiError).toHaveBeenCalledWith(
          'Rate limit exceeded',
          undefined,
          'gemini-2.5-pro',
          'gemini-2.5-flash',
        );
      });
    });
  });
});
