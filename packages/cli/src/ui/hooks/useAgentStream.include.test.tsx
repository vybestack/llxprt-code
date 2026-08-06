/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** @vitest-environment jsdom */

import type { Mock } from 'bun:test';
import {
  MockedAgentClientClass,
  mockSendMessageStream,
  mockStartChat,
  createFakeAgentFromMockClient,
} from './useAgentStream-test-helpers.js';
import { describe, it, expect, vi, beforeEach } from 'bun:test';
import React, { act } from 'react';
import { renderHook } from '../../test-utils/render.js';
import { useAgentStream } from './agentStream/index.js';
import { createStreamRuntimeForTest } from './agentStream/__tests__/streamRuntimeTestHelper.js';
import * as atCommandProcessor from './atCommandProcessor.js';
import { useReactToolScheduler } from './useReactToolScheduler.js';
import type { Config, ToolRegistry } from '@vybestack/llxprt-code-core';
import { ApprovalMode } from '@vybestack/llxprt-code-core';
import { MessageType } from '../types.js';
import type { LoadedSettings } from '../../config/settings.js';

// --- MOCKS ---
const actualSchedulerModule = {
  ...(await import('./useReactToolScheduler.js')),
};
vi.mock('./useReactToolScheduler.js', () => {
  return {
    ...actualSchedulerModule,
    useReactToolScheduler: vi.fn(),
  };
});
const mockUseReactToolScheduler = useReactToolScheduler as Mock<
  (...args: never[]) => unknown
>;

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
    const setStateInternal = React.useCallback(
      (valueOrUpdater: React.SetStateAction<T>) => {
        const nextValue =
          typeof valueOrUpdater === 'function'
            ? valueOrUpdater(ref.current)
            : valueOrUpdater;
        ref.current = nextValue;
        setState(nextValue);
      },
      [],
    );
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

// --- Tests for useAgentStream Hook ---
describe('useAgentStream', () => {
  let mockAddItem: Mock<(...args: never[]) => unknown>;
  let mockConfig: Config;
  let mockOnDebugMessage: Mock<(...args: never[]) => unknown>;
  let mockHandleSlashCommand: Mock<(...args: never[]) => unknown>;
  let mockScheduleToolCalls: Mock<(...args: never[]) => unknown>;
  let mockCancelAllToolCalls: Mock<(...args: never[]) => unknown>;
  let mockMarkToolsAsDisplayCleared: Mock<(...args: never[]) => unknown>;
  let handleAtCommandSpy: Mock<(...args: never[]) => unknown>;

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
      llxprtMdFileCount: 0,
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
    handleAtCommandSpy = vi.spyOn(atCommandProcessor, 'handleAtCommand');
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

  it('should process @include commands, adding user turn after processing to prevent race conditions', async () => {
    const rawQuery = '@include file.txt Summarize this.';
    const processedQueryParts = [
      { text: 'Summarize this with content from @file.txt' },
      { text: 'File content...' },
    ];
    const userMessageTimestamp = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(userMessageTimestamp);

    handleAtCommandSpy.mockResolvedValue({
      processedQuery: processedQueryParts,
      shouldProceed: true,
    });

    const { result } = renderHook(() =>
      useAgentStream(
        createFakeAgentFromMockClient(new MockedAgentClientClass(mockConfig)),
        [],
        mockAddItem,
        createStreamRuntimeForTest(mockConfig),
        mockLoadedSettings,
        mockOnDebugMessage,
        mockHandleSlashCommand,
        false, // shellModeActive
        vi.fn(), // getPreferredEditor
        vi.fn(), // onAuthError
        vi.fn(), // performMemoryRefresh
        false, // modelSwitched
        vi.fn(), // setModelSwitched
        vi.fn(), // onCancelSubmit
        vi.fn(), // setShellInputFocused
        80, // terminalWidth
        24, // terminalHeight
      ),
    );

    await act(async () => {
      await result.current.submitQuery(rawQuery);
    });

    expect(handleAtCommandSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: rawQuery,
      }),
    );

    expect(mockAddItem).toHaveBeenCalledWith(
      {
        type: MessageType.USER,
        text: rawQuery,
      },
      userMessageTimestamp,
    );

    // The parts are concatenated into a single string before being sent, so
    // assert the resolved @file content travels with the prompt.
    expect(mockSendMessageStream).toHaveBeenCalledWith(
      processedQueryParts.map((part) => part.text).join(''),
      expect.any(AbortSignal),
      expect.any(String),
    );
  });
});
