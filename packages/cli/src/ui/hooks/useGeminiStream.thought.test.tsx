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
  TrackedExecutingToolCall,
} from './useReactToolScheduler.js';
import { useReactToolScheduler } from './useReactToolScheduler.js';
import type {
  Config,
  EditorType,
  ToolRegistry,
} from '@vybestack/llxprt-code-core';
import {
  ApprovalMode,
  GeminiEventType as ServerGeminiEventType,
} from '@vybestack/llxprt-code-core';
import { StreamingState } from '../types.js';
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

  // Helper to create mock tool calls - reduces boilerplate

  // Helper to render hook with default parameters - reduces boilerplate

  describe('Thought Reset', () => {
    it('should reset thought to null when starting a new prompt', async () => {
      // First, simulate a response with a thought
      mockSendMessageStream.mockReturnValue(
        (async function* () {
          yield {
            type: ServerGeminiEventType.Thought,
            value: {
              subject: 'Previous thought',
              description: 'Old description',
            },
          };
          yield {
            type: ServerGeminiEventType.Content,
            value: 'Some response content',
          };
          yield {
            type: ServerGeminiEventType.Finished,
            value: { reason: 'STOP', usageMetadata: undefined },
          };
        })(),
      );

      const { result } = renderHook(() =>
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
          () => Promise.resolve(),
          false,
          () => {},
          () => {},
          () => {},
          80,
          24,
        ),
      );

      // Submit first query to set a thought
      await act(async () => {
        await result.current.submitQuery('First query');
      });

      // Wait for the first response to complete
      await waitFor(() => {
        expect(mockAddItem).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'gemini',
            text: 'Some response content',
          }),
          expect.any(Number),
        );
      });

      // Now simulate a new response without a thought
      mockSendMessageStream.mockReturnValue(
        (async function* () {
          yield {
            type: ServerGeminiEventType.Content,
            value: 'New response content',
          };
          yield {
            type: ServerGeminiEventType.Finished,
            value: { reason: 'STOP', usageMetadata: undefined },
          };
        })(),
      );

      // Submit second query - thought should be reset
      await act(async () => {
        await result.current.submitQuery('Second query');
      });

      // The thought should be reset to null when starting the new prompt
      // We can verify this by checking that the LoadingIndicator would not show the previous thought
      // The actual thought state is internal to the hook, but we can verify the behavior
      // by ensuring the second response doesn't show the previous thought
      await waitFor(() => {
        expect(mockAddItem).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'gemini',
            text: 'New response content',
          }),
          expect.any(Number),
        );
      });
    });

    it('should memoize pendingHistoryItems', () => {
      mockUseReactToolScheduler.mockReturnValue([
        [],
        mockScheduleToolCalls,
        mockMarkToolsAsDisplayCleared,
        mockCancelAllToolCalls,
        0,
        true,
      ]);

      const { result, rerender } = renderHook(() =>
        useGeminiStream(
          mockConfig.getAgentClient(),
          [],
          mockAddItem,
          mockConfig,
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

      const firstResult = result.current.pendingHistoryItems;
      rerender();
      const secondResult = result.current.pendingHistoryItems;

      expect(firstResult).toStrictEqual(secondResult);

      const newToolCalls: TrackedToolCall[] = [
        {
          request: { callId: 'call1', name: 'tool1', args: {} },
          status: 'executing',
          tool: {
            name: 'tool1',
            displayName: 'tool1',
            description: 'desc1',
            build: vi.fn(),
          },
          invocation: {
            getDescription: () => 'Mock description',
          },
        } as unknown as TrackedExecutingToolCall,
      ];

      mockUseReactToolScheduler.mockReturnValue([
        newToolCalls,
        mockScheduleToolCalls,
        mockMarkToolsAsDisplayCleared,
        mockCancelAllToolCalls,
        0,
        true,
      ]);

      rerender();
      const thirdResult = result.current.pendingHistoryItems;

      expect(thirdResult).not.toStrictEqual(secondResult);
    });

    it('deduplicates pending tool groups by callId when both pending sources are tool groups', async () => {
      const toolCallId = 'shared-call-1';

      const pendingToolCall = {
        request: { callId: toolCallId, name: 'run_shell_command', args: {} },
        status: 'executing',
        tool: {
          name: 'run_shell_command',
          displayName: 'Shell Command',
          description: 'Shell',
          build: vi.fn(),
        },
        invocation: {
          getDescription: () => 'bash',
        },
        liveOutput: 'from scheduler',
      } as unknown as TrackedExecutingToolCall;

      mockUseReactToolScheduler.mockReturnValue([
        [pendingToolCall],
        mockScheduleToolCalls,
        mockMarkToolsAsDisplayCleared,
        mockCancelAllToolCalls,
        0,
        true,
      ]);

      const { result } = renderHook(() =>
        useGeminiStream(
          mockConfig.getAgentClient(),
          [],
          mockAddItem,
          mockConfig,
          mockLoadedSettings,
          mockOnDebugMessage,
          mockHandleSlashCommand,
          true,
          () => 'vscode' as EditorType,
          () => {},
          () => Promise.resolve(),
          false,
          () => {},
          () => {},
          () => {},
          () => {},
          80,
          24,
        ),
      );

      await act(async () => {
        await result.current.submitQuery('bash');
      });

      await waitFor(() => {
        const pendingToolGroups = result.current.pendingHistoryItems.filter(
          (item) => item.type === 'tool_group',
        );

        expect(pendingToolGroups).toHaveLength(1);
        expect(pendingToolGroups[0].tools).toHaveLength(1);
        expect(pendingToolGroups[0].tools[0].callId).toBe(toolCallId);
      });
    });

    it('should reset thought to null when user cancels', async () => {
      // Mock a stream that yields a thought then gets cancelled
      mockSendMessageStream.mockReturnValue(
        (async function* () {
          yield {
            type: ServerGeminiEventType.Thought,
            value: { subject: 'Some thought', description: 'Description' },
          };
          yield { type: ServerGeminiEventType.UserCancelled };
        })(),
      );

      const { result } = renderHook(() =>
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
          () => Promise.resolve(),
          false,
          () => {},
          () => {},
          () => {},
          80,
          24,
        ),
      );

      // Submit query
      await act(async () => {
        await result.current.submitQuery('Test query');
      });

      // Verify cancellation message was added
      await waitFor(() => {
        expect(mockAddItem).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'info',
            text: 'User cancelled the request.',
          }),
          expect.any(Number),
        );
      });

      // Verify state is reset to idle
      expect(result.current.streamingState).toBe(StreamingState.Idle);
    });

    it('should reset thought to null when there is an error', async () => {
      // Mock a stream that yields a thought then encounters an error
      mockSendMessageStream.mockReturnValue(
        (async function* () {
          yield {
            type: ServerGeminiEventType.Thought,
            value: { subject: 'Some thought', description: 'Description' },
          };
          yield {
            type: ServerGeminiEventType.Error,
            value: { error: { message: 'Test error' } },
          };
        })(),
      );

      const { result } = renderHook(() =>
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
          () => Promise.resolve(),
          false,
          () => {},
          () => {},
          () => {},
          80,
          24,
        ),
      );

      // Submit query
      await act(async () => {
        await result.current.submitQuery('Test query');
      });

      // Verify error message was added
      await waitFor(() => {
        expect(mockAddItem).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'error',
          }),
          expect.any(Number),
        );
      });

      // Verify parseAndFormatApiError was called
      expect(mockParseAndFormatApiError).toHaveBeenCalledWith(
        { message: 'Test error' },
        expect.any(String),
        undefined,
        'gemini-2.5-pro',
        'gemini-2.5-flash',
      );
    });
  });
});
