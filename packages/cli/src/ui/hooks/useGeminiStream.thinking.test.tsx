/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20251202-THINKING-UI.P07
 * @requirement:REQ-THINK-UI-001
 * @requirement:REQ-THINK-UI-003
 */

import type { Mock } from 'vitest';
import {
  MockedAgentClientClass,
  mockSendMessageStream,
  mockStartChat,
} from './useGeminiStream-test-helpers.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { renderHook, waitFor } from '../../test-utils/render.js';
import * as ReactDOM from 'react-dom';
import { useGeminiStream } from './geminiStream/index.js';
import type { TrackedToolCall } from './useReactToolScheduler.js';
import { useReactToolScheduler } from './useReactToolScheduler.js';
import type {
  Config,
  EditorType,
  ToolRegistry,
} from '@vybestack/llxprt-code-core';
import { GeminiEventType as ServerGeminiEventType } from '@vybestack/llxprt-code-core';
import { FinishReason } from '@google/genai';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';
import type { HistoryItemGemini } from '../types.js';
import { MessageType, StreamingState } from '../types.js';
import type { LoadedSettings } from '../../config/settings.js';

const inkMock = vi.hoisted(() => {
  const write = vi.fn();
  const exit = vi.fn();
  const setRawMode = vi.fn();
  const noopComponent = vi.fn(() => null);

  const module = {
    Box: noopComponent,
    Text: noopComponent,
    Newline: noopComponent,
    useStdout: vi.fn(() => ({
      stdout: {
        write,
        columns: 80,
        rows: 24,
      },
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

// --- MOCKS ---
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
  useStateAndRef: <T,>(
    initial: T,
  ): [
    T,
    React.MutableRefObject<T>,
    React.Dispatch<React.SetStateAction<T>>,
  ] => {
    const [state, setState] = React.useState(initial);
    const ref = React.useRef(initial);
    const setStateInternal = (valueOrUpdater: React.SetStateAction<T>) => {
      const nextValue =
        typeof valueOrUpdater === 'function'
          ? valueOrUpdater(ref.current)
          : valueOrUpdater;
      ref.current = nextValue;
      setState(nextValue);
    };
    return [state, ref, setStateInternal];
  },
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

describe('useGeminiStream - ThinkingBlock Integration', () => {
  let mockAddItem: Mock;
  let mockConfig: Config;
  let mockSettings: LoadedSettings;
  let mockOnDebugMessage: Mock;
  let mockHandleSlashCommand: Mock;
  let mockScheduleToolCalls: Mock;
  let mockCancelAllToolCalls: Mock;
  let mockMarkToolsAsDisplayCleared: Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    mockAddItem = vi.fn();

    const mockGetAgentClient = vi.fn().mockImplementation(() => {
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
      getAgentClient: mockGetAgentClient,
      getMcpClientManager: vi.fn(() => undefined),
      getMcpServers: vi.fn(() => undefined),
      getUsageStatisticsEnabled: () => true,
      getDebugMode: () => false,
      addHistory: vi.fn(),
      getSessionId() {
        return 'test-session-id';
      },
      getModel: vi.fn(() => 'gemini-2.5-pro'),
      getContentGeneratorConfig: vi
        .fn()
        .mockReturnValue(contentGeneratorConfig),
      // Mock setupAsyncTaskAutoTrigger to return a no-op unsubscribe function
      setupAsyncTaskAutoTrigger: vi.fn(() => () => {}),
    } as unknown as Config;

    mockSettings = {
      merged: {
        ui: {
          showCitations: false,
        },
      },
    } as LoadedSettings;

    mockOnDebugMessage = vi.fn();
    mockHandleSlashCommand = vi.fn().mockResolvedValue(false);

    mockScheduleToolCalls = vi.fn();
    mockCancelAllToolCalls = vi.fn();
    mockMarkToolsAsDisplayCleared = vi.fn();

    mockUseReactToolScheduler.mockReturnValue([
      [],
      mockScheduleToolCalls,
      mockMarkToolsAsDisplayCleared,
      mockCancelAllToolCalls,
      0,
      true,
      vi.fn(),
      vi.fn(),
    ]);

    mockStartChat.mockClear().mockResolvedValue({
      sendMessageStream: mockSendMessageStream,
    } as unknown as Awaited<ReturnType<typeof mockStartChat>>);
    mockSendMessageStream
      .mockClear()
      .mockReturnValue((async function* () {})());
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
    let currentToolCalls = initialToolCalls;
    const setToolCalls = (newToolCalls: TrackedToolCall[]) => {
      currentToolCalls = newToolCalls;
    };

    mockUseReactToolScheduler.mockImplementation(() => [
      currentToolCalls,
      mockScheduleToolCalls,
      mockMarkToolsAsDisplayCleared,
      mockCancelAllToolCalls,
      0,
      true,
      vi.fn(),
      vi.fn(),
    ]);

    const client = agentClient ?? mockConfig.getAgentClient();

    const { result, rerender } = renderHook(
      (props: {
        client: unknown;
        history: unknown[];
        addItem: UseHistoryManagerReturn['addItem'];
        config: Config;
        onDebugMessage: (message: string) => void;
        handleSlashCommand: (cmd: unknown) => Promise<unknown>;
        shellModeActive: boolean;
        loadedSettings: LoadedSettings;
        toolCalls?: TrackedToolCall[];
      }) => {
        if (props.toolCalls) {
          setToolCalls(props.toolCalls);
        }
        return useGeminiStream(
          props.client,
          props.history,
          props.addItem,
          props.config,
          mockSettings,
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
        );
      },
      {
        initialProps: {
          client,
          history: [],
          addItem: mockAddItem as unknown as UseHistoryManagerReturn['addItem'],
          config: mockConfig,
          onDebugMessage: mockOnDebugMessage,
          handleSlashCommand: mockHandleSlashCommand as unknown as (
            cmd: unknown,
          ) => Promise<unknown>,
          shellModeActive: false,
          loadedSettings: mockLoadedSettings,
          toolCalls: initialToolCalls,
        },
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

  it('should verify thought field is replaced (overwritten) not appended', async () => {
    const resolvers: Array<() => void> = [];
    mockSendMessageStream.mockReturnValue(
      (async function* () {
        yield {
          type: ServerGeminiEventType.Thought,
          value: {
            subject: 'First',
            description: 'thought',
          },
        };
        await new Promise<void>((resolve) => {
          resolvers.push(resolve);
        });
        yield {
          type: ServerGeminiEventType.Thought,
          value: {
            subject: 'Second',
            description: 'thought',
          },
        };
        yield {
          type: ServerGeminiEventType.Content,
          value: 'Response',
        };
        yield {
          type: ServerGeminiEventType.Finished,
          value: { reason: FinishReason.STOP },
        };
      })(),
    );

    const { result } = renderTestHook();

    act(() => {
      void result.current.submitQuery('test query');
    });

    await waitFor(() => {
      expect(result.current.thought).toBeDefined();
      expect(result.current.thought?.subject).toBe('First');
    });

    const firstThoughtValue = result.current.thought;

    act(() => {
      resolvers[0]?.();
    });

    await waitFor(() => {
      expect(result.current.thought).toBeDefined();
      expect(result.current.thought?.subject).toBe('Second');
    });

    const secondThoughtValue = result.current.thought;
    expect(secondThoughtValue).not.toStrictEqual(firstThoughtValue);
  });
  it('should replace thinking content on subsequent Thought events (not append)', async () => {
    mockSendMessageStream.mockReturnValue(
      (async function* () {
        yield {
          type: ServerGeminiEventType.Thought,
          value: {
            subject: 'Analyzing request',
            description: 'First thought process',
          },
        };
        yield {
          type: ServerGeminiEventType.Content,
          value: 'Response text',
        };
        yield {
          type: ServerGeminiEventType.Finished,
          value: { reason: FinishReason.STOP },
        };
      })(),
    );

    const { result } = renderTestHook();

    await act(async () => {
      await result.current.submitQuery('test query');
    });

    await waitFor(() => {
      const geminiCalls = mockAddItem.mock.calls.filter(
        (call) => call[0].type === MessageType.GEMINI,
      );
      expect(geminiCalls.length).toBeGreaterThan(0);
    });

    const lastGeminiCall = mockAddItem.mock.calls
      .filter((call) => call[0].type === MessageType.GEMINI)
      .pop();

    expect(lastGeminiCall).toBeDefined();
    const historyItem = lastGeminiCall[0] as HistoryItemGemini;

    expect(historyItem.thinkingBlocks).toBeDefined();
    expect(historyItem.thinkingBlocks).toHaveLength(1);
    expect(historyItem.thinkingBlocks![0]).toMatchObject({
      type: 'thinking',
      thought: 'Analyzing request: First thought process',
      sourceField: 'thought',
    });
  });
  it('should expose pending thinking blocks before content arrives', async () => {
    const resolvers: Array<() => void> = [];
    mockSendMessageStream.mockReturnValue(
      (async function* () {
        yield {
          type: ServerGeminiEventType.Thought,
          value: {
            subject: 'Streaming thought',
            description: 'before content',
          },
        };
        await new Promise<void>((resolve) => {
          resolvers.push(resolve);
        });
        yield {
          type: ServerGeminiEventType.Content,
          value: 'Now content',
        };
        yield {
          type: ServerGeminiEventType.Finished,
          value: { reason: FinishReason.STOP },
        };
      })(),
    );

    const { result } = renderTestHook();

    act(() => {
      void result.current.submitQuery('test query');
    });

    await waitFor(() => {
      const pending = result.current.pendingHistoryItems;
      const thinkingText = pending
        .flatMap((item) => item.thinkingBlocks ?? [])
        .map((block) => block.thought)
        .join('');
      expect(thinkingText).toContain('Streaming thought');
    });
  });
  it('should accumulate multiple Thought events into multiple blocks', async () => {
    mockSendMessageStream.mockReturnValue(
      (async function* () {
        yield {
          type: ServerGeminiEventType.Thought,
          value: {
            subject: 'First subject',
            description: 'First description',
          },
        };
        yield {
          type: ServerGeminiEventType.Thought,
          value: {
            subject: 'Second subject',
            description: 'Second description',
          },
        };
        yield {
          type: ServerGeminiEventType.Content,
          value: 'Response text',
        };
        yield {
          type: ServerGeminiEventType.Finished,
          value: { reason: FinishReason.STOP },
        };
      })(),
    );

    const { result } = renderTestHook();

    await act(async () => {
      await result.current.submitQuery('test query');
    });

    await waitFor(() => {
      const geminiCalls = mockAddItem.mock.calls.filter(
        (call) => call[0].type === MessageType.GEMINI,
      );
      expect(geminiCalls.length).toBeGreaterThan(0);
    });

    const lastGeminiCall = mockAddItem.mock.calls
      .filter((call) => call[0].type === MessageType.GEMINI)
      .pop();

    expect(lastGeminiCall).toBeDefined();
    const historyItem = lastGeminiCall[0] as HistoryItemGemini;

    expect(historyItem.thinkingBlocks).toBeDefined();
    expect(historyItem.thinkingBlocks).toHaveLength(2);
    expect(historyItem.thinkingBlocks![0]).toMatchObject({
      type: 'thinking',
      thought: 'First subject: First description',
      sourceField: 'thought',
    });
    expect(historyItem.thinkingBlocks![1]).toMatchObject({
      type: 'thinking',
      thought: 'Second subject: Second description',
      sourceField: 'thought',
    });
  });
  it('should verify ThinkingBlock structure matches IContent specification', async () => {
    mockSendMessageStream.mockReturnValue(
      (async function* () {
        yield {
          type: ServerGeminiEventType.Thought,
          value: {
            subject: 'Test subject',
            description: 'Test description',
          },
        };
        yield {
          type: ServerGeminiEventType.Content,
          value: 'Response',
        };
        yield {
          type: ServerGeminiEventType.Finished,
          value: { reason: FinishReason.STOP },
        };
      })(),
    );

    const { result } = renderTestHook();

    await act(async () => {
      await result.current.submitQuery('test query');
    });

    await waitFor(() => {
      const geminiCalls = mockAddItem.mock.calls.filter(
        (call) => call[0].type === MessageType.GEMINI,
      );
      expect(geminiCalls.length).toBeGreaterThan(0);
    });

    const lastGeminiCall = mockAddItem.mock.calls
      .filter((call) => call[0].type === MessageType.GEMINI)
      .pop();

    const historyItem = lastGeminiCall[0] as HistoryItemGemini;
    const block = historyItem.thinkingBlocks![0];

    expect(block.type).toBe('thinking');
    expect(typeof block.thought).toBe('string');
    expect(block.thought.length).toBeGreaterThan(0);
    expect(block.sourceField).toBe('thought');
    expect(block.isHidden).toBeUndefined();
  });
  it('should include thinkingBlocks when reasoning.includeInResponse is true', async () => {
    // Mock settings with reasoning.includeInResponse = true
    const settingsWithReasoning: LoadedSettings = {
      ...mockSettings,
      merged: {
        ...mockSettings.merged,
        'reasoning.includeInResponse': true,
      },
    } as unknown as LoadedSettings;

    mockSendMessageStream.mockReturnValue(
      (async function* () {
        yield {
          type: ServerGeminiEventType.Thought,
          value: {
            subject: 'With reasoning enabled',
            description: 'This should be included',
          },
        };
        yield {
          type: ServerGeminiEventType.Content,
          value: 'Response',
        };
        yield {
          type: ServerGeminiEventType.Finished,
          value: { reason: FinishReason.STOP },
        };
      })(),
    );

    const { result } = renderHook(() =>
      useGeminiStream(
        mockConfig.getAgentClient(),
        [],
        mockAddItem,
        mockConfig,
        settingsWithReasoning,
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
      ),
    );

    await act(async () => {
      await result.current.submitQuery('test query');
    });

    await waitFor(() => {
      const geminiCalls = mockAddItem.mock.calls.filter(
        (call) => call[0].type === MessageType.GEMINI,
      );
      expect(geminiCalls.length).toBeGreaterThan(0);
    });

    const lastGeminiCall = mockAddItem.mock.calls
      .filter((call) => call[0].type === MessageType.GEMINI)
      .pop();

    const historyItem = lastGeminiCall[0] as HistoryItemGemini;
    expect(historyItem.thinkingBlocks).toBeDefined();
    expect(historyItem.thinkingBlocks!.length).toBeGreaterThan(0);
  });
  describe('Submission queue (regression #862)', () => {
    it('drains queued prompts sequentially when multiple are queued', async () => {
      const streamResolvers: Array<() => void> = [];
      mockSendMessageStream.mockImplementation(() =>
        (async function* () {
          await new Promise<void>((resolve) => {
            streamResolvers.push(resolve);
          });
          yield {
            type: ServerGeminiEventType.Finished,
            value: { reason: FinishReason.STOP },
          } as unknown as {
            type: ServerGeminiEventType;
            value: { reason: FinishReason };
          };
        })(),
      );

      const { result } = renderTestHook();

      act(() => {
        void result.current.submitQuery('first prompt');
      });

      await waitFor(() =>
        expect(result.current.streamingState).toBe(StreamingState.Responding),
      );

      act(() => {
        void result.current.submitQuery('second prompt');
        void result.current.submitQuery('third prompt');
      });

      // While the first prompt is still responding, subsequent prompts should
      // only be enqueued.
      expect(mockSendMessageStream).toHaveBeenCalledTimes(1);

      await waitFor(() => expect(streamResolvers.length).toBeGreaterThan(0));

      act(() => {
        streamResolvers[0]?.();
      });

      await waitFor(() =>
        expect(mockSendMessageStream).toHaveBeenCalledTimes(2),
      );
      await waitFor(() => expect(streamResolvers.length).toBeGreaterThan(1));

      // Regression: we previously scheduled the next queued submission twice
      // (on stream finish + in submitQuery finally), which could submit the same
      // queued prompt multiple times.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockSendMessageStream).toHaveBeenCalledTimes(2);
      expect(streamResolvers).toHaveLength(2);

      act(() => {
        streamResolvers[1]?.();
      });

      await waitFor(() =>
        expect(mockSendMessageStream).toHaveBeenCalledTimes(3),
      );
      await waitFor(() => expect(streamResolvers.length).toBeGreaterThan(2));

      act(() => {
        streamResolvers[2]?.();
      });

      await waitFor(() =>
        expect(result.current.streamingState).toBe(StreamingState.Idle),
      );
    });
  });
});
