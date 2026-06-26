/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** @vitest-environment jsdom */

import type { Mock } from 'vitest';
import {
  MockedAgentClientClass,
  mockSendMessageStream,
  mockStartChat,
} from './useGeminiStream-test-helpers.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { renderHook } from '../../test-utils/render.js';
import { waitFor } from '../../test-utils/async.js';
import { useGeminiStream } from './geminiStream/index.js';
import * as atCommandProcessor from './atCommandProcessor.js';
import { useReactToolScheduler } from './useReactToolScheduler.js';
import type { Config, ToolRegistry } from '@vybestack/llxprt-code-core';
import {
  ApprovalMode,
  GeminiEventType as ServerGeminiEventType,
} from '@vybestack/llxprt-code-core';
import { MessageType, StreamingState } from '../types.js';

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
    vi.fn();
    vi.fn().mockResolvedValue(false);

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

  // Helper to create mock tool calls - reduces boilerplate

  // Helper to render hook with default parameters - reduces boilerplate

  describe('Hook Execution Control Events', () => {
    it('should add info message when AgentExecutionStopped event is received', async () => {
      const { result } = renderHook(() => useGeminiStream(mockConfig));

      await act(async () => {
        mockTurnRun.mockReturnValue(
          (async function* () {
            yield {
              type: ServerGeminiEventType.AgentExecutionStopped,
              reason: 'Test stop reason',
            };
          })(),
        );
        void result.current.submitQuery('test query');
      });

      await waitFor(() => {
        expect(result.current.streamingState).toBe(StreamingState.Idle);
      });

      expect(mockAddItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.INFO,
          text: 'Execution stopped by hook: Test stop reason',
        }),
        expect.any(Number),
      );
    });

    it('should add info message when AgentExecutionBlocked event is received', async () => {
      const { result } = renderHook(() => useGeminiStream(mockConfig));

      await act(async () => {
        mockTurnRun.mockReturnValue(
          (async function* () {
            yield {
              type: ServerGeminiEventType.AgentExecutionBlocked,
              reason: 'Test block reason',
            };
          })(),
        );
        void result.current.submitQuery('test query');
      });

      await waitFor(() => {
        expect(result.current.streamingState).toBe(StreamingState.Idle);
      });

      expect(mockAddItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.INFO,
          text: 'Execution blocked by hook: Test block reason',
        }),
        expect.any(Number),
      );
    });

    it('should not crash when processing AgentExecutionStopped event', async () => {
      const { result } = renderHook(() => useGeminiStream(mockConfig));

      await act(async () => {
        mockTurnRun.mockReturnValue(
          (async function* () {
            yield {
              type: ServerGeminiEventType.AgentExecutionStopped,
              reason: 'Hook stopped execution',
            };
          })(),
        );
        void result.current.submitQuery('test query');
      });

      await waitFor(() => {
        expect(result.current.streamingState).toBe(StreamingState.Idle);
      });

      // Verify no errors thrown and state is clean
      expect(result.current.streamingState).toBe(StreamingState.Idle);
    });

    it('should not crash when processing AgentExecutionBlocked event', async () => {
      const { result } = renderHook(() => useGeminiStream(mockConfig));

      await act(async () => {
        mockTurnRun.mockReturnValue(
          (async function* () {
            yield {
              type: ServerGeminiEventType.AgentExecutionBlocked,
              reason: 'Hook blocked execution',
            };
          })(),
        );
        void result.current.submitQuery('test query');
      });

      await waitFor(() => {
        expect(result.current.streamingState).toBe(StreamingState.Idle);
      });

      // Verify no errors thrown and state is clean
      expect(result.current.streamingState).toBe(StreamingState.Idle);
    });
  });
});
