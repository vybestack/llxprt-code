/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Mock } from 'vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { renderHook, waitFor } from '../../test-utils/render.js';
import * as ReactDOM from 'react-dom';
import { useGeminiStream } from './geminiStream/index.js';
import type {
  TrackedCompletedToolCall,
  TrackedToolCall,
} from './useReactToolScheduler.js';
import { useReactToolScheduler } from './useReactToolScheduler.js';
import type {
  Config,
  AgentClientContract as AgentClient,
  EditorType,
  AnyToolInvocation,
  ToolRegistry,
  AnyDeclarativeTool,
} from '@vybestack/llxprt-code-core';
import { DEFAULT_AGENT_ID } from '@vybestack/llxprt-code-core';
import type { Part, PartListUnion } from '@google/genai';
import type { LoadedSettings } from '../../config/settings.js';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';
import type { SlashCommandProcessorResult } from '../types.js';
import { StreamingState } from '../types.js';

const inkMock = vi.hoisted(() => {
  const noop = vi.fn(() => null);
  const write = vi.fn();
  const exit = vi.fn();
  const setRawMode = vi.fn();

  const module = {
    Box: noop,
    Text: noop,
    Newline: noop,
    useStdout: vi.fn(() => ({
      stdout: { write, columns: 80, rows: 24 },
      write,
    })),
    useApp: vi.fn(() => ({ exit })),
    useInput: vi.fn(),
    useStdin: vi.fn(() => ({
      stdin: {
        setRawMode,
        resume: vi.fn(),
        pause: vi.fn(),
        removeListener: vi.fn(),
        off: vi.fn(),
      },
      setRawMode,
      isRawModeSupported: true,
    })),
    useIsScreenReaderEnabled: vi.fn(() => false),
    measureElement: vi.fn(() => ({ width: 0, height: 0 })),
    DOMElement: class {},
  };
  (module as Record<string, unknown>).default = module;
  return module;
});

vi.mock('ink', () => inkMock);

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

vi.mock('./useKeypress.js', () => ({
  useKeypress: vi.fn(),
}));

type InternalCarrier = {
  __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED?: {
    S?: unknown;
    T?: unknown;
    H?: unknown;
    [key: string]: unknown;
  };
};

const ensureReactSharedInternals = () => {
  const reactInternals = (React as typeof React & InternalCarrier)
    .__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
  const domInternals = (ReactDOM as typeof ReactDOM & InternalCarrier)
    .__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;

  const shared = reactInternals ??
    domInternals ?? {
      S: null,
      T: null,
      H: null,
    };

  if (shared.S === undefined) shared.S = null;
  if (shared.T === undefined) shared.T = null;
  if (shared.H === undefined) shared.H = null;

  if (typeof globalThis !== 'undefined') {
    (
      globalThis as typeof globalThis & {
        ReactSharedInternals?: typeof shared;
      }
    ).ReactSharedInternals = shared;
  }
};

ensureReactSharedInternals();

const mockSendMessageStream = vi
  .fn()
  .mockReturnValue((async function* () {})());
const mockStartChat = vi.fn();

const MockedAgentClientClass = vi.hoisted(() =>
  vi.fn().mockImplementation(function (
    this: Record<string, unknown>,
    _config: unknown,
  ) {
    this.startChat = mockStartChat;
    this.sendMessageStream = mockSendMessageStream;
    this.addHistory = vi.fn();
  }),
);

vi.mock('./useReactToolScheduler.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('./useReactToolScheduler.js')>();
  const { mapToDisplay } = await import('./toolMapping.js');
  return {
    ...original,
    useReactToolScheduler: vi.fn(),
    mapToDisplay,
  };
});

const mockUseReactToolScheduler = useReactToolScheduler as Mock<
  typeof useReactToolScheduler
>;

describe('useGeminiStream subagent isolation', () => {
  let mockConfig: Config;
  let mockSettings: LoadedSettings;
  let mockAddItem: Mock;
  let mockOnDebugMessage: Mock;
  let mockHandleSlashCommand: Mock;
  let mockScheduleToolCalls: Mock;
  let mockMarkToolsAsDisplayCleared: Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    mockAddItem = vi.fn();
    mockOnDebugMessage = vi.fn();
    mockHandleSlashCommand = vi.fn().mockResolvedValue(false);

    const contentGeneratorConfig = {
      model: 'test-model',
      apiKey: 'test-key',
      vertexai: false,
    };

    const mockGetAgentClient = vi.fn().mockImplementation(() => {
      const clientInstance = new MockedAgentClientClass(mockConfig);
      return clientInstance;
    });

    mockConfig = {
      apiKey: 'test-api-key',
      model: 'gemini-pro',
      sandbox: false,
      targetDir: '/tmp/project',
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
      getProjectRoot: vi.fn(() => '/tmp/project'),
      getCheckpointingEnabled: vi.fn(() => false),
      getAgentClient: mockGetAgentClient,
      getUsageStatisticsEnabled: () => true,
      getDebugMode: () => false,
      addHistory: vi.fn(),
      getSessionId() {
        return 'session-123';
      },
      getModel: vi.fn(() => 'gemini-2.5-pro'),
      getContentGeneratorConfig: vi
        .fn()
        .mockReturnValue(contentGeneratorConfig),
    } as unknown as Config;

    mockSettings = {
      merged: {
        ui: {
          showCitations: false,
        },
      },
    } as unknown as LoadedSettings;

    mockScheduleToolCalls = vi.fn();
    mockMarkToolsAsDisplayCleared = vi.fn();

    const mockCancelAllToolCalls = vi.fn();

    mockUseReactToolScheduler.mockReturnValue([
      [],
      mockScheduleToolCalls,
      mockMarkToolsAsDisplayCleared,
      mockCancelAllToolCalls,
      0,
      true,
      vi.fn(),
      vi.fn(),
    ] as const);

    mockStartChat.mockClear().mockResolvedValue({
      sendMessageStream: mockSendMessageStream,
    } as unknown as AgentClient);
    mockSendMessageStream
      .mockClear()
      .mockReturnValue((async function* () {})());
  });

  it('subagent completions should not reach Gemini submission pipeline', async () => {
    const client = new MockedAgentClientClass(mockConfig);

    let capturedOnComplete:
      | ((
          schedulerId: symbol,
          completedTools: TrackedToolCall[],
          options: { isPrimary: boolean },
        ) => Promise<void>)
      | null = null;

    mockUseReactToolScheduler.mockImplementation((onComplete) => {
      capturedOnComplete = onComplete as typeof capturedOnComplete;
      return [
        [],
        mockScheduleToolCalls,
        mockMarkToolsAsDisplayCleared,
        vi.fn(),
        0,
        true,
        vi.fn(),
        vi.fn(),
      ] as const;
    });

    renderHook(() =>
      useGeminiStream(
        client,
        [],
        mockAddItem as unknown as UseHistoryManagerReturn['addItem'],
        mockConfig,
        mockSettings,
        mockOnDebugMessage,
        mockHandleSlashCommand as unknown as (
          cmd: PartListUnion,
        ) => Promise<SlashCommandProcessorResult | false>,
        false,
        () => 'vscode' as EditorType,
        () => {},
        () => Promise.resolve(),
        () => {},
        () => {},
        () => {},
      ),
    );

    const subagentToolCall: TrackedCompletedToolCall = {
      request: {
        callId: 'subagent-call',
        name: 'task',
        args: {},
        isClientInitiated: false,
        prompt_id: 'prompt-id-sub',
        agentId: 'agent-sub',
      },
      status: 'success',
      displayCleared: false,
      response: {
        callId: 'subagent-call',
        responseParts: [{ text: 'subagent output' } as Part],
        resultDisplay: undefined,
        error: undefined,
        errorType: undefined,
      },
      invocation: {
        getDescription: () => `Mock description`,
      } as unknown as AnyToolInvocation,
      tool: {
        name: 'task',
        displayName: 'Task',
        description: 'Launch subagent',
        build: vi.fn(),
      } as unknown as AnyDeclarativeTool,
    };

    await act(async () => {
      if (capturedOnComplete) {
        await capturedOnComplete(Symbol('scheduler'), [subagentToolCall], {
          isPrimary: true,
        });
      }
    });

    await waitFor(() => {
      expect(mockMarkToolsAsDisplayCleared).toHaveBeenCalledWith([
        'subagent-call',
      ]);
      expect(mockSendMessageStream).not.toHaveBeenCalled();
      expect(client.addHistory).not.toHaveBeenCalled();
    });
  });

  it('marks a terminal subagent tool as outstanding until displayCleared transitions it out of Responding', () => {
    const client = new MockedAgentClientClass(mockConfig);

    const unclearedSubagentTool: TrackedCompletedToolCall = {
      request: {
        callId: 'subagent-pending',
        name: 'task',
        args: {},
        isClientInitiated: false,
        prompt_id: 'prompt-pending',
        agentId: 'agent-sub',
      },
      status: 'success',
      displayCleared: false,
      response: {
        callId: 'subagent-pending',
        responseParts: [{ text: 'pending output' } as Part],
        resultDisplay: undefined,
        error: undefined,
        errorType: undefined,
      },
      invocation: {
        getDescription: () => `Mock description`,
      } as unknown as AnyToolInvocation,
      tool: {
        name: 'task',
        displayName: 'Task',
        description: 'Launch subagent',
        build: vi.fn(),
      } as unknown as AnyDeclarativeTool,
    };

    mockUseReactToolScheduler.mockReturnValue([
      [unclearedSubagentTool],
      mockScheduleToolCalls,
      mockMarkToolsAsDisplayCleared,
      vi.fn(),
      0,
      true,
      vi.fn(),
      vi.fn(),
    ] as const);

    const { result } = renderHook(() =>
      useGeminiStream(
        client,
        [],
        mockAddItem as unknown as UseHistoryManagerReturn['addItem'],
        mockConfig,
        mockSettings,
        mockOnDebugMessage,
        mockHandleSlashCommand as unknown as (
          cmd: PartListUnion,
        ) => Promise<SlashCommandProcessorResult | false>,
        false,
        () => 'vscode' as EditorType,
        () => {},
        () => Promise.resolve(),
        () => {},
        () => {},
        () => {},
      ),
    );

    // A terminal-but-not-yet-display-cleared subagent tool keeps the stream in
    // Responding because isOutstandingToolCall treats it as outstanding.
    expect(result.current.streamingState).toBe(StreamingState.Responding);
  });

  it('transitions a terminal subagent tool out of Responding once displayCleared is true', () => {
    const client = new MockedAgentClientClass(mockConfig);

    const clearedSubagentTool: TrackedCompletedToolCall = {
      request: {
        callId: 'subagent-cleared',
        name: 'task',
        args: {},
        isClientInitiated: false,
        prompt_id: 'prompt-cleared',
        agentId: 'agent-sub',
      },
      status: 'success',
      displayCleared: true,
      response: {
        callId: 'subagent-cleared',
        responseParts: [{ text: 'cleared output' } as Part],
        resultDisplay: undefined,
        error: undefined,
        errorType: undefined,
      },
      invocation: {
        getDescription: () => `Mock description`,
      } as unknown as AnyToolInvocation,
      tool: {
        name: 'task',
        displayName: 'Task',
        description: 'Launch subagent',
        build: vi.fn(),
      } as unknown as AnyDeclarativeTool,
    };

    mockUseReactToolScheduler.mockReturnValue([
      [clearedSubagentTool],
      mockScheduleToolCalls,
      mockMarkToolsAsDisplayCleared,
      vi.fn(),
      0,
      true,
      vi.fn(),
      vi.fn(),
    ] as const);

    const { result } = renderHook(() =>
      useGeminiStream(
        client,
        [],
        mockAddItem as unknown as UseHistoryManagerReturn['addItem'],
        mockConfig,
        mockSettings,
        mockOnDebugMessage,
        mockHandleSlashCommand as unknown as (
          cmd: PartListUnion,
        ) => Promise<SlashCommandProcessorResult | false>,
        false,
        () => 'vscode' as EditorType,
        () => {},
        () => Promise.resolve(),
        () => {},
        () => {},
        () => {},
      ),
    );

    // Once displayCleared is true, the terminal tool is no longer outstanding,
    // so the streaming state settles to Idle without any model resubmission.
    expect(result.current.streamingState).toBe(StreamingState.Idle);
    expect(mockSendMessageStream).not.toHaveBeenCalled();
  });

  it('renders a completed client-initiated tool to display without resubmitting to the model or marking it display-cleared', async () => {
    const client = new MockedAgentClientClass(mockConfig);

    let capturedOnComplete:
      | ((
          schedulerId: symbol,
          completedTools: TrackedToolCall[],
          options: { isPrimary: boolean },
        ) => Promise<void>)
      | null = null;

    mockUseReactToolScheduler.mockImplementation((onComplete) => {
      capturedOnComplete = onComplete as typeof capturedOnComplete;
      return [
        [],
        mockScheduleToolCalls,
        mockMarkToolsAsDisplayCleared,
        vi.fn(),
        0,
        true,
        vi.fn(),
        vi.fn(),
      ] as const;
    });

    renderHook(() =>
      useGeminiStream(
        client,
        [],
        mockAddItem as unknown as UseHistoryManagerReturn['addItem'],
        mockConfig,
        mockSettings,
        mockOnDebugMessage,
        mockHandleSlashCommand as unknown as (
          cmd: PartListUnion,
        ) => Promise<SlashCommandProcessorResult | false>,
        false,
        () => 'vscode' as EditorType,
        () => {},
        () => Promise.resolve(),
        () => {},
        () => {},
        () => {},
      ),
    );

    // A client-initiated tool completes through the MAIN scheduler: it has
    // isClientInitiated: true and agentId: DEFAULT_AGENT_ID, and its completion
    // callback is invoked with { isPrimary: true }.
    const clientInitiatedTool: TrackedCompletedToolCall = {
      request: {
        callId: 'client-callId',
        name: 'list_directory',
        args: {},
        isClientInitiated: true,
        prompt_id: 'prompt-client',
        agentId: DEFAULT_AGENT_ID,
      },
      status: 'success',
      displayCleared: false,
      response: {
        callId: 'client-callId',
        responseParts: [{ text: 'dir listing' } as Part],
        resultDisplay: undefined,
        error: undefined,
        errorType: undefined,
      },
      invocation: {
        getDescription: () => `Mock description`,
      } as unknown as AnyToolInvocation,
      tool: {
        name: 'list_directory',
        displayName: 'List Directory',
        description: 'List files',
        build: vi.fn(),
      } as unknown as AnyDeclarativeTool,
    };

    await act(async () => {
      if (capturedOnComplete) {
        await capturedOnComplete(Symbol('scheduler'), [clientInitiatedTool], {
          isPrimary: true,
        });
      }
    });

    await waitFor(() => {
      expect(mockAddItem).toHaveBeenCalled();
    });

    // Completing a client-initiated tool does NOT resubmit to the model.
    expect(mockSendMessageStream).not.toHaveBeenCalled();
    // A client-initiated PRIMARY tool is cleared by the scheduler emptying its
    // list, NOT via the displayCleared flag, so markToolsAsDisplayCleared is
    // never called for it.
    expect(mockMarkToolsAsDisplayCleared).not.toHaveBeenCalled();
  });
});
