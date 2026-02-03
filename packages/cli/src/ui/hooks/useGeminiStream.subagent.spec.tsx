/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, Mock, beforeEach } from 'vitest';
import React, { act } from 'react';
import { renderHook, waitFor } from '../../test-utils/render.js';
import * as ReactDOM from 'react-dom';
import { useGeminiStream } from './useGeminiStream.js';
import {
  useReactToolScheduler,
  TrackedCompletedToolCall,
  TrackedToolCall,
} from './useReactToolScheduler.js';
import {
  Config,
  GeminiClient,
  EditorType,
  AnyToolInvocation,
} from '@vybestack/llxprt-code-core';
import { Part, PartListUnion } from '@google/genai';
import { LoadedSettings } from '../../config/settings.js';
import { UseHistoryManagerReturn } from './useHistoryManager.js';
import { SlashCommandProcessorResult } from '../types.js';

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

const MockedGeminiClientClass = vi.hoisted(() =>
  vi.fn().mockImplementation(function (this: any, _config: any) {
    this.startChat = mockStartChat;
    this.sendMessageStream = mockSendMessageStream;
    this.addHistory = vi.fn();
  }),
);

vi.mock('./useReactToolScheduler.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('./useReactToolScheduler.js')>();
  return {
    ...original,
    useReactToolScheduler: vi.fn(),
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
  let mockMarkToolsAsSubmitted: Mock;

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

    const mockGetGeminiClient = vi.fn().mockImplementation(() => {
      const clientInstance = new MockedGeminiClientClass(mockConfig);
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
        () => ({ getToolSchemaList: vi.fn(() => []) }) as any,
      ),
      getProjectRoot: vi.fn(() => '/tmp/project'),
      getCheckpointingEnabled: vi.fn(() => false),
      getGeminiClient: mockGetGeminiClient,
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
    mockMarkToolsAsSubmitted = vi.fn();

    const mockCancelAllToolCalls = vi.fn();

    mockUseReactToolScheduler.mockReturnValue([
      [],
      mockScheduleToolCalls,
      mockMarkToolsAsSubmitted,
      mockCancelAllToolCalls,
    ]);

    mockStartChat.mockClear().mockResolvedValue({
      sendMessageStream: mockSendMessageStream,
    } as unknown as GeminiClient);
    mockSendMessageStream
      .mockClear()
      .mockReturnValue((async function* () {})());
  });

  it('subagent completions should not reach Gemini submission pipeline', async () => {
    const client = new MockedGeminiClientClass(mockConfig);

    let capturedOnComplete:
      | ((
          schedulerId: symbol,
          completedTools: TrackedToolCall[],
          options: { isPrimary: boolean },
        ) => Promise<void>)
      | null = null;

    mockUseReactToolScheduler.mockImplementation((onComplete) => {
      capturedOnComplete = onComplete as typeof capturedOnComplete;
      return [[], mockScheduleToolCalls, mockMarkToolsAsSubmitted, vi.fn()];
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
      responseSubmittedToGemini: false,
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
      } as any,
    };

    await act(async () => {
      if (capturedOnComplete) {
        await capturedOnComplete(Symbol('scheduler'), [subagentToolCall], {
          isPrimary: true,
        });
      }
    });

    await waitFor(() => {
      expect(mockMarkToolsAsSubmitted).toHaveBeenCalledWith(['subagent-call']);
      expect(mockSendMessageStream).not.toHaveBeenCalled();
      expect(client.addHistory).not.toHaveBeenCalled();
    });
  });
});
