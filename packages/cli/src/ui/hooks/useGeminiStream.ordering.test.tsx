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
import { MessageType } from '../types.js';
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
    this.getCurrentSequenceModel = vi.fn().mockReturnValue(null);
    this.getChat = vi.fn().mockReturnValue({
      recordCompletedToolCalls: vi.fn(),
    });
  }),
);

const mockParseAndFormatApiError = vi.hoisted(() => vi.fn());

vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const actualCoreModule = await importOriginal<Record<string, unknown>>();
  return {
    ...actualCoreModule,
    GitService: vi.fn(),
    AgentClient: MockedAgentClientClass,
    parseAndFormatApiError: mockParseAndFormatApiError,
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

  it('should include thinkingBlocks when reasoning.includeInResponse is false (storage test)', async () => {
    // Mock settings with reasoning.includeInResponse = false
    const settingsWithoutReasoning: LoadedSettings = {
      ...mockSettings,
      merged: {
        ...mockSettings.merged,
        'reasoning.includeInResponse': false,
      },
    } as unknown as LoadedSettings;

    mockSendMessageStream.mockReturnValue(
      (async function* () {
        yield {
          type: ServerGeminiEventType.Thought,
          value: {
            subject: 'With reasoning disabled',
            description: 'This should still be stored',
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
        settingsWithoutReasoning,
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
    // Blocks should still be stored in history regardless of display setting
    expect(historyItem.thinkingBlocks).toBeDefined();
    expect(historyItem.thinkingBlocks!.length).toBeGreaterThan(0);
  });
  it('should reset thinking blocks on new prompt', async () => {
    // First query with thought
    mockSendMessageStream.mockReturnValue(
      (async function* () {
        yield {
          type: ServerGeminiEventType.Thought,
          value: {
            subject: 'First query thought',
            description: 'First description',
          },
        };
        yield {
          type: ServerGeminiEventType.Content,
          value: 'First response',
        };
        yield {
          type: ServerGeminiEventType.Finished,
          value: { reason: FinishReason.STOP },
        };
      })(),
    );

    const { result } = renderTestHook();

    await act(async () => {
      await result.current.submitQuery('first query');
    });

    await waitFor(() => {
      const geminiCalls = mockAddItem.mock.calls.filter(
        (call) => call[0].type === MessageType.GEMINI,
      );
      expect(geminiCalls.length).toBeGreaterThan(0);
    });

    // Second query without thought
    mockSendMessageStream.mockReturnValue(
      (async function* () {
        yield {
          type: ServerGeminiEventType.Content,
          value: 'Second response',
        };
        yield {
          type: ServerGeminiEventType.Finished,
          value: { reason: FinishReason.STOP },
        };
      })(),
    );

    await act(async () => {
      await result.current.submitQuery('second query');
    });

    await waitFor(() => {
      const geminiCalls = mockAddItem.mock.calls.filter(
        (call) => call[0].type === MessageType.GEMINI,
      );
      expect(geminiCalls.length).toBeGreaterThan(1);
    });

    const secondGeminiCall = mockAddItem.mock.calls
      .filter((call) => call[0].type === MessageType.GEMINI)
      .pop();

    const historyItem = secondGeminiCall[0] as HistoryItemGemini;
    // Second query should have no thinking blocks or an empty array
    const thinkingBlocks = historyItem.thinkingBlocks ?? [];
    expect(thinkingBlocks).toHaveLength(0);
  });
  it('should handle Thought events with empty subject or description', async () => {
    mockSendMessageStream.mockReturnValue(
      (async function* () {
        yield {
          type: ServerGeminiEventType.Thought,
          value: {
            subject: '',
            description: 'Description only',
          },
        };
        yield {
          type: ServerGeminiEventType.Thought,
          value: {
            subject: 'Subject only',
            description: '',
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
    expect(historyItem.thinkingBlocks).toBeDefined();
    expect(historyItem.thinkingBlocks!.length).toBe(2);

    // Verify that empty fields are handled gracefully
    expect(historyItem.thinkingBlocks![0].thought).toContain(
      'Description only',
    );
    expect(historyItem.thinkingBlocks![1].thought).toContain('Subject only');
  });
  describe('Ordering contract: thinking ownership on content split (#1272)', () => {
    it('should attach thinkingBlocks only to the first committed gemini item, not gemini_content', async () => {
      // Override findLastSafeSplitPoint to force a split: split at first chunk boundary
      const { findLastSafeSplitPoint } = await import(
        '../utils/markdownUtilities.js'
      );
      const mockedSplitPoint = vi.mocked(findLastSafeSplitPoint);

      // First call returns a split point (half the combined text), subsequent calls return full length
      let callCount = 0;
      mockedSplitPoint.mockImplementation((s: string) => {
        callCount++;
        // On the first content event, force a split mid-string
        if (callCount === 1 && s.length > 5) {
          return 5;
        }
        return s.length;
      });

      mockSendMessageStream.mockReturnValue(
        (async function* () {
          yield {
            type: ServerGeminiEventType.Thought,
            value: {
              subject: 'Analyzing',
              description: 'the problem',
            },
          };
          yield {
            type: ServerGeminiEventType.Content,
            value: 'Hello world, this is a long response',
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
          (call) =>
            call[0].type === MessageType.GEMINI ||
            call[0].type === 'gemini_content',
        );
        expect(geminiCalls.length).toBeGreaterThanOrEqual(2);
      });

      const committedGeminiItems = mockAddItem.mock.calls
        .filter(
          (call) =>
            call[0].type === MessageType.GEMINI ||
            call[0].type === 'gemini_content',
        )
        .map((call) => call[0] as HistoryItemGemini);

      // First committed item (type: 'gemini') should own thinkingBlocks
      const firstItem = committedGeminiItems[0];
      expect(firstItem.type).toBe('gemini');
      expect(firstItem.thinkingBlocks).toBeDefined();
      expect(firstItem.thinkingBlocks!.length).toBeGreaterThan(0);
      expect(firstItem.thinkingBlocks![0].sourceField).toBe('thought');

      // Subsequent gemini_content items should NOT have thinkingBlocks
      for (let i = 1; i < committedGeminiItems.length; i++) {
        const item = committedGeminiItems[i];
        const hasThinking =
          item.thinkingBlocks && item.thinkingBlocks.length > 0;
        expect(hasThinking).toBeFalsy();
      }

      // Restore mock
      mockedSplitPoint.mockImplementation((s: string) => s.length);
    });

    it('should not duplicate thinkingBlocks across multiple committed content segments', async () => {
      const { findLastSafeSplitPoint } = await import(
        '../utils/markdownUtilities.js'
      );
      const mockedSplitPoint = vi.mocked(findLastSafeSplitPoint);

      // Force a split on every call to generate multiple committed segments
      mockedSplitPoint.mockImplementation((s: string) => {
        if (s.length > 10) {
          return 10;
        }
        return s.length;
      });

      mockSendMessageStream.mockReturnValue(
        (async function* () {
          yield {
            type: ServerGeminiEventType.Thought,
            value: {
              subject: 'Deep thinking',
              description: 'about the problem',
            },
          };
          // Send enough content to trigger multiple splits
          yield {
            type: ServerGeminiEventType.Content,
            value: 'First segment of content that is long enough. ',
          };
          yield {
            type: ServerGeminiEventType.Content,
            value: 'Second segment of content that continues. ',
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
        const allGeminiCalls = mockAddItem.mock.calls.filter(
          (call) =>
            call[0].type === MessageType.GEMINI ||
            call[0].type === 'gemini_content',
        );
        expect(allGeminiCalls.length).toBeGreaterThanOrEqual(2);
      });

      const committedItems = mockAddItem.mock.calls
        .filter(
          (call) =>
            call[0].type === MessageType.GEMINI ||
            call[0].type === 'gemini_content',
        )
        .map((call) => call[0] as HistoryItemGemini);

      // Count how many items have thinkingBlocks
      const itemsWithThinking = committedItems.filter(
        (item) => item.thinkingBlocks != null && item.thinkingBlocks.length > 0,
      );

      // Exactly one item should own thinkingBlocks
      expect(itemsWithThinking).toHaveLength(1);
      expect(itemsWithThinking[0].type).toBe('gemini');

      // Restore mock
      mockedSplitPoint.mockImplementation((s: string) => s.length);
    });

    it('should maintain thinking-above-content ordering on the first committed gemini item', async () => {
      const { findLastSafeSplitPoint } = await import(
        '../utils/markdownUtilities.js'
      );
      const mockedSplitPoint = vi.mocked(findLastSafeSplitPoint);

      mockedSplitPoint.mockImplementation((s: string) => {
        if (s.length > 8) {
          return 8;
        }
        return s.length;
      });

      mockSendMessageStream.mockReturnValue(
        (async function* () {
          yield {
            type: ServerGeminiEventType.Thought,
            value: {
              subject: 'Planning',
              description: 'the response',
            },
          };
          yield {
            type: ServerGeminiEventType.Content,
            value: 'Here is the detailed response text',
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
          (call) =>
            call[0].type === MessageType.GEMINI ||
            call[0].type === 'gemini_content',
        );
        expect(geminiCalls.length).toBeGreaterThanOrEqual(1);
      });

      const allCommitted = mockAddItem.mock.calls
        .filter(
          (call) =>
            call[0].type === MessageType.GEMINI ||
            call[0].type === 'gemini_content',
        )
        .map((call) => call[0] as HistoryItemGemini);

      // The first committed item must be 'gemini' type with thinking
      const first = allCommitted[0];
      expect(first.type).toBe('gemini');
      expect(first.thinkingBlocks).toBeDefined();
      expect(first.thinkingBlocks!.length).toBe(1);
      expect(first.thinkingBlocks![0].thought).toBe('Planning: the response');
      expect(first.text.length).toBeGreaterThan(0);

      // Restore mock
      mockedSplitPoint.mockImplementation((s: string) => s.length);
    });
  });
});
