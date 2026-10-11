/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { automock } from '@vybestack/llxprt-code-test-utils';
import type { Mock } from 'bun:test';
import {
  MockedAgentClientClass,
  mockSendMessageStream,
  mockStartChat,
  createFakeAgentFromMockClient,
} from './__tests__/useAgentStream-test-helpers.js';
import { describe, it, expect, vi, beforeEach } from 'bun:test';
import { act } from 'react';
import { renderHook } from '../../__tests__/render.js';
import { useAgentStream } from './agentStream/index.js';
import { createStreamRuntimeForTest } from './agentStream/__tests__/streamRuntimeTestHelper.js';
import * as atCommandProcessor from './atCommandProcessor.js';
import { useReactToolScheduler } from './useReactToolScheduler.js';
import type { Config, ToolRegistry } from '@vybestack/llxprt-code-core';
import { ApprovalMode } from '@vybestack/llxprt-code-core';
import { MessageType } from '../types.js';
import type { LoadedSettings } from '../../config/settings.js';

// --- MOCKS ---
const realAtCommandProcessorModule = {
  ...(await import('./atCommandProcessor.js')),
};

const actualSchedulerModule = {
  ...(await import('./useReactToolScheduler.js')),
};
const mockUseReactToolScheduler = vi.fn<typeof useReactToolScheduler>();
void vi.mock('./useReactToolScheduler.js', () => ({
  ...actualSchedulerModule,
  useReactToolScheduler: mockUseReactToolScheduler,
}));

void vi.mock('./useKeypress.js', () => ({
  useKeypress: vi.fn(),
}));

void vi.mock('./shellCommandProcessor.js', () => ({
  useShellCommandProcessor: vi.fn().mockReturnValue({
    handleShellCommand: vi.fn(),
  }),
}));

void vi.mock('./atCommandProcessor.js', () =>
  automock(realAtCommandProcessorModule),
);

void vi.mock('../utils/markdownUtilities.js', () => ({
  findLastSafeSplitPoint: vi.fn((s: string) => s.length),
}));

void vi.mock('./useLogger.js', () => ({
  useLogger: vi.fn().mockReturnValue({
    logMessage: vi.fn().mockResolvedValue(undefined),
  }),
}));

const mockStartNewPrompt = vi.fn();
const mockAddUsage = vi.fn();
void vi.mock('../contexts/SessionContext.js', () => ({
  useSessionStats: vi.fn(() => ({
    startNewPrompt: mockStartNewPrompt,
    addUsage: mockAddUsage,
    getPromptCount: vi.fn(() => 5),
  })),
}));

void vi.mock('./slashCommandProcessor.js', () => ({
  handleSlashCommand: vi.fn().mockReturnValue(false),
}));

// --- END MOCKS ---

// --- Tests for useAgentStream Hook ---
describe('useAgentStream', () => {
  let mockAddItem: Mock<Parameters<typeof useAgentStream>[2]>;
  let mockConfig: Config;
  let mockOnDebugMessage: Mock<(message: string) => void>;
  let mockHandleSlashCommand: Mock<Parameters<typeof useAgentStream>[6]>;
  let mockScheduleToolCalls: Mock<ReturnType<typeof useReactToolScheduler>[1]>;
  let mockCancelAllToolCalls: Mock<ReturnType<typeof useReactToolScheduler>[3]>;
  let mockMarkToolsAsDisplayCleared: Mock<
    ReturnType<typeof useReactToolScheduler>[2]
  >;
  let handleAtCommandSpy: Mock<typeof atCommandProcessor.handleAtCommand>;

  beforeEach(() => {
    vi.clearAllMocks(); // Clear mocks before each test

    mockAddItem = vi.fn<Parameters<typeof useAgentStream>[2]>(() => 0);
    // Define the mock for getAgentClient

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
      [],
      mockScheduleToolCalls,
      mockMarkToolsAsDisplayCleared,
      mockCancelAllToolCalls,
      0,
      true,
      vi.fn(),
      vi.fn(),
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
      { type: 'text', text: 'Summarize this with content from @file.txt' },
      { type: 'text', text: 'File content...' },
    ] satisfies NonNullable<
      Awaited<
        ReturnType<typeof atCommandProcessor.handleAtCommand>
      >['processedQuery']
    >;
    const userMessageTimestamp = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(userMessageTimestamp);

    handleAtCommandSpy.mockResolvedValue({
      processedQuery: processedQueryParts,
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
        false,
        vi.fn(),
        vi.fn(),
        vi.fn(),
        () => {},
        vi.fn(),
        vi.fn(),
        80,
        24,
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
