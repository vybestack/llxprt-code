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
  TrackedExecutingToolCall,
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

  it('should handle all tool calls being cancelled', async () => {
    const cancelledToolCalls: TrackedToolCall[] = [
      {
        request: {
          callId: '1',
          name: 'testTool',
          args: {},
          isClientInitiated: false,
          prompt_id: 'prompt-id-3',
        },
        status: 'cancelled',
        response: {
          callId: '1',
          responseParts: [{ text: 'cancelled' }],
          errorType: undefined, // FIX: Added missing property
        },
        displayCleared: false,
        tool: {
          displayName: 'mock tool',
        },
        invocation: {
          getDescription: () => `Mock description`,
        } as unknown as AnyToolInvocation,
      } as TrackedCancelledToolCall,
    ];
    const client = new MockedAgentClientClass(mockConfig);

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
        client,
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

    // Trigger the onComplete callback with cancelled tools
    await act(async () => {
      if (capturedOnComplete) {
        await capturedOnComplete(Symbol('test-scheduler'), cancelledToolCalls, {
          isPrimary: true,
        });
      }
    });

    await waitFor(() => {
      expect(mockMarkToolsAsDisplayCleared).toHaveBeenCalledWith(['1']);
      expect(client.addHistory).toHaveBeenCalledWith({
        role: 'user',
        parts: [{ text: 'cancelled' }],
      });
      // Ensure we do NOT call back to the API
      expect(mockSendMessageStream).not.toHaveBeenCalled();
    });
  });

  it('should group multiple cancelled tool call responses into a single history entry', async () => {
    const cancelledToolCall1: TrackedCancelledToolCall = {
      request: {
        callId: 'cancel-1',
        name: 'toolA',
        args: {},
        isClientInitiated: false,
        prompt_id: 'prompt-id-7',
      },
      tool: {
        name: 'toolA',
        displayName: 'toolA',
        description: 'descA',
        build: vi.fn(),
      } as unknown as AnyDeclarativeTool,
      invocation: {
        getDescription: () => `Mock description`,
      } as unknown as AnyToolInvocation,
      status: 'cancelled',
      response: {
        callId: 'cancel-1',
        responseParts: [
          { functionResponse: { name: 'toolA', id: 'cancel-1' } },
        ],
        resultDisplay: undefined,
        error: undefined,
        errorType: undefined, // FIX: Added missing property
      },
      displayCleared: false,
    };
    const cancelledToolCall2: TrackedCancelledToolCall = {
      request: {
        callId: 'cancel-2',
        name: 'toolB',
        args: {},
        isClientInitiated: false,
        prompt_id: 'prompt-id-8',
      },
      tool: {
        name: 'toolB',
        displayName: 'toolB',
        description: 'descB',
        build: vi.fn(),
      } as unknown as AnyDeclarativeTool,
      invocation: {
        getDescription: () => `Mock description`,
      } as unknown as AnyToolInvocation,
      status: 'cancelled',
      response: {
        callId: 'cancel-2',
        responseParts: [
          { functionResponse: { name: 'toolB', id: 'cancel-2' } },
        ],
        resultDisplay: undefined,
        error: undefined,
        errorType: undefined, // FIX: Added missing property
      },
      displayCleared: false,
    };
    const allCancelledTools = [cancelledToolCall1, cancelledToolCall2];
    const client = new MockedAgentClientClass(mockConfig);

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
        client,
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

    // Trigger the onComplete callback with multiple cancelled tools
    await act(async () => {
      if (capturedOnComplete) {
        await capturedOnComplete(Symbol('test-scheduler'), allCancelledTools, {
          isPrimary: true,
        });
      }
    });

    await waitFor(() => {
      // The tools should be marked as display-cleared locally
      expect(mockMarkToolsAsDisplayCleared).toHaveBeenCalledWith([
        'cancel-1',
        'cancel-2',
      ]);

      // Crucially, addHistory should be called only ONCE
      expect(client.addHistory).toHaveBeenCalledTimes(1);

      // And that single call should contain BOTH function responses
      expect(client.addHistory).toHaveBeenCalledWith({
        role: 'user',
        parts: [
          ...cancelledToolCall1.response.responseParts,
          ...cancelledToolCall2.response.responseParts,
        ],
      });

      // No message should be sent back to the API for a turn with only cancellations
      expect(mockSendMessageStream).not.toHaveBeenCalled();
    });
  });

  it('should not flicker streaming state to Idle between tool completion and submission', async () => {
    const toolCallResponseParts: PartListUnion = [
      { text: 'tool 1 final response' },
    ];

    const initialToolCalls: TrackedToolCall[] = [
      {
        request: {
          callId: 'call1',
          name: 'tool1',
          args: {},
          isClientInitiated: false,
          prompt_id: 'prompt-id-4',
        },
        status: 'executing',
        displayCleared: false,
        tool: {
          name: 'tool1',
          displayName: 'tool1',
          description: 'desc',
          build: vi.fn(),
        } as unknown as AnyDeclarativeTool,
        invocation: {
          getDescription: () => `Mock description`,
        } as unknown as AnyToolInvocation,
        startTime: Date.now(),
      } as TrackedExecutingToolCall,
    ];

    const completedToolCalls: TrackedToolCall[] = [
      {
        ...(initialToolCalls[0] as TrackedExecutingToolCall),
        status: 'success',
        response: {
          callId: 'call1',
          responseParts: toolCallResponseParts,
          error: undefined,
          errorType: undefined, // FIX: Added missing property
          resultDisplay: 'Tool 1 success display',
        },
        endTime: Date.now(),
      } as TrackedCompletedToolCall,
    ];

    // Capture the onComplete callback
    let capturedOnComplete:
      | ((
          schedulerId: symbol,
          completedTools: TrackedToolCall[],
          metadata: { isPrimary: boolean },
        ) => Promise<void>)
      | null = null;
    let currentToolCalls = initialToolCalls;

    mockUseReactToolScheduler.mockImplementation((onComplete) => {
      capturedOnComplete = onComplete;
      return [
        currentToolCalls,
        mockScheduleToolCalls,
        mockMarkToolsAsDisplayCleared,
        mockCancelAllToolCalls,
        0,
        true,
      ];
    });

    const { result, rerender } = renderHook(() =>
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

    // 1. Initial state should be Responding because a tool is executing.
    expect(result.current.streamingState).toBe(StreamingState.Responding);

    // 2. Update the tool calls to completed state and rerender
    currentToolCalls = completedToolCalls;
    mockUseReactToolScheduler.mockImplementation((onComplete) => {
      capturedOnComplete = onComplete;
      return [
        completedToolCalls,
        mockScheduleToolCalls,
        mockMarkToolsAsDisplayCleared,
        mockCancelAllToolCalls,
        0,
        true,
      ];
    });

    act(() => {
      rerender();
    });

    // 3. The state should *still* be Responding, not Idle.
    // This is because the completed tool has not yet been cleared from the
    // display (displayCleared is still false), so it remains outstanding.
    expect(result.current.streamingState).toBe(StreamingState.Responding);

    // 4. Trigger the onComplete callback to simulate tool completion
    await act(async () => {
      if (capturedOnComplete) {
        await capturedOnComplete(Symbol('test-scheduler'), completedToolCalls, {
          isPrimary: true,
        });
      }
    });

    // 5. Wait for submitQuery to be called
    await waitFor(() => {
      expect(mockSendMessageStream).toHaveBeenCalledWith(
        toolCallResponseParts,
        expect.any(AbortSignal),
        'prompt-id-4',
      );
    });

    // 6. After submission, the state should remain Responding until the stream completes.
    expect(result.current.streamingState).toBe(StreamingState.Responding);
  });
});
