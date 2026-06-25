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
import { useGeminiStream } from './geminiStream/index.js';
import * as atCommandProcessor from './atCommandProcessor.js';
import type { TrackedToolCall } from './useReactToolScheduler.js';
import { useReactToolScheduler } from './useReactToolScheduler.js';
import type {
  Config,
  EditorType,
  ToolRegistry,
} from '@vybestack/llxprt-code-core';
import { ApprovalMode } from '@vybestack/llxprt-code-core';
import type { PartListUnion } from '@google/genai';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';
import type { SlashCommandProcessorResult } from '../types.js';
import { MessageType } from '../types.js';
import type { LoadedSettings } from '../../config/settings.js';

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

  describe('MCP discovery gating', () => {
    let mcpMockConfig: Config;
    let mcpManagerMock: {
      getDiscoveryState: Mock;
    };

    const renderWithMcp = (
      discoveryState: string,
      mcpServers?: Record<string, unknown>,
    ) => {
      mcpManagerMock = {
        getDiscoveryState: vi.fn().mockReturnValue(discoveryState),
      };

      mcpMockConfig = {
        ...mockConfig,
        getMcpClientManager: vi.fn().mockReturnValue(mcpManagerMock),
        getMcpServers: vi
          .fn()
          .mockReturnValue(mcpServers ?? { server1: {}, server2: {} }),
      } as unknown as Config;

      const contentGeneratorConfig = {
        model: 'test-model',
        apiKey: 'test-key',
        vertexai: false,
      };

      mcpMockConfig.getContentGeneratorConfig = vi
        .fn()
        .mockReturnValue(contentGeneratorConfig);

      const client = new MockedAgentClientClass(mcpMockConfig);

      const initialProps = {
        client,
        history: [],
        addItem: mockAddItem as unknown as UseHistoryManagerReturn['addItem'],
        config: mcpMockConfig,
        onDebugMessage: mockOnDebugMessage,
        handleSlashCommand: mockHandleSlashCommand as unknown as (
          cmd: PartListUnion,
        ) => Promise<SlashCommandProcessorResult | false>,
        shellModeActive: false,
        loadedSettings: mockLoadedSettings,
        toolCalls: [] as TrackedToolCall[],
      };

      const { result, rerender } = renderHook(
        (props: typeof initialProps) => {
          mockUseReactToolScheduler.mockReturnValue([
            props.toolCalls,
            mockScheduleToolCalls,
            mockMarkToolsAsDisplayCleared,
            mockCancelAllToolCalls,
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
        { initialProps },
      );
      return { result, rerender };
    };

    it('blocks non-slash query when MCP discovery is in_progress', async () => {
      const { result } = renderWithMcp('in_progress');

      await act(async () => {
        await result.current.submitQuery('hello world');
      });

      expect(mockAddItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.INFO,
          text: expect.stringContaining('Waiting for MCP servers'),
        }),
        expect.any(Number),
      );
      expect(mockSendMessageStream).not.toHaveBeenCalled();
    });

    it('allows non-slash query when MCP discovery is completed', async () => {
      const { result } = renderWithMcp('completed');

      await act(async () => {
        await result.current.submitQuery('hello world');
      });

      expect(mockAddItem).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.INFO,
          text: expect.stringContaining('Waiting for MCP servers'),
        }),
        expect.any(Number),
      );
      expect(mockSendMessageStream).toHaveBeenCalled();
    });

    it('allows non-slash query when no MCP servers are configured', async () => {
      const { result } = renderWithMcp('in_progress', {});

      await act(async () => {
        await result.current.submitQuery('hello world');
      });

      expect(mockAddItem).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.INFO,
          text: expect.stringContaining('Waiting for MCP servers'),
        }),
        expect.any(Number),
      );
      expect(mockSendMessageStream).toHaveBeenCalled();
    });

    it('allows slash commands when MCP discovery is in_progress', async () => {
      const { result } = renderWithMcp('in_progress');

      await act(async () => {
        await result.current.submitQuery('/help');
      });

      expect(mockAddItem).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.INFO,
          text: expect.stringContaining('Waiting for MCP servers'),
        }),
        expect.any(Number),
      );
      expect(mockSendMessageStream).toHaveBeenCalled();
    });

    it('allows non-slash query when no McpClientManager exists', async () => {
      const noMcpConfig = {
        ...mockConfig,
        getMcpClientManager: vi.fn().mockReturnValue(undefined),
        getMcpServers: vi.fn().mockReturnValue(undefined),
      } as unknown as Config;

      const contentGeneratorConfig = {
        model: 'test-model',
        apiKey: 'test-key',
        vertexai: false,
      };

      noMcpConfig.getContentGeneratorConfig = vi
        .fn()
        .mockReturnValue(contentGeneratorConfig);

      const client = new MockedAgentClientClass(noMcpConfig);

      const initialProps = {
        client,
        history: [],
        addItem: mockAddItem as unknown as UseHistoryManagerReturn['addItem'],
        config: noMcpConfig,
        onDebugMessage: mockOnDebugMessage,
        handleSlashCommand: mockHandleSlashCommand as unknown as (
          cmd: PartListUnion,
        ) => Promise<SlashCommandProcessorResult | false>,
        shellModeActive: false,
        loadedSettings: mockLoadedSettings,
        toolCalls: [] as TrackedToolCall[],
      };

      const { result } = renderHook(
        (props: typeof initialProps) => {
          mockUseReactToolScheduler.mockReturnValue([
            props.toolCalls,
            mockScheduleToolCalls,
            mockMarkToolsAsDisplayCleared,
            mockCancelAllToolCalls,
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
        { initialProps },
      );

      await act(async () => {
        await result.current.submitQuery('hello world');
      });

      expect(mockAddItem).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.INFO,
          text: expect.stringContaining('Waiting for MCP servers'),
        }),
        expect.any(Number),
      );
      expect(mockSendMessageStream).toHaveBeenCalled();
    });

    it('blocks non-slash query when discovery is not_started and servers exist', async () => {
      const { result } = renderWithMcp('not_started');

      await act(async () => {
        await result.current.submitQuery('hello world');
      });

      expect(mockAddItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.INFO,
          text: expect.stringContaining('Waiting for MCP servers'),
        }),
        expect.any(Number),
      );
      expect(mockSendMessageStream).not.toHaveBeenCalled();
    });

    it('allows continuation queries regardless of MCP state', async () => {
      const { result } = renderWithMcp('in_progress');

      await act(async () => {
        await result.current.submitQuery('continuation query', {
          isContinuation: true,
        });
      });

      expect(mockAddItem).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.INFO,
          text: expect.stringContaining('Waiting for MCP servers'),
        }),
        expect.any(Number),
      );
      expect(mockSendMessageStream).toHaveBeenCalled();
    });
  });
});
