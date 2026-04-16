/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, type Mock } from 'vitest';
import type {
  ToolCall,
  WaitingToolCall,
  CompletedToolCall,
  ErroredToolCall,
} from './coreToolScheduler.js';
import {
  CoreToolScheduler,
  ToolCall,
  WaitingToolCall,
} from './coreToolScheduler.js';
import { convertToFunctionResponse } from '../utils/generateContentResponseUtilities.js';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  ToolCallConfirmationDetails,
  ToolConfirmationOutcome,
  ToolConfirmationPayload,
  ToolInvocation,
  ToolResult,
  Config,
  Kind,
  ApprovalMode,
  ToolRegistry,
} from '../index.js';
import { DEFAULT_GEMINI_MODEL } from '../config/models.js';
import { MockTool } from '../test-utils/mock-tool.js';
import { MockModifiableTool } from '../test-utils/tools.js';
import { Part, PartListUnion, type Content } from '@google/genai';
import type { ContextAwareTool, ToolContext } from '../tools/tool-context.js';
import { PolicyDecision } from '../policy/types.js';
import {
  MessageBusType,
  type ToolConfirmationResponse,
} from '../confirmation-bus/types.js';
import { ToolErrorType } from '../tools/tool-error.js';
import { HistoryService } from '../services/history/HistoryService.js';
import { ContentConverters } from '../services/history/ContentConverters.js';
import type { ToolCallBlock } from '../services/history/IContent.js';
import { HookSystem } from '../hooks/hookSystem.js';

// Test constants for tool output truncation
const DEFAULT_TRUNCATE_TOOL_OUTPUT_THRESHOLD = 30000;
const DEFAULT_TRUNCATE_TOOL_OUTPUT_LINES = 100;

// Helper function to create a mock MessageBus
function createMockMessageBus() {
  return {
    subscribe: vi.fn().mockReturnValue(() => {}),
    publish: vi.fn(),
    respondToConfirmation: vi.fn(),
    requestConfirmation: vi.fn().mockResolvedValue(true),
    removeAllListeners: vi.fn(),
    listenerCount: vi.fn().mockReturnValue(0),
  };
}

// Helper function to create a mock PolicyEngine
function createMockPolicyEngine() {
  return {
    evaluate: vi.fn().mockReturnValue(PolicyDecision.ALLOW),
    checkDecision: vi.fn().mockReturnValue(PolicyDecision.ALLOW),
  };
}

// Helper function to create a mock Config
function createMockConfig(overrides: Partial<Config> = {}): Config {
  const defaults = {
    getSessionId: () => 'test-session-id',
    getUsageStatisticsEnabled: () => true,
    getDebugMode: () => false,
    getApprovalMode: () => ApprovalMode.YOLO,
    getEphemeralSettings: () => ({}),
    getAllowedTools: () => [],
    getContentGeneratorConfig: () => ({
      model: 'test-model',
    }),
    getToolRegistry: () => ({
      getFunctionDeclarations: vi.fn().mockReturnValue([]),
      getTool: vi.fn().mockReturnValue(null),
      getAllTools: vi.fn().mockReturnValue([]),
    }),
    getMessageBus: vi.fn().mockReturnValue(createMockMessageBus()),
    getPolicyEngine: vi.fn().mockReturnValue(createMockPolicyEngine()),
    getEnableHooks: () => false,
    getHookSystem: () => null,
    getModel: () => DEFAULT_GEMINI_MODEL,
    isInteractive: () => false,
  };
  return { ...defaults, ...overrides } as unknown as Config;
}

class AbortDuringConfirmationInvocation extends BaseToolInvocation<
  Record<string, unknown>,
  ToolResult
> {
  constructor(
    private readonly abortController: AbortController,
    private readonly abortError: Error,
    params: Record<string, unknown>,
    messageBus: ReturnType<
      typeof createMockMessageBus
    > = createMockMessageBus(),
  ) {
    super(params, messageBus);
  }

  override async shouldConfirmExecute(
    _signal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    this.abortController.abort();
    throw this.abortError;
  }

  async execute(): Promise<ToolResult> {
    return {
      llmContent: 'Tool execution aborted during confirmation.',
      returnDisplay: 'Tool execution aborted during confirmation.',
    };
  }

  getDescription(): string {
    return 'Abort during confirmation invocation';
  }
}

class AbortDuringConfirmationTool extends BaseDeclarativeTool<
  Record<string, unknown>,
  ToolResult
> {
  constructor(
    private readonly abortController: AbortController,
    private readonly abortError: Error,
    messageBus: ReturnType<
      typeof createMockMessageBus
    > = createMockMessageBus(),
  ) {
    super(
      'abortDuringConfirmationTool',
      'Abort During Confirmation Tool',
      'Test tool that aborts while confirming execution.',
      Kind.Other,
      { type: 'object', properties: {} },
      true,
      false,
      messageBus,
    );
  }

  protected createInvocation(
    params: Record<string, unknown>,
    messageBus: ReturnType<typeof createMockMessageBus>,
  ): ToolInvocation<Record<string, unknown>, ToolResult> {
    return new AbortDuringConfirmationInvocation(
      this.abortController,
      this.abortError,
      params,
      messageBus,
    );
  }
}

async function waitForStatus(
  onToolCallsUpdate: Mock,
  status: ToolCall['status'],
): Promise<ToolCall | undefined> {
  let matchingCall: ToolCall | undefined;
  await vi.waitFor(() => {
    const latestCalls = onToolCallsUpdate.mock.calls.at(-1)?.[0] as
      | ToolCall[]
      | undefined;
    matchingCall = latestCalls?.find((call) => call.status === status);
    if (!matchingCall) {
      throw new Error(
        `Waiting for status "${status}", latest statuses: ${
          latestCalls?.map((call) => call.status).join(', ') ?? 'none'
        }`,
      );
    }
  });
  return matchingCall;
}

describe('CoreToolScheduler', () => {
  it('should cancel a tool call if the signal is aborted before confirmation', async () => {
    const mockTool = new MockTool();
    mockTool.shouldConfirm = true;
    const declarativeTool = mockTool;
    const mockToolRegistry = {
      getTool: () => declarativeTool,
      getFunctionDeclarations: () => [],
      tools: new Map(),
      discovery: {},
      registerTool: () => {},
      getToolByName: () => declarativeTool,
      getToolByDisplayName: () => declarativeTool,
      getTools: () => [],
      discoverTools: async () => {},
      getAllTools: () => [],
      getToolsByServer: () => [],
    } as unknown as ToolRegistry;

    const onAllToolCallsComplete = vi.fn();
    const onToolCallsUpdate = vi.fn();

    const mockPolicyEngine = createMockPolicyEngine();
    mockPolicyEngine.evaluate = vi
      .fn()
      .mockReturnValue(PolicyDecision.ASK_USER);

    const mockConfig = {
      getSessionId: () => 'test-session-id',
      getUsageStatisticsEnabled: () => true,
      getDebugMode: () => false,
      isInteractive: () => true,
      getApprovalMode: () => ApprovalMode.DEFAULT,
      getEphemeralSettings: () => ({}),
      getAllowedTools: () => [],
      getContentGeneratorConfig: () => ({
        model: 'test-model',
      }),
      getToolRegistry: () => mockToolRegistry,
      getMessageBus: vi.fn().mockReturnValue(createMockMessageBus()),
      getEnableHooks: () => false,
      getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
      getModel: () => DEFAULT_GEMINI_MODEL,
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
      messageBus: mockConfig.getMessageBus(),
      toolRegistry: mockToolRegistry,
      onAllToolCallsComplete,
      onToolCallsUpdate,
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    const abortController = new AbortController();
    const request = {
      callId: '1',
      name: 'mockTool',
      args: {},
      isClientInitiated: false,
      prompt_id: 'prompt-id-1',
    };

    abortController.abort();
    await scheduler.schedule([request], abortController.signal);

    expect(onAllToolCallsComplete).toHaveBeenCalled();
    const completedCalls = onAllToolCallsComplete.mock
      .calls[0][0] as ToolCall[];
    expect(completedCalls[0].status).toBe('cancelled');
  });

  it('should skip confirmation when policy allows execution', async () => {
    const mockTool = new MockTool();
    mockTool.shouldConfirm = true;
    const declarativeTool = mockTool;
    const mockToolRegistry = {
      getTool: () => declarativeTool,
      getFunctionDeclarations: () => [],
      tools: new Map(),
      discovery: {},
      registerTool: () => {},
      getToolByName: () => declarativeTool,
      getToolByDisplayName: () => declarativeTool,
      getTools: () => [],
      discoverTools: async () => {},
      getAllTools: () => [],
      getToolsByServer: () => [],
    } as unknown as ToolRegistry;

    const onAllToolCallsComplete = vi.fn();
    const onToolCallsUpdate = vi.fn();

    const mockMessageBus = createMockMessageBus();
    const mockPolicyEngine = createMockPolicyEngine();
    mockPolicyEngine.evaluate = vi.fn().mockReturnValue(PolicyDecision.ALLOW);

    const mockConfig = {
      getSessionId: () => 'test-session-id',
      getUsageStatisticsEnabled: () => true,
      getDebugMode: () => false,
      isInteractive: () => true,
      getApprovalMode: () => ApprovalMode.DEFAULT,
      getEphemeralSettings: () => ({}),
      getAllowedTools: () => [],
      getContentGeneratorConfig: () => ({
        model: 'test-model',
      }),
      getToolRegistry: () => mockToolRegistry,
      getMessageBus: () => mockMessageBus,
      getPolicyEngine: () => mockPolicyEngine,
      getModel: () => DEFAULT_GEMINI_MODEL,
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
      messageBus: mockConfig.getMessageBus(),
      toolRegistry: mockToolRegistry,
      onAllToolCallsComplete,
      onToolCallsUpdate,
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    await scheduler.schedule(
      [
        {
          callId: 'allow-1',
          name: 'mockTool',
          args: {},
          isClientInitiated: false,
          prompt_id: 'prompt-allow',
        },
      ],
      new AbortController().signal,
    );

    expect(mockPolicyEngine.evaluate).toHaveBeenCalled();
    expect(onAllToolCallsComplete).toHaveBeenCalled();
    const completedCallsAllow = onAllToolCallsComplete.mock
      .calls[0][0] as ToolCall[];
    expect(completedCallsAllow[0].status).toBe('success');
    expect(mockMessageBus.publish).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageBusType.TOOL_CONFIRMATION_REQUEST,
      }),
    );
  });

  it('should reject tool execution when policy denies it', async () => {
    const mockTool = new MockTool();
    mockTool.shouldConfirm = true;
    const declarativeTool = mockTool;
    const mockToolRegistry = {
      getTool: () => declarativeTool,
      getFunctionDeclarations: () => [],
      tools: new Map(),
      discovery: {},
      registerTool: () => {},
      getToolByName: () => declarativeTool,
      getToolByDisplayName: () => declarativeTool,
      getTools: () => [],
      discoverTools: async () => {},
      getAllTools: () => [],
      getToolsByServer: () => [],
    } as unknown as ToolRegistry;

    const onAllToolCallsComplete = vi.fn();
    const onToolCallsUpdate = vi.fn();

    const mockMessageBus = createMockMessageBus();
    const mockPolicyEngine = createMockPolicyEngine();
    mockPolicyEngine.evaluate = vi.fn().mockReturnValue(PolicyDecision.DENY);

    const mockConfig = {
      getSessionId: () => 'test-session-id',
      getUsageStatisticsEnabled: () => true,
      getDebugMode: () => false,
      isInteractive: () => true,
      getApprovalMode: () => ApprovalMode.DEFAULT,
      getEphemeralSettings: () => ({}),
      getAllowedTools: () => [],
      getContentGeneratorConfig: () => ({
        model: 'test-model',
      }),
      getToolRegistry: () => mockToolRegistry,
      getMessageBus: () => mockMessageBus,
      getPolicyEngine: () => mockPolicyEngine,
      getModel: () => DEFAULT_GEMINI_MODEL,
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
      messageBus: mockConfig.getMessageBus(),
      toolRegistry: mockToolRegistry,
      onAllToolCallsComplete,
      onToolCallsUpdate,
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    await scheduler.schedule(
      [
        {
          callId: 'deny-1',
          name: 'mockTool',
          args: {},
          isClientInitiated: false,
          prompt_id: 'prompt-deny',
        },
      ],
      new AbortController().signal,
    );

    expect(onAllToolCallsComplete).toHaveBeenCalled();
    const completedCallsDeny = onAllToolCallsComplete.mock
      .calls[0][0] as ToolCall[];
    expect(completedCallsDeny[0].status).toBe('error');
    expect(completedCallsDeny[0].response?.errorType).toBe(
      ToolErrorType.POLICY_VIOLATION,
    );
    expect(mockMessageBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageBusType.TOOL_POLICY_REJECTION,
      }),
    );
  });

  it('should publish confirmation requests when policy asks the user', async () => {
    const mockTool = new MockTool();
    mockTool.shouldConfirm = true;
    const declarativeTool = mockTool;
    const mockToolRegistry = {
      getTool: () => declarativeTool,
      getFunctionDeclarations: () => [],
      tools: new Map(),
      discovery: {},
      registerTool: () => {},
      getToolByName: () => declarativeTool,
      getToolByDisplayName: () => declarativeTool,
      getTools: () => [],
      discoverTools: async () => {},
      getAllTools: () => [],
      getToolsByServer: () => [],
    } as unknown as ToolRegistry;

    const onAllToolCallsComplete = vi.fn();
    const onToolCallsUpdate = vi.fn();

    const mockMessageBus = createMockMessageBus();
    const mockPolicyEngine = createMockPolicyEngine();
    mockPolicyEngine.evaluate = vi
      .fn()
      .mockReturnValue(PolicyDecision.ASK_USER);
    let busHandler: ((message: ToolConfirmationResponse) => void) | undefined;
    mockMessageBus.subscribe.mockImplementation(
      (type: MessageBusType, handler: unknown) => {
        if (type === MessageBusType.TOOL_CONFIRMATION_RESPONSE) {
          busHandler = handler as (message: ToolConfirmationResponse) => void;
        }
        return () => {};
      },
    );
    const mockConfig = {
      getSessionId: () => 'test-session-id',
      getUsageStatisticsEnabled: () => true,
      getDebugMode: () => true,
      isInteractive: () => true,
      getApprovalMode: () => ApprovalMode.DEFAULT,
      getEphemeralSettings: () => ({}),
      getAllowedTools: () => [],
      getContentGeneratorConfig: () => ({
        model: 'test-model',
      }),
      getToolRegistry: () => mockToolRegistry,
      getMessageBus: () => mockMessageBus,
      getPolicyEngine: () => mockPolicyEngine,
      getModel: () => DEFAULT_GEMINI_MODEL,
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
      messageBus: mockConfig.getMessageBus(),
      toolRegistry: mockToolRegistry,
      onAllToolCallsComplete,
      onToolCallsUpdate,
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    await scheduler.schedule(
      [
        {
          callId: 'ask-1',
          name: 'mockTool',
          args: {},
          isClientInitiated: false,
          prompt_id: 'prompt-ask',
        },
      ],
      new AbortController().signal,
    );

    const latestUpdate = onToolCallsUpdate.mock.calls.at(-1)?.[0] as ToolCall[];
    const waitingCall = latestUpdate[0] as WaitingToolCall;
    expect(waitingCall.status).toBe('awaiting_approval');
    expect(waitingCall.confirmationDetails.correlationId).toBeDefined();
    const correlationId = waitingCall.confirmationDetails
      .correlationId as string;

    expect(mockMessageBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageBusType.TOOL_CONFIRMATION_REQUEST,
        correlationId,
      }),
    );

    expect(busHandler).toBeDefined();
    busHandler?.({
      type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
      correlationId,
      outcome: ToolConfirmationOutcome.ProceedOnce,
    });

    await vi.waitFor(() => {
      expect(onAllToolCallsComplete).toHaveBeenCalled();
      const completedCallsAsk = onAllToolCallsComplete.mock.calls.at(
        -1,
      )?.[0] as ToolCall[];
      expect(completedCallsAsk?.[0]?.status).toBe('success');
    });
  });

  it('should publish suggest edit response as not confirmed and execute with edited command', async () => {
    const executeFn = vi.fn().mockResolvedValue({
      llmContent: 'Shell command executed',
      returnDisplay: 'Shell command executed',
    });

    const mockShellTool = new MockTool({
      name: 'run_shell_command',
      shouldConfirmExecute: (params) =>
        Promise.resolve({
          type: 'exec',
          title: 'Confirm Shell Command',
          command: String(params['command'] ?? ''),
          rootCommand: 'npm',
          onConfirm: async () => {},
        }),
      execute: (params) => executeFn(params),
    });

    const mockToolRegistry = {
      getTool: () => mockShellTool,
      getFunctionDeclarations: () => [],
      tools: new Map(),
      discovery: {},
      registerTool: () => {},
      getToolByName: () => mockShellTool,
      getToolByDisplayName: () => mockShellTool,
      getTools: () => [],
      discoverTools: async () => {},
      getAllTools: () => [],
      getToolsByServer: () => [],
    } as unknown as ToolRegistry;

    const onAllToolCallsComplete = vi.fn();
    const onToolCallsUpdate = vi.fn();

    const mockMessageBus = createMockMessageBus();
    const mockPolicyEngine = createMockPolicyEngine();
    mockPolicyEngine.evaluate = vi
      .fn()
      .mockReturnValue(PolicyDecision.ASK_USER);

    let busHandler: ((message: ToolConfirmationResponse) => void) | undefined;
    mockMessageBus.subscribe.mockImplementation(
      (type: MessageBusType, handler: unknown) => {
        if (type === MessageBusType.TOOL_CONFIRMATION_RESPONSE) {
          busHandler = handler as (message: ToolConfirmationResponse) => void;
        }
        return () => {};
      },
    );

    const mockConfig = {
      getSessionId: () => 'test-session-id',
      getUsageStatisticsEnabled: () => true,
      getDebugMode: () => false,
      isInteractive: () => true,
      getApprovalMode: () => ApprovalMode.DEFAULT,
      getEphemeralSettings: () => ({}),
      getAllowedTools: () => [],
      getContentGeneratorConfig: () => ({
        model: 'test-model',
      }),
      getToolRegistry: () => mockToolRegistry,
      getMessageBus: () => mockMessageBus,
      getPolicyEngine: () => mockPolicyEngine,
      getShellExecutionConfig: () => ({
        terminalWidth: 80,
        terminalHeight: 24,
      }),
      getTerminalWidth: vi.fn(() => 80),
      getTerminalHeight: vi.fn(() => 24),
      storage: {
        getProjectTempDir: () => '/tmp',
      },
      getTruncateToolOutputThreshold: () =>
        DEFAULT_TRUNCATE_TOOL_OUTPUT_THRESHOLD,
      getTruncateToolOutputLines: () => DEFAULT_TRUNCATE_TOOL_OUTPUT_LINES,
      getUseSmartEdit: () => false,
      getUseModelRouter: () => false,
      getGeminiClient: () => null,
      getModel: () => DEFAULT_GEMINI_MODEL,
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
      messageBus: mockConfig.getMessageBus(),
      toolRegistry: mockToolRegistry,
      onAllToolCallsComplete,
      onToolCallsUpdate,
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    await scheduler.schedule(
      [
        {
          callId: 'ask-suggest-1',
          name: 'run_shell_command',
          args: { command: 'npm instal' },
          isClientInitiated: false,
          prompt_id: 'prompt-ask-suggest',
        },
      ],
      new AbortController().signal,
    );

    const latestUpdate = onToolCallsUpdate.mock.calls.at(-1)?.[0] as ToolCall[];
    const waitingCall = latestUpdate[0] as WaitingToolCall;
    expect(waitingCall.status).toBe('awaiting_approval');
    expect(waitingCall.confirmationDetails.correlationId).toBeDefined();
    const correlationId = waitingCall.confirmationDetails
      .correlationId as string;

    expect(busHandler).toBeDefined();
    busHandler?.({
      type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
      correlationId,
      outcome: ToolConfirmationOutcome.SuggestEdit,
      payload: {
        editedCommand: 'npm install',
      },
    });

    await vi.waitFor(() => {
      expect(onAllToolCallsComplete).toHaveBeenCalled();
      const completedCallsAsk = onAllToolCallsComplete.mock.calls.at(
        -1,
      )?.[0] as ToolCall[];
      expect(completedCallsAsk?.[0]?.status).toBe('success');
    });

    expect(executeFn).toHaveBeenCalledWith({ command: 'npm install' });

    const messageBusResponses = mockMessageBus.publish.mock.calls
      .map((call) => call[0])
      .filter(
        (message) => message.type === MessageBusType.TOOL_CONFIRMATION_RESPONSE,
      );

    expect(messageBusResponses).toHaveLength(0);
  });

  it('should mark tool call as cancelled when abort happens during confirmation error', async () => {
    const abortController = new AbortController();
    const abortError = new Error('Abort requested during confirmation');
    const declarativeTool = new AbortDuringConfirmationTool(
      abortController,
      abortError,
    );

    const mockToolRegistry = {
      getTool: () => declarativeTool,
      getFunctionDeclarations: () => [],
      tools: new Map(),
      discovery: {},
      registerTool: () => {},
      getToolByName: () => declarativeTool,
      getToolByDisplayName: () => declarativeTool,
      getTools: () => [],
      discoverTools: async () => {},
      getAllTools: () => [],
      getToolsByServer: () => [],
    } as unknown as ToolRegistry;

    const onAllToolCallsComplete = vi.fn();
    const onToolCallsUpdate = vi.fn();

    const mockPolicyEngine = createMockPolicyEngine();
    mockPolicyEngine.evaluate = vi
      .fn()
      .mockReturnValue(PolicyDecision.ASK_USER);

    const mockConfig = {
      getSessionId: () => 'test-session-id',
      getUsageStatisticsEnabled: () => true,
      getDebugMode: () => false,
      isInteractive: () => true,
      getApprovalMode: () => ApprovalMode.DEFAULT,
      getEphemeralSettings: () => ({}),
      getAllowedTools: () => [],
      getContentGeneratorConfig: () => ({
        model: 'test-model',
      }),
      getShellExecutionConfig: () => ({
        terminalWidth: 90,
        terminalHeight: 30,
      }),
      storage: {
        getProjectTempDir: () => '/tmp',
      },
      getTruncateToolOutputThreshold: () =>
        DEFAULT_TRUNCATE_TOOL_OUTPUT_THRESHOLD,
      getTruncateToolOutputLines: () => DEFAULT_TRUNCATE_TOOL_OUTPUT_LINES,
      getToolRegistry: () => mockToolRegistry,
      getUseModelRouter: () => false,
      getGeminiClient: () => null,
      getMessageBus: vi.fn().mockReturnValue(createMockMessageBus()),
      getEnableHooks: () => false,
      getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
      getModel: () => DEFAULT_GEMINI_MODEL,
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
      messageBus: mockConfig.getMessageBus(),
      toolRegistry: mockToolRegistry,
      onAllToolCallsComplete,
      onToolCallsUpdate,
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    const request = {
      callId: 'abort-1',
      name: 'abortDuringConfirmationTool',
      args: {},
      isClientInitiated: false,
      prompt_id: 'prompt-id-abort',
    };

    await scheduler.schedule([request], abortController.signal);

    expect(onAllToolCallsComplete).toHaveBeenCalled();
    const completedCalls = onAllToolCallsComplete.mock
      .calls[0][0] as ToolCall[];
    expect(completedCalls[0].status).toBe('cancelled');
    const statuses = onToolCallsUpdate.mock.calls.flatMap((call) =>
      (call[0] as ToolCall[]).map((toolCall) => toolCall.status),
    );
    expect(statuses).not.toContain('error');
  });

  it('should error when tool requires confirmation in non-interactive mode', async () => {
    // ARRANGE
    const mockTool = new MockTool({ name: 'confirmTool' });
    mockTool.shouldConfirm = true; // Tool requires confirmation

    const mockToolRegistry = {
      getTool: () => mockTool,
      getFunctionDeclarations: () => [],
      tools: new Map(),
      discovery: {},
      registerTool: () => {},
      getToolByName: () => mockTool,
      getToolByDisplayName: () => mockTool,
      getTools: () => [],
      discoverTools: async () => {},
      getAllTools: () => [],
      getToolsByServer: () => [],
    } as unknown as ToolRegistry;

    const onAllToolCallsComplete = vi.fn();
    const onToolCallsUpdate = vi.fn();

    const mockPolicyEngine = createMockPolicyEngine();
    mockPolicyEngine.evaluate = vi
      .fn()
      .mockReturnValue(PolicyDecision.ASK_USER);

    const mockConfig = {
      getSessionId: () => 'test-session-id',
      getUsageStatisticsEnabled: () => true,
      getDebugMode: () => false,
      isInteractive: () => false, // NON-INTERACTIVE MODE
      getApprovalMode: () => ApprovalMode.DEFAULT,
      getEphemeralSettings: () => ({}),
      getAllowedTools: () => [],
      getContentGeneratorConfig: () => ({ model: 'test-model' }),
      getToolRegistry: () => mockToolRegistry,
      getMessageBus: vi.fn().mockReturnValue(createMockMessageBus()),
      getEnableHooks: () => false,
      getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
      getModel: () => DEFAULT_GEMINI_MODEL,
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
      messageBus: mockConfig.getMessageBus(),
      toolRegistry: mockConfig.getToolRegistry(),
      onAllToolCallsComplete,
      onToolCallsUpdate,
      getPreferredEditor: () => 'vscode',
    });

    const request = {
      callId: 'non-interactive-confirm',
      name: 'confirmTool',
      args: {},
      isClientInitiated: false,
      prompt_id: 'prompt-1',
    };

    // ACT
    await scheduler.schedule([request], new AbortController().signal);

    // ASSERT
    expect(onAllToolCallsComplete).toHaveBeenCalled();
    const completedCalls = onAllToolCallsComplete.mock
      .calls[0][0] as ToolCall[];
    expect(completedCalls).toHaveLength(1);
    expect(completedCalls[0].status).toBe('error');

    const erroredCall = completedCalls[0] as ErroredToolCall;
    const errorResponse = erroredCall.response;
    const errorParts = errorResponse.responseParts;
    const errorMessage = errorParts[0].functionResponse.response.error;
    expect(errorMessage).toContain(
      'Tool execution for "confirmTool" requires user confirmation, which is not supported in non-interactive mode.',
    );
  });

  it('should not error in non-interactive mode with YOLO approval', async () => {
    // ARRANGE
    const mockTool = new MockTool({ name: 'yoloTool' });
    mockTool.shouldConfirm = true;

    const mockToolRegistry = {
      getTool: () => mockTool,
      getFunctionDeclarations: () => [],
      tools: new Map(),
      discovery: {},
      registerTool: () => {},
      getToolByName: () => mockTool,
      getToolByDisplayName: () => mockTool,
      getTools: () => [],
      discoverTools: async () => {},
      getAllTools: () => [],
      getToolsByServer: () => [],
    } as unknown as ToolRegistry;

    const onAllToolCallsComplete = vi.fn();
    const onToolCallsUpdate = vi.fn();

    const mockPolicyEngine = createMockPolicyEngine();
    mockPolicyEngine.evaluate = vi
      .fn()
      .mockReturnValue(PolicyDecision.ASK_USER);

    const mockConfig = {
      getSessionId: () => 'test-session-id',
      getUsageStatisticsEnabled: () => true,
      getDebugMode: () => false,
      isInteractive: () => false, // Non-interactive
      getApprovalMode: () => ApprovalMode.YOLO, // But YOLO mode
      getEphemeralSettings: () => ({}),
      getAllowedTools: () => [],
      getContentGeneratorConfig: () => ({ model: 'test-model' }),
      getToolRegistry: () => mockToolRegistry,
      getMessageBus: vi.fn().mockReturnValue(createMockMessageBus()),
      getEnableHooks: () => false,
      getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
      getModel: () => DEFAULT_GEMINI_MODEL,
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
      messageBus: mockConfig.getMessageBus(),
      toolRegistry: mockConfig.getToolRegistry(),
      onAllToolCallsComplete,
      onToolCallsUpdate,
      getPreferredEditor: () => 'vscode',
    });

    // ACT
    await scheduler.schedule(
      [
        {
          callId: 'yolo-1',
          name: 'yoloTool',
          args: {},
          isClientInitiated: false,
          prompt_id: 'prompt-1',
        },
      ],
      new AbortController().signal,
    );

    // ASSERT
    expect(onAllToolCallsComplete).toHaveBeenCalled();
    const completedCalls = onAllToolCallsComplete.mock
      .calls[0][0] as ToolCall[];
    expect(completedCalls[0].status).toBe('success'); // Not error
  });

  it('should not error in non-interactive mode for allowed tools', async () => {
    // ARRANGE
    const mockTool = new MockTool({ name: 'allowedTool' });
    mockTool.shouldConfirm = true;

    const mockToolRegistry = {
      getTool: () => mockTool,
      getFunctionDeclarations: () => [],
      tools: new Map(),
      discovery: {},
      registerTool: () => {},
      getToolByName: () => mockTool,
      getToolByDisplayName: () => mockTool,
      getTools: () => [],
      discoverTools: async () => {},
      getAllTools: () => [],
      getToolsByServer: () => [],
    } as unknown as ToolRegistry;

    const onAllToolCallsComplete = vi.fn();
    const onToolCallsUpdate = vi.fn();

    const mockPolicyEngine = createMockPolicyEngine();
    mockPolicyEngine.evaluate = vi
      .fn()
      .mockReturnValue(PolicyDecision.ASK_USER);

    const mockConfig = {
      getSessionId: () => 'test-session-id',
      getUsageStatisticsEnabled: () => true,
      getDebugMode: () => false,
      isInteractive: () => false, // Non-interactive
      getApprovalMode: () => ApprovalMode.DEFAULT,
      getEphemeralSettings: () => ({}),
      getAllowedTools: () => ['allowedTool'], // Tool is in allowed list
      getContentGeneratorConfig: () => ({ model: 'test-model' }),
      getToolRegistry: () => mockToolRegistry,
      getMessageBus: vi.fn().mockReturnValue(createMockMessageBus()),
      getEnableHooks: () => false,
      getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
      getModel: () => DEFAULT_GEMINI_MODEL,
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
      messageBus: mockConfig.getMessageBus(),
      toolRegistry: mockConfig.getToolRegistry(),
      onAllToolCallsComplete,
      onToolCallsUpdate,
      getPreferredEditor: () => 'vscode',
    });

    // ACT
    await scheduler.schedule(
      [
        {
          callId: 'allowed-1',
          name: 'allowedTool',
          args: {},
          isClientInitiated: false,
          prompt_id: 'prompt-1',
        },
      ],
      new AbortController().signal,
    );

    // ASSERT
    expect(onAllToolCallsComplete).toHaveBeenCalled();
    const completedCalls = onAllToolCallsComplete.mock
      .calls[0][0] as ToolCall[];
    expect(completedCalls[0].status).toBe('success'); // Not error
  });

  it('should handle mixed batch: safe tool executes, dangerous tool errors in non-interactive', async () => {
    // ARRANGE
    const safeTool = new MockTool({ name: 'safeTool' });
    safeTool.shouldConfirm = false; // No confirmation needed

    const dangerousTool = new MockTool({ name: 'dangerousTool' });
    dangerousTool.shouldConfirm = true; // Requires confirmation

    const mockToolRegistry = {
      getTool: (name: string) =>
        name === 'safeTool' ? safeTool : dangerousTool,
      getFunctionDeclarations: () => [],
      tools: new Map([
        ['safeTool', safeTool],
        ['dangerousTool', dangerousTool],
      ]),
      discovery: {},
      registerTool: () => {},
      getToolByName: (name: string) =>
        name === 'safeTool' ? safeTool : dangerousTool,
      getToolByDisplayName: (name: string) =>
        name === 'safeTool' ? safeTool : dangerousTool,
      getTools: () => [safeTool, dangerousTool],
      discoverTools: async () => {},
      getAllTools: () => [safeTool, dangerousTool],
      getToolsByServer: () => [],
    } as unknown as ToolRegistry;

    const onAllToolCallsComplete = vi.fn();
    const onToolCallsUpdate = vi.fn();

    const mockPolicyEngine = createMockPolicyEngine();
    mockPolicyEngine.evaluate = vi
      .fn()
      .mockReturnValue(PolicyDecision.ASK_USER);

    const mockConfig = {
      getSessionId: () => 'test-session-id',
      getUsageStatisticsEnabled: () => true,
      getDebugMode: () => false,
      isInteractive: () => false, // Non-interactive
      getApprovalMode: () => ApprovalMode.DEFAULT,
      getEphemeralSettings: () => ({}),
      getAllowedTools: () => [],
      getContentGeneratorConfig: () => ({ model: 'test-model' }),
      getToolRegistry: () => mockToolRegistry,
      getMessageBus: vi.fn().mockReturnValue(createMockMessageBus()),
      getEnableHooks: () => false,
      getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
      getModel: () => DEFAULT_GEMINI_MODEL,
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
      messageBus: mockConfig.getMessageBus(),
      toolRegistry: mockConfig.getToolRegistry(),
      onAllToolCallsComplete,
      onToolCallsUpdate,
      getPreferredEditor: () => 'vscode',
    });

    // ACT - Schedule both tools in a batch
    await scheduler.schedule(
      [
        {
          callId: 'safe-call',
          name: 'safeTool',
          args: {},
          isClientInitiated: false,
          prompt_id: 'prompt-1',
        },
        {
          callId: 'dangerous-call',
          name: 'dangerousTool',
          args: {},
          isClientInitiated: false,
          prompt_id: 'prompt-1',
        },
      ],
      new AbortController().signal,
    );

    // ASSERT
    expect(onAllToolCallsComplete).toHaveBeenCalled();
    const completedCalls = onAllToolCallsComplete.mock
      .calls[0][0] as ToolCall[];
    expect(completedCalls).toHaveLength(2);

    const safeCall = completedCalls.find(
      (c) => c.request.callId === 'safe-call',
    );
    const dangerousCall = completedCalls.find(
      (c) => c.request.callId === 'dangerous-call',
    );

    expect(safeCall?.status).toBe('success');
    expect(dangerousCall?.status).toBe('error');

    const erroredCall = dangerousCall as ErroredToolCall;
    const errorParts = erroredCall.response.responseParts;
    const errorMessage = errorParts[0].functionResponse.response.error;
    expect(errorMessage).toContain('requires user confirmation');
    expect(errorMessage).toContain('non-interactive mode');
  });

  it('propagates agentId from request to completed call payloads', async () => {
    const mockTool = new MockTool('mockTool');
    mockTool.executeFn.mockResolvedValue({
      llmContent: 'Tool executed',
      returnDisplay: 'Tool executed',
    });
    const toolRegistry = {
      getTool: () => mockTool,
      getToolByName: () => mockTool,
      getFunctionDeclarations: () => [],
      tools: new Map(),
      discovery: {},
      registerTool: () => {},
      getToolByDisplayName: () => mockTool,
      getTools: () => [],
      discoverTools: async () => {},
      getAllTools: () => [],
      getToolsByServer: () => [],
    };

    const onAllToolCallsComplete = vi.fn();
    const onToolCallsUpdate = vi.fn();

    const mockPolicyEngine = createMockPolicyEngine();
    mockPolicyEngine.evaluate = vi
      .fn()
      .mockReturnValue(PolicyDecision.ASK_USER);

    const mockConfig = {
      getSessionId: () => 'test-session-id',
      getUsageStatisticsEnabled: () => true,
      getDebugMode: () => false,
      isInteractive: () => true,
      getApprovalMode: () => ApprovalMode.DEFAULT,
      getAllowedTools: () => [],
      getToolRegistry: () => toolRegistry,
      getContentGeneratorConfig: () => ({
        model: 'test-model',
      }),
      getMessageBus: vi.fn().mockReturnValue(createMockMessageBus()),
      getEnableHooks: () => false,
      getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
      getModel: () => DEFAULT_GEMINI_MODEL,
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
      messageBus: mockConfig.getMessageBus(),
      toolRegistry: mockConfig.getToolRegistry(),
      onAllToolCallsComplete,
      onToolCallsUpdate,
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    const abortController = new AbortController();
    const request = {
      callId: 'agent-call',
      name: 'mockTool',
      args: {},
      isClientInitiated: false,
      prompt_id: 'prompt-agent',
      agentId: 'agent-sub-123',
    };

    await scheduler.schedule([request], abortController.signal);

    await vi.waitFor(() => {
      expect(onAllToolCallsComplete).toHaveBeenCalled();
    });

    const completedCalls = onAllToolCallsComplete.mock
      .calls[0][0] as CompletedToolCall[];

    expect(completedCalls[0].request.agentId).toBe('agent-sub-123');
    expect(completedCalls[0].response.agentId).toBe('agent-sub-123');
  });

  it('prefers tool result metadata agentId when present', async () => {
    const mockTool = new MockTool('mockTool');
    mockTool.executeFn.mockResolvedValue({
      llmContent: 'Tool executed',
      returnDisplay: 'Tool executed',
      metadata: { agentId: 'agent-meta-456' },
    });

    const toolRegistry = {
      getTool: () => mockTool,
      getToolByName: () => mockTool,
      getFunctionDeclarations: () => [],
      tools: new Map(),
      discovery: {},
      registerTool: () => {},
      getToolByDisplayName: () => mockTool,
      getTools: () => [],
      discoverTools: async () => {},
      getAllTools: () => [],
      getToolsByServer: () => [],
    };

    const onAllToolCallsComplete = vi.fn();
    const mockConfig = {
      getSessionId: () => 'test-session-id',
      getUsageStatisticsEnabled: () => true,
      getDebugMode: () => false,
      isInteractive: () => true,
      getApprovalMode: () => ApprovalMode.DEFAULT,
      getAllowedTools: () => [],
      getToolRegistry: () => toolRegistry,
      getContentGeneratorConfig: () => ({
        model: 'test-model',
      }),
      getMessageBus: vi.fn().mockReturnValue(createMockMessageBus()),
      getEnableHooks: () => false,
      getPolicyEngine: vi.fn().mockReturnValue(createMockPolicyEngine()),
      getModel: () => DEFAULT_GEMINI_MODEL,
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
      messageBus: mockConfig.getMessageBus(),
      toolRegistry: mockConfig.getToolRegistry(),
      onAllToolCallsComplete,
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    const abortController = new AbortController();
    const request = {
      callId: 'agent-call-meta',
      name: 'mockTool',
      args: {},
      isClientInitiated: false,
      prompt_id: 'prompt-agent',
      agentId: 'agent-request-123',
    };

    await scheduler.schedule(request, abortController.signal);

    await vi.waitFor(() => {
      expect(onAllToolCallsComplete).toHaveBeenCalled();
    });

    const [completedCalls] = onAllToolCallsComplete.mock.lastCall as [
      ToolCall[],
    ];
    expect(completedCalls[0].status).toBe('success');
    expect(completedCalls[0].request.agentId).toBe('agent-request-123');
    expect(completedCalls[0].response.agentId).toBe('agent-meta-456');
  });

  it('defaults agentId when scheduler receives a request without one', async () => {
    const mockTool = new MockTool('mockTool');
    mockTool.executeFn.mockResolvedValue({
      llmContent: 'Tool executed',
      returnDisplay: 'Tool executed',
    });
    const toolRegistry = {
      getTool: () => mockTool,
      getToolByName: () => mockTool,
      getFunctionDeclarations: () => [],
      tools: new Map(),
      discovery: {},
      registerTool: () => {},
      getToolByDisplayName: () => mockTool,
      getTools: () => [],
      discoverTools: async () => {},
      getAllTools: () => [],
      getToolsByServer: () => [],
    };

    const onAllToolCallsComplete = vi.fn();
    const onToolCallsUpdate = vi.fn();

    const mockPolicyEngine = createMockPolicyEngine();
    mockPolicyEngine.evaluate = vi
      .fn()
      .mockReturnValue(PolicyDecision.ASK_USER);

    const mockConfig = {
      getSessionId: () => 'test-session-id',
      getUsageStatisticsEnabled: () => true,
      getDebugMode: () => false,
      isInteractive: () => true,
      getApprovalMode: () => ApprovalMode.DEFAULT,
      getAllowedTools: () => [],
      getToolRegistry: () => toolRegistry,
      getContentGeneratorConfig: () => ({
        model: 'test-model',
      }),
      getMessageBus: vi.fn().mockReturnValue(createMockMessageBus()),
      getEnableHooks: () => false,
      getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
      getModel: () => DEFAULT_GEMINI_MODEL,
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
      messageBus: mockConfig.getMessageBus(),
      toolRegistry: mockConfig.getToolRegistry(),
      onAllToolCallsComplete,
      onToolCallsUpdate,
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    const abortController = new AbortController();
    const requestWithoutAgent = {
      callId: 'no-agent-call',
      name: 'mockTool',
      args: {},
      isClientInitiated: false,
      prompt_id: 'prompt-default',
    };

    await scheduler.schedule([requestWithoutAgent], abortController.signal);

    await vi.waitFor(() => {
      expect(onAllToolCallsComplete).toHaveBeenCalled();
    });

    const completedCalls = onAllToolCallsComplete.mock
      .calls[0][0] as CompletedToolCall[];

    expect(completedCalls[0].request.agentId).toBe('primary');
    expect(completedCalls[0].response.agentId).toBe('primary');
  });

  describe('getToolSuggestion', () => {
    it('should suggest the top N closest tool names for a typo', () => {
      // Create mocked tool registry
      const mockToolRegistry = {
        getAllToolNames: () => ['list_files', 'read_file', 'write_file'],
      } as unknown as ToolRegistry;
      const mockConfig = {
        getToolRegistry: () => mockToolRegistry,
        getMessageBus: vi.fn().mockReturnValue(createMockMessageBus()),
        getEnableHooks: () => false,
        getPolicyEngine: vi.fn().mockReturnValue(createMockPolicyEngine()),
        getModel: () => DEFAULT_GEMINI_MODEL,
      } as unknown as Config;

      // Create scheduler
      const scheduler = new CoreToolScheduler({
        config: mockConfig,
        messageBus: mockConfig.getMessageBus(),
        toolRegistry: mockConfig.getToolRegistry(),
        getPreferredEditor: () => 'vscode',
        onEditorClose: vi.fn(),
      });

      // Test that the right tool is selected, with only 1 result, for typos
      // @ts-expect-error accessing private method
      const misspelledTool = scheduler.getToolSuggestion('list_fils', 1);
      expect(misspelledTool).toBe(' Did you mean "list_files"?');

      // Test that the right tool is selected, with only 1 result, for prefixes
      // @ts-expect-error accessing private method
      const prefixedTool = scheduler.getToolSuggestion('github.list_files', 1);
      expect(prefixedTool).toBe(' Did you mean "list_files"?');

      // Test that the right tool is first
      // @ts-expect-error accessing private method
      const suggestionMultiple = scheduler.getToolSuggestion('list_fils');
      expect(suggestionMultiple).toBe(
        ' Did you mean one of: "list_files", "read_file", "write_file"?',
      );
    });
  });
});

describe('CoreToolScheduler with payload', () => {
  it('should update args and diff and execute tool when payload is provided', async () => {
    const mockTool = new MockModifiableTool();
    const declarativeTool = mockTool;
    const mockToolRegistry = {
      getTool: () => declarativeTool,
      getFunctionDeclarations: () => [],
      tools: new Map(),
      discovery: {},
      registerTool: () => {},
      getToolByName: () => declarativeTool,
      getToolByDisplayName: () => declarativeTool,
      getTools: () => [],
      discoverTools: async () => {},
      getAllTools: () => [],
      getToolsByServer: () => [],
    } as unknown as ToolRegistry;

    const onAllToolCallsComplete = vi.fn();
    const onToolCallsUpdate = vi.fn();

    const mockPolicyEngine = createMockPolicyEngine();
    mockPolicyEngine.evaluate = vi
      .fn()
      .mockReturnValue(PolicyDecision.ASK_USER);

    const mockConfig = {
      getSessionId: () => 'test-session-id',
      getUsageStatisticsEnabled: () => true,
      getDebugMode: () => false,
      isInteractive: () => true,
      getApprovalMode: () => ApprovalMode.DEFAULT,
      getEphemeralSettings: () => ({}),
      getAllowedTools: () => [],
      getContentGeneratorConfig: () => ({
        model: 'test-model',
      }),
      getToolRegistry: () => mockToolRegistry,
      getMessageBus: vi.fn().mockReturnValue(createMockMessageBus()),
      getEnableHooks: () => false,
      getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
      getModel: () => DEFAULT_GEMINI_MODEL,
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
      messageBus: mockConfig.getMessageBus(),
      toolRegistry: mockToolRegistry,
      onAllToolCallsComplete,
      onToolCallsUpdate,
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    const abortController = new AbortController();
    const request = {
      callId: '1',
      name: 'mockModifiableTool',
      args: {},
      isClientInitiated: false,
      prompt_id: 'prompt-id-2',
    };

    await scheduler.schedule([request], abortController.signal);

    const awaitingCall = (await waitForStatus(
      onToolCallsUpdate,
      'awaiting_approval',
    )) as WaitingToolCall;
    const confirmationDetails = awaitingCall.confirmationDetails;

    expect(confirmationDetails).toBeDefined();
    const payload: ToolConfirmationPayload = { newContent: 'final version' };
    await confirmationDetails.onConfirm(
      ToolConfirmationOutcome.ProceedOnce,
      payload,
    );

    await vi.waitFor(() => {
      expect(onAllToolCallsComplete).toHaveBeenCalled();
    });
    const completedCalls = onAllToolCallsComplete.mock
      .calls[0][0] as ToolCall[];
    expect(completedCalls[0].status).toBe('success');
    const executeCall =
      mockTool.executeFn.mock.calls[mockTool.executeFn.mock.calls.length - 1];
    expect(executeCall?.[0]).toStrictEqual({ newContent: 'final version' });
    expect(executeCall?.[1]).toBeInstanceOf(AbortSignal);
  });

  it('should update shell command args and execute when suggest edit payload is provided', async () => {
    const executeFn = vi.fn().mockResolvedValue({
      llmContent: 'Shell command executed',
      returnDisplay: 'Shell command executed',
    });

    const originalOnConfirm = vi.fn(
      async (
        _outcome: ToolConfirmationOutcome,
        _payload?: ToolConfirmationPayload,
      ) => {},
    );

    const mockShellTool = new MockTool({
      name: 'run_shell_command',
      shouldConfirmExecute: (params) =>
        Promise.resolve({
          type: 'exec',
          title: 'Confirm Shell Command',
          command: String(params['command'] ?? ''),
          rootCommand: 'npm',
          onConfirm: originalOnConfirm,
        }),
      execute: (params) => executeFn(params),
    });

    const toolRegistry = {
      getTool: () => mockShellTool,
      getToolByName: () => mockShellTool,
      getFunctionDeclarations: () => [],
      tools: new Map(),
      discovery: {},
      registerTool: () => {},
      getToolByDisplayName: () => mockShellTool,
      getTools: () => [],
      discoverTools: async () => {},
      getAllTools: () => [],
      getToolsByServer: () => [],
    } as unknown as ToolRegistry;

    const onAllToolCallsComplete = vi.fn();
    const onToolCallsUpdate = vi.fn();

    const mockPolicyEngine = createMockPolicyEngine();
    mockPolicyEngine.evaluate = vi
      .fn()
      .mockReturnValue(PolicyDecision.ASK_USER);

    const mockConfig = {
      getSessionId: () => 'test-session-id',
      getUsageStatisticsEnabled: () => true,
      getDebugMode: () => false,
      isInteractive: () => true,
      getApprovalMode: () => ApprovalMode.DEFAULT,
      getEphemeralSettings: () => ({}),
      getAllowedTools: () => [],
      getContentGeneratorConfig: () => ({
        model: 'test-model',
      }),
      getToolRegistry: () => toolRegistry,
      getMessageBus: vi.fn().mockReturnValue(createMockMessageBus()),
      getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
      getModel: () => DEFAULT_GEMINI_MODEL,
      getShellExecutionConfig: () => ({
        terminalWidth: 80,
        terminalHeight: 24,
      }),
      getTerminalWidth: vi.fn(() => 80),
      getTerminalHeight: vi.fn(() => 24),
      storage: {
        getProjectTempDir: () => '/tmp',
      },
      getTruncateToolOutputThreshold: () =>
        DEFAULT_TRUNCATE_TOOL_OUTPUT_THRESHOLD,
      getTruncateToolOutputLines: () => DEFAULT_TRUNCATE_TOOL_OUTPUT_LINES,
      getUseSmartEdit: () => false,
      getUseModelRouter: () => false,
      getGeminiClient: () => null,
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
      messageBus: mockConfig.getMessageBus(),
      toolRegistry: mockConfig.getToolRegistry(),
      onAllToolCallsComplete,
      onToolCallsUpdate,
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    const abortController = new AbortController();
    const request = {
      callId: 'shell-suggest-edit',
      name: 'run_shell_command',
      args: { command: 'npm instal' },
      isClientInitiated: false,
      prompt_id: 'prompt-shell-suggest-edit',
    };

    await scheduler.schedule([request], abortController.signal);

    const awaitingCall = (await waitForStatus(
      onToolCallsUpdate,
      'awaiting_approval',
    )) as WaitingToolCall;

    expect(awaitingCall.confirmationDetails).toBeDefined();

    const payload: ToolConfirmationPayload = {
      editedCommand: 'npm install',
    };

    await awaitingCall.confirmationDetails.onConfirm(
      ToolConfirmationOutcome.SuggestEdit,
      payload,
    );

    await vi.waitFor(() => {
      expect(onAllToolCallsComplete).toHaveBeenCalled();
    });

    expect(originalOnConfirm).toHaveBeenCalledWith(
      ToolConfirmationOutcome.SuggestEdit,
      payload,
    );

    const executeCall = executeFn.mock.calls[executeFn.mock.calls.length - 1];
    expect(executeCall?.[0]).toStrictEqual({ command: 'npm install' });
  });
});

describe('convertToFunctionResponse', () => {
  const toolName = 'testTool';
  const callId = 'call1';

  it('should handle simple string llmContent', () => {
    const llmContent = 'Simple text output';
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toStrictEqual([
      {
        functionResponse: {
          name: toolName,
          id: callId,
          response: { output: 'Simple text output' },
        },
      },
    ]);
  });

  it('should handle llmContent as a single Part with text', () => {
    const llmContent: Part = { text: 'Text from Part object' };
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toStrictEqual([
      {
        functionResponse: {
          name: toolName,
          id: callId,
          response: { output: 'Text from Part object' },
        },
      },
    ]);
  });

  it('should handle llmContent as a PartListUnion array with a single text Part', () => {
    const llmContent: PartListUnion = [{ text: 'Text from array' }];
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toStrictEqual([
      {
        functionResponse: {
          name: toolName,
          id: callId,
          response: { output: 'Text from array' },
        },
      },
    ]);
  });

  it('should handle llmContent with inlineData', () => {
    const llmContent: Part = {
      inlineData: { mimeType: 'image/png', data: 'base64...' },
    };
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toStrictEqual([
      {
        functionResponse: {
          name: toolName,
          id: callId,
          response: {
            output: 'Binary content provided (1 item(s)).',
          },
        },
      },
      llmContent,
    ]);
  });

  it('should handle llmContent with fileData', () => {
    const llmContent: Part = {
      fileData: { mimeType: 'application/pdf', fileUri: 'gs://...' },
    };
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toStrictEqual([
      {
        functionResponse: {
          name: toolName,
          id: callId,
          response: {
            output: 'Binary content provided (1 item(s)).',
          },
        },
      },
      llmContent,
    ]);
  });

  it('should handle llmContent as an array of multiple Parts (text and inlineData)', () => {
    const llmContent: PartListUnion = [
      { text: 'Some textual description' },
      { inlineData: { mimeType: 'image/jpeg', data: 'base64data...' } },
      { text: 'Another text part' },
    ];
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toStrictEqual([
      {
        functionResponse: {
          name: toolName,
          id: callId,
          response: { output: 'Some textual description\nAnother text part' },
        },
      },
      { inlineData: { mimeType: 'image/jpeg', data: 'base64data...' } },
    ]);
  });

  it('should handle llmContent as an array with a single inlineData Part', () => {
    const llmContent: PartListUnion = [
      { inlineData: { mimeType: 'image/gif', data: 'gifdata...' } },
    ];
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toStrictEqual([
      {
        functionResponse: {
          name: toolName,
          id: callId,
          response: {
            output: 'Binary content provided (1 item(s)).',
          },
        },
      },
      llmContent[0],
    ]);
  });

  it('should handle llmContent as a generic Part (not text, inlineData, or fileData)', () => {
    const llmContent: Part = { functionCall: { name: 'test', args: {} } };
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toStrictEqual([
      {
        functionResponse: {
          name: toolName,
          id: callId,
          response: {},
        },
      },
    ]);
  });

  it('should handle empty string llmContent', () => {
    const llmContent = '';
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toStrictEqual([
      {
        functionResponse: {
          name: toolName,
          id: callId,
          response: { output: '' },
        },
      },
    ]);
  });

  it('should handle llmContent as an empty array', () => {
    const llmContent: PartListUnion = [];
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toStrictEqual([
      {
        functionResponse: {
          name: toolName,
          id: callId,
          response: {},
        },
      },
    ]);
  });

  it('should handle llmContent as a Part with undefined inlineData/fileData/text', () => {
    const llmContent: Part = {}; // An empty part object
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toStrictEqual([
      {
        functionResponse: {
          name: toolName,
          id: callId,
          response: {},
        },
      },
    ]);
  });

  it('should ensure correct id when llmContent contains functionResponse without id', () => {
    const llmContent: Part = {
      functionResponse: {
        name: 'originalTool',
        response: { output: 'Tool completed successfully' },
      },
    };
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toStrictEqual([
      {
        functionResponse: {
          id: callId,
          name: toolName,
          response: { output: 'Tool completed successfully' },
        },
      },
    ]);
  });

  it('should override id when llmContent contains functionResponse with different id', () => {
    const llmContent: Part = {
      functionResponse: {
        id: 'wrong_id',
        name: 'originalTool',
        response: { output: 'Tool completed successfully' },
      },
    };
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toStrictEqual([
      {
        functionResponse: {
          id: callId,
          name: toolName,
          response: { output: 'Tool completed successfully' },
        },
      },
    ]);
  });

  it('should trim string outputs using tool-output limits when config is provided', () => {
    const llmContent = Array(5000).fill('long-line').join('\n');
    const config = {
      getEphemeralSettings: () => ({
        'tool-output-max-tokens': 50,
        'tool-output-truncate-mode': 'truncate',
      }),
      getModel: () => DEFAULT_GEMINI_MODEL,
    } as unknown as Config;

    const result = convertToFunctionResponse(
      toolName,
      callId,
      llmContent,
      config,
    );
    expect(
      result[0]?.functionResponse?.response?.['output'] as string,
    ).toContain('[Output truncated due to token limit]');
  });
});

class MockEditToolInvocation extends BaseToolInvocation<
  Record<string, unknown>,
  ToolResult
> {
  constructor(
    params: Record<string, unknown>,
    messageBus: ReturnType<
      typeof createMockMessageBus
    > = createMockMessageBus(),
  ) {
    super(params, messageBus);
  }

  getDescription(): string {
    return 'A mock edit tool invocation';
  }

  override async shouldConfirmExecute(
    _abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    return {
      type: 'edit',
      title: 'Confirm Edit',
      fileName: 'test.txt',
      filePath: 'test.txt',
      fileDiff:
        '--- test.txt\n+++ test.txt\n@@ -1,1 +1,1 @@\n-old content\n+new content',
      originalContent: 'old content',
      newContent: 'new content',
      onConfirm: async () => {},
    };
  }

  async execute(_abortSignal: AbortSignal): Promise<ToolResult> {
    return {
      llmContent: 'Edited successfully',
      returnDisplay: 'Edited successfully',
    };
  }
}

class MockEditTool extends BaseDeclarativeTool<
  Record<string, unknown>,
  ToolResult
> {
  constructor(
    messageBus: ReturnType<
      typeof createMockMessageBus
    > = createMockMessageBus(),
  ) {
    super(
      'mockEditTool',
      'mockEditTool',
      'A mock edit tool',
      Kind.Edit,
      {},
      true,
      false,
      messageBus,
    );
  }

  protected createInvocation(
    params: Record<string, unknown>,
    messageBus: ReturnType<typeof createMockMessageBus>,
  ): ToolInvocation<Record<string, unknown>, ToolResult> {
    return new MockEditToolInvocation(params, messageBus);
  }
}

describe('CoreToolScheduler edit cancellation', () => {
  it('should preserve diff when an edit is cancelled', async () => {
    const mockEditTool = new MockEditTool();
    const declarativeTool = mockEditTool;
    const mockToolRegistry = {
      getTool: () => declarativeTool,
      getFunctionDeclarations: () => [],
      tools: new Map(),
      discovery: {},
      registerTool: () => {},
      getToolByName: () => declarativeTool,
      getToolByDisplayName: () => declarativeTool,
      getTools: () => [],
      discoverTools: async () => {},
      getAllTools: () => [],
      getToolsByServer: () => [],
    } as unknown as ToolRegistry;

    const onAllToolCallsComplete = vi.fn();
    const onToolCallsUpdate = vi.fn();

    const mockPolicyEngine = createMockPolicyEngine();
    mockPolicyEngine.evaluate = vi
      .fn()
      .mockReturnValue(PolicyDecision.ASK_USER);

    const mockConfig = {
      getSessionId: () => 'test-session-id',
      getUsageStatisticsEnabled: () => true,
      getDebugMode: () => false,
      isInteractive: () => true,
      getApprovalMode: () => ApprovalMode.DEFAULT,
      getEphemeralSettings: () => ({}),
      getAllowedTools: () => [],
      getContentGeneratorConfig: () => ({
        model: 'test-model',
      }),
      getToolRegistry: () => mockToolRegistry,
      getMessageBus: vi.fn().mockReturnValue(createMockMessageBus()),
      getEnableHooks: () => false,
      getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
      getModel: () => DEFAULT_GEMINI_MODEL,
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
      messageBus: mockConfig.getMessageBus(),
      toolRegistry: mockToolRegistry,
      onAllToolCallsComplete,
      onToolCallsUpdate,
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    const abortController = new AbortController();
    const request = {
      callId: '1',
      name: 'mockEditTool',
      args: {},
      isClientInitiated: false,
      prompt_id: 'prompt-id-1',
    };

    await scheduler.schedule([request], abortController.signal);

    const awaitingCall = (await waitForStatus(
      onToolCallsUpdate,
      'awaiting_approval',
    )) as WaitingToolCall;

    // Cancel the edit
    const confirmationDetails = awaitingCall.confirmationDetails;
    if (confirmationDetails) {
      await confirmationDetails.onConfirm(ToolConfirmationOutcome.Cancel);
    }

    expect(onAllToolCallsComplete).toHaveBeenCalled();
    const completedCalls = onAllToolCallsComplete.mock
      .calls[0][0] as ToolCall[];

    expect(completedCalls[0].status).toBe('cancelled');

    // Check that the diff is preserved
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cancelledCall = completedCalls[0] as any;
    expect(cancelledCall.response.resultDisplay).toBeDefined();
    expect(cancelledCall.response.resultDisplay.fileDiff).toBe(
      '--- test.txt\n+++ test.txt\n@@ -1,1 +1,1 @@\n-old content\n+new content',
    );
    expect(cancelledCall.response.resultDisplay.fileName).toBe('test.txt');

    // Regression (Issue #864): ensure cancellation responseParts can be persisted
    // into provider-visible history as a paired tool_call + tool_response.
    const historyService = new HistoryService();
    const combinedContent: Content = {
      role: 'user',
      parts: cancelledCall.response.responseParts as Part[],
    };

    const turnKey = historyService.generateTurnKey();
    historyService.add(
      ContentConverters.toIContent(
        combinedContent,
        historyService.getIdGeneratorCallback(turnKey),
        undefined,
        turnKey,
      ),
    );

    const curated = historyService.getCuratedForProvider();
    expect(curated).toHaveLength(2);
    expect(curated[0].speaker).toBe('ai');
    expect(curated[0].blocks[0].type).toBe('tool_call');
    expect(curated[0].blocks[0]).toMatchObject({
      type: 'tool_call',
      name: 'mockEditTool',
    });
    const toolCallId = (curated[0].blocks[0] as ToolCallBlock).id;
    expect(toolCallId).toMatch(/^hist_tool_[a-zA-Z0-9_-]+$/);
    expect(curated[1].speaker).toBe('tool');
    expect(curated[1].blocks[0]).toMatchObject({
      type: 'tool_response',
      callId: toolCallId,
      toolName: 'mockEditTool',
    });
  });
});

describe('CoreToolScheduler queue handling', () => {
  // TODO: Fix these tests - the current implementation executes tools in parallel in YOLO mode
  // rather than sequentially. The queue prevents errors but doesn't enforce sequential execution.

  describe('CoreToolScheduler YOLO mode', () => {
    it('should execute tool requiring confirmation directly without waiting', async () => {
      // Arrange
      const mockTool = new MockTool();
      mockTool.executeFn.mockResolvedValue({
        llmContent: 'Tool executed',
        returnDisplay: 'Tool executed',
      });
      // This tool would normally require confirmation.
      mockTool.shouldConfirm = true;
      const declarativeTool = mockTool;

      const mockToolRegistry = {
        getTool: () => declarativeTool,
        getToolByName: () => declarativeTool,
        // Other properties are not needed for this test but are included for type consistency.
        getFunctionDeclarations: () => [],
        tools: new Map(),
        discovery: {},
        registerTool: () => {},
        getToolByDisplayName: () => declarativeTool,
        getTools: () => [],
        discoverTools: async () => {},
        getAllTools: () => [],
        getToolsByServer: () => [],
      } as unknown as ToolRegistry;

      const onAllToolCallsComplete = vi.fn();
      const onToolCallsUpdate = vi.fn();

      const mockPolicyEngine = createMockPolicyEngine();
      mockPolicyEngine.evaluate = vi
        .fn()
        .mockReturnValue(PolicyDecision.ASK_USER);

      // Configure the scheduler for YOLO mode.
      const mockConfig = {
        getSessionId: () => 'test-session-id',
        getUsageStatisticsEnabled: () => true,
        getDebugMode: () => false,
        getApprovalMode: () => ApprovalMode.YOLO,
        getEphemeralSettings: () => ({}),
        getAllowedTools: () => [],
        getContentGeneratorConfig: () => ({
          model: 'test-model',
        }),
        getToolRegistry: () => mockToolRegistry,
        getMessageBus: vi.fn().mockReturnValue(createMockMessageBus()),
        getEnableHooks: () => false,
        getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
        getModel: () => DEFAULT_GEMINI_MODEL,
      } as unknown as Config;

      const scheduler = new CoreToolScheduler({
        config: mockConfig,
        messageBus: mockConfig.getMessageBus(),
        toolRegistry: mockToolRegistry,
        onAllToolCallsComplete,
        onToolCallsUpdate,
        getPreferredEditor: () => 'vscode',
        onEditorClose: vi.fn(),
      });

      const abortController = new AbortController();
      const request = {
        callId: '1',
        name: 'mockTool',
        args: { param: 'value' },
        isClientInitiated: false,
        prompt_id: 'prompt-id-yolo',
      };

      // Act
      await scheduler.schedule([request], abortController.signal);
      await vi.waitFor(() => {
        expect(onAllToolCallsComplete).toHaveBeenCalled();
      });

      // Assert
      // 1. The tool's execute method was called directly.
      const executeCall =
        mockTool.executeFn.mock.calls[mockTool.executeFn.mock.calls.length - 1];
      expect(executeCall?.[0]).toStrictEqual({ param: 'value' });
      expect(executeCall?.[1]).toBeInstanceOf(AbortSignal);

      // 2. The tool call status never entered 'awaiting_approval'.
      const statusUpdates = onToolCallsUpdate.mock.calls
        .map((call) => (call[0][0] as ToolCall)?.status)
        .filter(Boolean);
      expect(statusUpdates).not.toContain('awaiting_approval');
      expect(statusUpdates).toStrictEqual([
        'validating',
        'scheduled',
        'executing',
        'success',
      ]);

      // 3. The final callback indicates the tool call was successful.
      expect(onAllToolCallsComplete).toHaveBeenCalled();
      const completedCalls = onAllToolCallsComplete.mock
        .calls[0][0] as ToolCall[];
      expect(completedCalls).toHaveLength(1);
      const completedCall = completedCalls[0];
      expect(completedCall.status).toBe('success');
      expect(completedCall.response.resultDisplay).toBe('Tool executed');
    });
  });
  describe('CoreToolScheduler Buffered Parallel Execution', () => {
    it('should execute tool calls in parallel but publish results in order', async () => {
      const completionOrder: number[] = [];
      const publishOrder: number[] = [];

      const executeFn = vi
        .fn()
        .mockImplementation(async (args: { call: number }) => {
          // Tool 1 takes longest (100ms)
          if (args.call === 1) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            completionOrder.push(1);
            return { llmContent: 'First call done' };
          }
          // Tool 2 completes first (20ms)
          if (args.call === 2) {
            await new Promise((resolve) => setTimeout(resolve, 20));
            completionOrder.push(2);
            return { llmContent: 'Second call done' };
          }
          // Tool 3 completes second (50ms)
          if (args.call === 3) {
            await new Promise((resolve) => setTimeout(resolve, 50));
            completionOrder.push(3);
            return { llmContent: 'Third call done' };
          }
          return { llmContent: 'default' };
        });

      const mockTool = new MockTool({ name: 'mockTool', execute: executeFn });
      const mockToolRegistry = {
        getTool: () => mockTool,
        getFunctionDeclarations: () => [],
        tools: new Map(),
        discovery: {},
        registerTool: () => {},
        getToolByName: () => mockTool,
        getToolByDisplayName: () => mockTool,
        getTools: () => [],
        discoverTools: async () => {},
        getAllTools: () => [],
        getToolsByServer: () => [],
      } as unknown as ToolRegistry;

      const onToolCallsUpdate = vi.fn();
      const mockPolicyEngine = createMockPolicyEngine();

      const mockConfig = {
        getSessionId: () => 'test-session-id',
        getUsageStatisticsEnabled: () => true,
        getDebugMode: () => false,
        getApprovalMode: () => ApprovalMode.YOLO,
        getEphemeralSettings: () => ({}),
        getAllowedTools: () => [],
        getContentGeneratorConfig: () => ({
          model: 'test-model',
        }),
        getToolRegistry: () => mockToolRegistry,
        getMessageBus: vi.fn().mockReturnValue(createMockMessageBus()),
        getEnableHooks: () => false,
        getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
        getModel: () => DEFAULT_GEMINI_MODEL,
      } as unknown as Config;

      const scheduler = new CoreToolScheduler({
        config: mockConfig,
        messageBus: mockConfig.getMessageBus(),
        toolRegistry: mockConfig.getToolRegistry(),
        onAllToolCallsComplete: vi.fn(),
        onToolCallsUpdate: (calls) => {
          onToolCallsUpdate(calls);
          calls.forEach((call) => {
            if (call.status === 'success') {
              const callNum = (call.request.args as { call: number }).call;
              if (!publishOrder.includes(callNum)) {
                publishOrder.push(callNum);
              }
            }
          });
        },
        getPreferredEditor: () => 'vscode',
        onEditorClose: vi.fn(),
      });

      const signal = new AbortController().signal;

      // Schedule 3 tool calls
      await scheduler.schedule(
        [
          {
            callId: 'call1',
            name: 'mockTool',
            args: { call: 1 },
            isClientInitiated: false,
            prompt_id: 'test',
          },
          {
            callId: 'call2',
            name: 'mockTool',
            args: { call: 2 },
            isClientInitiated: false,
            prompt_id: 'test',
          },
          {
            callId: 'call3',
            name: 'mockTool',
            args: { call: 3 },
            isClientInitiated: false,
            prompt_id: 'test',
          },
        ],
        signal,
      );

      // Wait for all calls to complete
      await vi.waitFor(() => {
        expect(completionOrder.length).toBe(3);
        expect(publishOrder.length).toBe(3);
      });

      // Verify parallel execution (completion order != request order)
      expect(completionOrder).toStrictEqual([2, 3, 1]); // Fastest to slowest

      // Verify ordered publishing (publish order == request order)
      expect(publishOrder).toStrictEqual([1, 2, 3]); // Request order maintained
    });

    it('should handle errors in parallel execution without blocking subsequent results', async () => {
      const completionOrder: number[] = [];
      const publishOrder: number[] = [];

      const executeFn = vi
        .fn()
        .mockImplementation(async (args: { call: number }) => {
          if (args.call === 1) {
            await new Promise((resolve) => setTimeout(resolve, 50));
            completionOrder.push(1);
            return { llmContent: 'First call done' };
          }
          if (args.call === 2) {
            await new Promise((resolve) => setTimeout(resolve, 20));
            completionOrder.push(2);
            throw new Error('Tool 2 failed');
          }
          if (args.call === 3) {
            await new Promise((resolve) => setTimeout(resolve, 30));
            completionOrder.push(3);
            return { llmContent: 'Third call done' };
          }
          return { llmContent: 'default' };
        });

      const mockTool = new MockTool({ name: 'mockTool', execute: executeFn });
      const mockToolRegistry = {
        getTool: () => mockTool,
        getFunctionDeclarations: () => [],
        tools: new Map(),
        discovery: {},
        registerTool: () => {},
        getToolByName: () => mockTool,
        getToolByDisplayName: () => mockTool,
        getTools: () => [],
        discoverTools: async () => {},
        getAllTools: () => [],
        getToolsByServer: () => [],
      } as unknown as ToolRegistry;

      const onToolCallsUpdate = vi.fn();
      const mockPolicyEngine = createMockPolicyEngine();

      const mockConfig = {
        getSessionId: () => 'test-session-id',
        getUsageStatisticsEnabled: () => true,
        getDebugMode: () => false,
        getApprovalMode: () => ApprovalMode.YOLO,
        getEphemeralSettings: () => ({}),
        getAllowedTools: () => [],
        getContentGeneratorConfig: () => ({
          model: 'test-model',
        }),
        getToolRegistry: () => mockToolRegistry,
        getMessageBus: vi.fn().mockReturnValue(createMockMessageBus()),
        getEnableHooks: () => false,
        getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
        getModel: () => DEFAULT_GEMINI_MODEL,
      } as unknown as Config;

      const scheduler = new CoreToolScheduler({
        config: mockConfig,
        messageBus: mockConfig.getMessageBus(),
        toolRegistry: mockConfig.getToolRegistry(),
        onAllToolCallsComplete: vi.fn(),
        onToolCallsUpdate: (calls) => {
          onToolCallsUpdate(calls);
          calls.forEach((call) => {
            if (call.status === 'success' || call.status === 'error') {
              const callNum = (call.request.args as { call: number }).call;
              if (!publishOrder.includes(callNum)) {
                publishOrder.push(callNum);
              }
            }
          });
        },
        getPreferredEditor: () => 'vscode',
        onEditorClose: vi.fn(),
      });

      const signal = new AbortController().signal;

      await scheduler.schedule(
        [
          {
            callId: 'call1',
            name: 'mockTool',
            args: { call: 1 },
            isClientInitiated: false,
            prompt_id: 'test',
          },
          {
            callId: 'call2',
            name: 'mockTool',
            args: { call: 2 },
            isClientInitiated: false,
            prompt_id: 'test',
          },
          {
            callId: 'call3',
            name: 'mockTool',
            args: { call: 3 },
            isClientInitiated: false,
            prompt_id: 'test',
          },
        ],
        signal,
      );

      // Wait for all calls to complete
      await vi.waitFor(() => {
        expect(completionOrder.length).toBe(3);
        expect(publishOrder.length).toBe(3);
      });

      // Verify parallel execution
      expect(completionOrder).toStrictEqual([2, 3, 1]); // Fastest to slowest

      // Verify ordered publishing despite error in tool 2
      expect(publishOrder).toStrictEqual([1, 2, 3]); // Request order maintained
    });

    it('should handle race condition when later tools complete while publishBufferedResults is exiting', async () => {
      // This test exercises the race condition where:
      // 1. Tool #3 finishes first, calls publishBufferedResults
      // 2. publishBufferedResults waits for tool #1, breaks out of inner while loop
      // 3. Just as it checks pendingPublishRequest (false) and is about to exit do-while
      // 4. Tool #1 finishes, sets pendingPublishRequest=true, returns immediately
      // 5. Without the fix: first publishBufferedResults exits without processing buffered results
      // 6. With the fix: the finally block detects pendingResults.size > 0 and reschedules
      //
      // The fix adds a check in the finally block to reschedule if pendingResults.size > 0

      const completionOrder: number[] = [];
      const publishOrder: number[] = [];

      // Use a deferred promise pattern to precisely control timing
      const resolvers: Map<number, () => void> = new Map();

      const executeFn = vi
        .fn()
        .mockImplementation(async (args: { call: number }) => {
          const callNum = args.call;
          // Create a promise that we can resolve externally
          await new Promise<void>((resolve) => {
            resolvers.set(callNum, resolve);
          });
          completionOrder.push(callNum);
          return { llmContent: `Call ${callNum} done` };
        });

      const mockTool = new MockTool({ name: 'mockTool', execute: executeFn });
      const mockToolRegistry = {
        getTool: () => mockTool,
        getFunctionDeclarations: () => [],
        tools: new Map(),
        discovery: {},
        registerTool: () => {},
        getToolByName: () => mockTool,
        getToolByDisplayName: () => mockTool,
        getTools: () => [],
        discoverTools: async () => {},
        getAllTools: () => [],
        getToolsByServer: () => [],
      } as unknown as ToolRegistry;

      const onToolCallsUpdate = vi.fn();
      const mockPolicyEngine = createMockPolicyEngine();

      const mockConfig = {
        getSessionId: () => 'test-session-id',
        getUsageStatisticsEnabled: () => true,
        getDebugMode: () => false,
        getApprovalMode: () => ApprovalMode.YOLO,
        getEphemeralSettings: () => ({}),
        getAllowedTools: () => [],
        getContentGeneratorConfig: () => ({
          model: 'test-model',
        }),
        getToolRegistry: () => mockToolRegistry,
        getMessageBus: vi.fn().mockReturnValue(createMockMessageBus()),
        getEnableHooks: () => false,
        getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
        getModel: () => DEFAULT_GEMINI_MODEL,
      } as unknown as Config;

      const scheduler = new CoreToolScheduler({
        config: mockConfig,
        messageBus: mockConfig.getMessageBus(),
        toolRegistry: mockConfig.getToolRegistry(),
        onAllToolCallsComplete: vi.fn(),
        onToolCallsUpdate: (calls) => {
          onToolCallsUpdate(calls);
          calls.forEach((call) => {
            if (call.status === 'success') {
              const callNum = (call.request.args as { call: number }).call;
              if (!publishOrder.includes(callNum)) {
                publishOrder.push(callNum);
              }
            }
          });
        },
        getPreferredEditor: () => 'vscode',
        onEditorClose: vi.fn(),
      });

      const signal = new AbortController().signal;

      // Schedule 5 tool calls (simulating the scenario from the bug report)
      // NOTE: Don't await schedule() - we need to control tool completion externally via resolvers.
      // With hooks enabled, schedule() would block until all tools complete, causing a deadlock.
      // Since this test has hooks disabled (getEnableHooks: () => false), fire-and-forget is fine.
      void scheduler.schedule(
        [1, 2, 3, 4, 5].map((n) => ({
          callId: `call${n}`,
          name: 'mockTool',
          args: { call: n },
          isClientInitiated: false,
          prompt_id: 'test',
        })),
        signal,
      );

      // Wait for all tools to start executing and set up their resolvers
      await vi.waitFor(
        () => {
          expect(resolvers.size).toBe(5);
        },
        { timeout: 1000 },
      );

      // Now complete tools in a specific order that triggers the race condition:
      // Complete tool 3 first (middle of the batch)
      resolvers.get(3)?.();

      // Small delay to let publishBufferedResults start and break out waiting for tool 1
      await new Promise((resolve) => setTimeout(resolve, 5));

      // Complete tools 4 and 5
      resolvers.get(4)?.();
      resolvers.get(5)?.();

      // Small delay
      await new Promise((resolve) => setTimeout(resolve, 5));

      // Complete tool 2
      resolvers.get(2)?.();

      // Small delay
      await new Promise((resolve) => setTimeout(resolve, 5));

      // Finally complete tool 1 (the blocker)
      resolvers.get(1)?.();

      // Wait for all calls to complete
      await vi.waitFor(
        () => {
          expect(completionOrder.length).toBe(5);
          expect(publishOrder.length).toBe(5);
        },
        { timeout: 2000 },
      );

      // Verify that despite the out-of-order completion, all results were published
      // and in the correct request order
      expect(publishOrder).toStrictEqual([1, 2, 3, 4, 5]);
    });

    it('should recover when all later tools complete before first tool', async () => {
      // Edge case: All tools except the first one complete, then the first one completes.
      // Without the fix, the buffered results might get stuck.
      const completionOrder: number[] = [];
      const publishOrder: number[] = [];

      const executeFn = vi
        .fn()
        .mockImplementation(async (args: { call: number }) => {
          // First tool takes longest, all others complete quickly
          if (args.call === 1) {
            await new Promise((resolve) => setTimeout(resolve, 80));
          } else {
            // All other tools complete almost immediately but staggered
            await new Promise((resolve) => setTimeout(resolve, args.call * 5));
          }
          completionOrder.push(args.call);
          return { llmContent: `Call ${args.call} done` };
        });

      const mockTool = new MockTool({ name: 'mockTool', execute: executeFn });
      const mockToolRegistry = {
        getTool: () => mockTool,
        getFunctionDeclarations: () => [],
        tools: new Map(),
        discovery: {},
        registerTool: () => {},
        getToolByName: () => mockTool,
        getToolByDisplayName: () => mockTool,
        getTools: () => [],
        discoverTools: async () => {},
        getAllTools: () => [],
        getToolsByServer: () => [],
      } as unknown as ToolRegistry;

      const mockPolicyEngine = createMockPolicyEngine();

      const mockConfig = {
        getSessionId: () => 'test-session-id',
        getUsageStatisticsEnabled: () => true,
        getDebugMode: () => false,
        getApprovalMode: () => ApprovalMode.YOLO,
        getEphemeralSettings: () => ({}),
        getAllowedTools: () => [],
        getContentGeneratorConfig: () => ({
          model: 'test-model',
        }),
        getToolRegistry: () => mockToolRegistry,
        getMessageBus: vi.fn().mockReturnValue(createMockMessageBus()),
        getEnableHooks: () => false,
        getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
        getModel: () => DEFAULT_GEMINI_MODEL,
      } as unknown as Config;

      const scheduler = new CoreToolScheduler({
        config: mockConfig,
        messageBus: mockConfig.getMessageBus(),
        toolRegistry: mockConfig.getToolRegistry(),
        onAllToolCallsComplete: vi.fn(),
        onToolCallsUpdate: (calls) => {
          calls.forEach((call) => {
            if (call.status === 'success') {
              const callNum = (call.request.args as { call: number }).call;
              if (!publishOrder.includes(callNum)) {
                publishOrder.push(callNum);
              }
            }
          });
        },
        getPreferredEditor: () => 'vscode',
        onEditorClose: vi.fn(),
      });

      const signal = new AbortController().signal;

      // Schedule 5 tool calls
      await scheduler.schedule(
        [1, 2, 3, 4, 5].map((n) => ({
          callId: `call${n}`,
          name: 'mockTool',
          args: { call: n },
          isClientInitiated: false,
          prompt_id: 'test',
        })),
        signal,
      );

      // Wait for all calls to complete
      await vi.waitFor(
        () => {
          expect(completionOrder.length).toBe(5);
          expect(publishOrder.length).toBe(5);
        },
        { timeout: 2000 },
      );

      // Completion order: 2, 3, 4, 5, 1 (first is slowest)
      expect(completionOrder).toStrictEqual([2, 3, 4, 5, 1]);

      // But publish order should still be in request order
      expect(publishOrder).toStrictEqual([1, 2, 3, 4, 5]);
    });
  });

  it('injects agentId into ContextAwareTool context', async () => {
    class ContextAwareMockTool extends MockTool implements ContextAwareTool {
      context?: ToolContext;

      constructor(name: string) {
        super(name);
      }
    }

    const contextAwareTool = new ContextAwareMockTool('context-tool');
    contextAwareTool.executeFn.mockResolvedValue({
      llmContent: 'ok',
      returnDisplay: 'ok',
    });

    const toolRegistry = {
      getTool: () => contextAwareTool,
      getToolByName: () => contextAwareTool,
      getFunctionDeclarations: () => [],
      tools: new Map(),
      discovery: {},
      registerTool: () => {},
      getToolByDisplayName: () => contextAwareTool,
      getTools: () => [],
      discoverTools: async () => {},
      getAllTools: () => [],
      getToolsByServer: () => [],
    };

    const mockPolicyEngine = createMockPolicyEngine();

    const mockConfig = {
      getSessionId: () => 'session-123',
      getUsageStatisticsEnabled: () => true,
      getDebugMode: () => false,
      isInteractive: () => true,
      getApprovalMode: () => ApprovalMode.DEFAULT,
      getAllowedTools: () => [],
      getToolRegistry: () => toolRegistry,
      getContentGeneratorConfig: () => ({
        model: 'test-model',
      }),
      getMessageBus: vi.fn().mockReturnValue(createMockMessageBus()),
      getEnableHooks: () => false,
      getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
      getModel: () => DEFAULT_GEMINI_MODEL,
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
      messageBus: mockConfig.getMessageBus(),
      toolRegistry: mockConfig.getToolRegistry(),
      onAllToolCallsComplete: vi.fn(),
      onToolCallsUpdate: vi.fn(),
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    const abortController = new AbortController();
    const request = {
      callId: 'ctx-1',
      name: 'context-tool',
      args: {},
      isClientInitiated: false,
      prompt_id: 'prompt-ctx',
      agentId: 'agent-sub-42',
    };

    await scheduler.schedule([request], abortController.signal);

    expect(contextAwareTool.context).toStrictEqual({
      sessionId: 'session-123',
      agentId: 'agent-sub-42',
      interactiveMode: true,
    });
  });

  describe('CoreToolScheduler cancellation prevents continuation', () => {
    it('should not process tool completions after cancelAll is called', async () => {
      const executeFn = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { llmContent: 'Tool result', returnDisplay: 'Tool result' };
      });

      const mockTool = new MockTool({ name: 'mockTool', execute: executeFn });
      const mockToolRegistry = {
        getTool: () => mockTool,
        getFunctionDeclarations: () => [],
        tools: new Map(),
        discovery: {},
        registerTool: () => {},
        getToolByName: () => mockTool,
        getToolByDisplayName: () => mockTool,
        getTools: () => [],
        discoverTools: async () => {},
        getAllTools: () => [],
        getToolsByServer: () => [],
        getAllToolNames: () => ['mockTool'],
      } as unknown as ToolRegistry;

      const onAllToolCallsComplete = vi.fn();
      const onToolCallsUpdate = vi.fn();
      const mockPolicyEngine = createMockPolicyEngine();

      const mockConfig = {
        getSessionId: () => 'test-session-id',
        getUsageStatisticsEnabled: () => true,
        getDebugMode: () => false,
        getApprovalMode: () => ApprovalMode.YOLO,
        getEphemeralSettings: () => ({}),
        getAllowedTools: () => [],
        getContentGeneratorConfig: () => ({
          model: 'test-model',
        }),
        getToolRegistry: () => mockToolRegistry,
        getMessageBus: vi.fn().mockReturnValue(createMockMessageBus()),
        getEnableHooks: () => false,
        getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
        getModel: () => DEFAULT_GEMINI_MODEL,
      } as unknown as Config;

      const scheduler = new CoreToolScheduler({
        config: mockConfig,
        messageBus: mockConfig.getMessageBus(),
        toolRegistry: mockConfig.getToolRegistry(),
        onAllToolCallsComplete,
        onToolCallsUpdate,
        getPreferredEditor: () => 'vscode',
        onEditorClose: vi.fn(),
      });

      const abortController = new AbortController();

      const schedulePromise = scheduler.schedule(
        [
          {
            callId: 'call1',
            name: 'mockTool',
            args: {},
            isClientInitiated: false,
            prompt_id: 'test',
          },
          {
            callId: 'call2',
            name: 'mockTool',
            args: {},
            isClientInitiated: false,
            prompt_id: 'test',
          },
        ],
        abortController.signal,
      );

      await vi.waitFor(() => {
        const calls = onToolCallsUpdate.mock.calls.at(-1)?.[0] as ToolCall[];
        return calls?.some((c) => c.status === 'executing');
      });

      scheduler.cancelAll();
      abortController.abort();

      await schedulePromise;

      await vi.waitFor(() => {
        expect(onAllToolCallsComplete).toHaveBeenCalled();
      });

      const completedCalls = onAllToolCallsComplete.mock.calls.at(
        -1,
      )?.[0] as ToolCall[];
      expect(completedCalls.every((c) => c.status === 'cancelled')).toBe(true);
    });

    it('should properly transition all tools to cancelled state on cancelAll', async () => {
      let tool1Resolve: () => void;
      let tool2Resolve: () => void;

      const executeFn = vi
        .fn()
        .mockImplementation(async (args: { id: number }) => {
          if (args.id === 1) {
            await new Promise<void>((resolve) => {
              tool1Resolve = resolve;
            });
          } else {
            await new Promise<void>((resolve) => {
              tool2Resolve = resolve;
            });
          }
          return {
            llmContent: `Tool ${args.id} done`,
            returnDisplay: `Result ${args.id}`,
          };
        });

      const mockTool = new MockTool({ name: 'mockTool', execute: executeFn });
      const mockToolRegistry = {
        getTool: () => mockTool,
        getFunctionDeclarations: () => [],
        tools: new Map(),
        discovery: {},
        registerTool: () => {},
        getToolByName: () => mockTool,
        getToolByDisplayName: () => mockTool,
        getTools: () => [],
        discoverTools: async () => {},
        getAllTools: () => [],
        getToolsByServer: () => [],
        getAllToolNames: () => ['mockTool'],
      } as unknown as ToolRegistry;

      const onAllToolCallsComplete = vi.fn();
      const onToolCallsUpdate = vi.fn();
      const mockPolicyEngine = createMockPolicyEngine();

      const mockConfig = {
        getSessionId: () => 'test-session-id',
        getUsageStatisticsEnabled: () => true,
        getDebugMode: () => false,
        getApprovalMode: () => ApprovalMode.YOLO,
        getEphemeralSettings: () => ({}),
        getAllowedTools: () => [],
        getContentGeneratorConfig: () => ({
          model: 'test-model',
        }),
        getToolRegistry: () => mockToolRegistry,
        getMessageBus: vi.fn().mockReturnValue(createMockMessageBus()),
        getEnableHooks: () => false,
        getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
        getModel: () => DEFAULT_GEMINI_MODEL,
      } as unknown as Config;

      const scheduler = new CoreToolScheduler({
        config: mockConfig,
        messageBus: mockConfig.getMessageBus(),
        toolRegistry: mockConfig.getToolRegistry(),
        onAllToolCallsComplete,
        onToolCallsUpdate,
        getPreferredEditor: () => 'vscode',
        onEditorClose: vi.fn(),
      });

      const abortController = new AbortController();

      const schedulePromise = scheduler.schedule(
        [
          {
            callId: 'call1',
            name: 'mockTool',
            args: { id: 1 },
            isClientInitiated: false,
            prompt_id: 'test',
          },
          {
            callId: 'call2',
            name: 'mockTool',
            args: { id: 2 },
            isClientInitiated: false,
            prompt_id: 'test',
          },
        ],
        abortController.signal,
      );

      await vi.waitFor(() => {
        const calls = onToolCallsUpdate.mock.calls.at(-1)?.[0] as ToolCall[];
        return calls?.filter((c) => c.status === 'executing').length === 2;
      });

      scheduler.cancelAll();

      const callsAfterCancel = onToolCallsUpdate.mock.calls.at(
        -1,
      )?.[0] as ToolCall[];
      expect(callsAfterCancel.every((c) => c.status === 'cancelled')).toBe(
        true,
      );

      abortController.abort();

      tool1Resolve!();
      tool2Resolve!();

      await schedulePromise;

      await vi.waitFor(() => {
        expect(onAllToolCallsComplete).toHaveBeenCalled();
      });

      const finalCalls = onAllToolCallsComplete.mock.calls.at(
        -1,
      )?.[0] as ToolCall[];
      expect(finalCalls.length).toBe(2);
      expect(finalCalls.every((c) => c.status === 'cancelled')).toBe(true);
    });

    it('should prevent duplicate tool execution when handleConfirmationResponse is called twice with same call ID', async () => {
      const mockTool = new MockTool();
      mockTool.shouldConfirm = true;
      const declarativeTool = mockTool;
      const mockToolRegistry = {
        getTool: () => declarativeTool,
        getFunctionDeclarations: () => [],
        tools: new Map(),
        discovery: {},
        registerTool: () => {},
        getToolByName: () => declarativeTool,
        getToolByDisplayName: () => declarativeTool,
        getTools: () => [],
        discoverTools: async () => {},
        getAllTools: () => [],
        getToolsByServer: () => [],
      } as unknown as ToolRegistry;

      const onAllToolCallsComplete = vi.fn();
      const onToolCallsUpdate = vi.fn();

      const mockMessageBus = createMockMessageBus();
      const mockPolicyEngine = createMockPolicyEngine();
      mockPolicyEngine.evaluate = vi
        .fn()
        .mockReturnValue(PolicyDecision.ASK_USER);

      const mockConfig = {
        getSessionId: () => 'test-session-id',
        getUsageStatisticsEnabled: () => true,
        getDebugMode: () => false,
        isInteractive: () => true,
        getApprovalMode: () => ApprovalMode.DEFAULT,
        getEphemeralSettings: () => ({}),
        getAllowedTools: () => [],
        getContentGeneratorConfig: () => ({
          model: 'test-model',
        }),
        getToolRegistry: () => mockToolRegistry,
        getMessageBus: () => mockMessageBus,
        getPolicyEngine: () => mockPolicyEngine,
        getModel: () => DEFAULT_GEMINI_MODEL,
      } as unknown as Config;

      const scheduler = new CoreToolScheduler({
        config: mockConfig,
        messageBus: mockConfig.getMessageBus(),
        toolRegistry: mockConfig.getToolRegistry(),
        onAllToolCallsComplete,
        onToolCallsUpdate,
        getPreferredEditor: () => 'vscode',
        onEditorClose: vi.fn(),
      });

      const request = {
        callId: 'duplicate-test-call',
        name: 'mockTool',
        args: { id: 1 },
        isClientInitiated: false,
        prompt_id: 'test',
      };

      // Schedule the tool
      const schedulePromise = scheduler.schedule(
        [request],
        new AbortController().signal,
      );

      // Wait for tool to reach awaiting_approval
      const waitingCall = await waitForStatus(
        onToolCallsUpdate,
        'awaiting_approval',
      );
      expect(waitingCall).toBeDefined();
      expect(waitingCall?.status).toBe('awaiting_approval');

      // Get the confirmation details
      const confirmationDetails = (waitingCall as WaitingToolCall)
        .confirmationDetails;
      expect(confirmationDetails).toBeDefined();

      // Simulate calling handleConfirmationResponse twice with the same call ID
      // The first call should proceed with execution
      const firstPromise = scheduler.handleConfirmationResponse(
        request.callId,
        confirmationDetails.onConfirm,
        ToolConfirmationOutcome.ProceedOnce,
        new AbortController().signal,
        undefined,
        true,
      );

      // The second call (simulating a duplicate) should be prevented
      const secondPromise = scheduler.handleConfirmationResponse(
        request.callId,
        confirmationDetails.onConfirm,
        ToolConfirmationOutcome.ProceedOnce,
        new AbortController().signal,
        undefined,
        true,
      );

      // Wait for both promises to complete
      await firstPromise;
      await secondPromise;

      // Wait for completion
      await schedulePromise;
      await vi.waitFor(() => {
        expect(onAllToolCallsComplete).toHaveBeenCalled();
      });

      // Verify the tool executed only once (status is success)
      const completedCalls = onAllToolCallsComplete.mock
        .calls[0][0] as ToolCall[];
      expect(completedCalls.length).toBe(1);
      expect(completedCalls[0].status).toBe('success');
      expect(completedCalls[0].request.callId).toBe('duplicate-test-call');
    });
  });

  describe('CoreToolScheduler cancelled tool responseParts', () => {
    it('should populate responseParts for cancelled tools when cancelAll is called', async () => {
      const mockTool = new MockTool();
      mockTool.shouldConfirm = true; // Needs confirmation to trigger the bug
      const declarativeTool = mockTool;

      const mockToolRegistry = {
        getTool: () => declarativeTool,
        getFunctionDeclarations: () => [],
        tools: new Map(),
        discovery: {},
        registerTool: () => {},
        getToolByName: () => declarativeTool,
        getToolByDisplayName: () => declarativeTool,
        getTools: () => [],
        discoverTools: async () => {},
        getAllTools: () => [],
        getToolsByServer: () => [],
      } as unknown as ToolRegistry;

      const onAllToolCallsComplete = vi.fn();
      const onToolCallsUpdate = vi.fn();

      const mockPolicyEngine = createMockPolicyEngine();
      mockPolicyEngine.evaluate = vi
        .fn()
        .mockReturnValue(PolicyDecision.ASK_USER);

      const mockConfig = {
        getSessionId: () => 'test-session-id',
        getUsageStatisticsEnabled: () => true,
        getDebugMode: () => false,
        isInteractive: () => true,
        getApprovalMode: () => ApprovalMode.DEFAULT,
        getEphemeralSettings: () => ({}),
        getAllowedTools: () => [],
        getContentGeneratorConfig: () => ({
          model: 'test-model',
        }),
        getToolRegistry: () => mockToolRegistry,
        getMessageBus: vi.fn().mockReturnValue(createMockMessageBus()),
        getEnableHooks: () => false,
        getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
        getModel: () => DEFAULT_GEMINI_MODEL,
      } as unknown as Config;

      const scheduler = new CoreToolScheduler({
        config: mockConfig,
        messageBus: mockConfig.getMessageBus(),
        toolRegistry: mockConfig.getToolRegistry(),
        onAllToolCallsComplete,
        onToolCallsUpdate,
        getPreferredEditor: () => 'vscode',
        onEditorClose: vi.fn(),
      });

      const request = {
        callId: 'cancel-response-parts-test',
        name: 'mockTool',
        args: {},
        isClientInitiated: false,
        prompt_id: 'prompt-id-cancel',
      };

      // Schedule the tool
      await scheduler.schedule([request], new AbortController().signal);

      // Wait for tool to be awaiting_approval
      const awaitingCall = (await waitForStatus(
        onToolCallsUpdate,
        'awaiting_approval',
      )) as WaitingToolCall;

      expect(awaitingCall).toBeDefined();
      expect(awaitingCall.status).toBe('awaiting_approval');

      // Call cancelAll to cancel the tool
      scheduler.cancelAll();

      // Wait for tool to be cancelled
      await vi.waitFor(() => {
        expect(onAllToolCallsComplete).toHaveBeenCalled();
      });

      const completedCalls = onAllToolCallsComplete.mock
        .calls[0][0] as CompletedToolCall[];
      expect(completedCalls).toHaveLength(1);
      expect(completedCalls[0].status).toBe('cancelled');

      // Cancelled tools should have responseParts populated with functionResponse only.
      // The functionCall is already in history from the model's assistant message;
      // re-emitting it causes Anthropic invalid_request_error (Issue #244).
      expect(completedCalls[0].response).toBeDefined();
      expect(completedCalls[0].response.responseParts).toBeDefined();
      expect(completedCalls[0].response.responseParts).toHaveLength(1);

      // responseParts should contain only functionResponse (no functionCall)
      const functionResponsePart = completedCalls[0].response.responseParts[0];
      expect(functionResponsePart).not.toHaveProperty('functionCall');
      expect(functionResponsePart).toHaveProperty('functionResponse');
      expect(functionResponsePart.functionResponse.id).toBe(
        'cancel-response-parts-test',
      );
      expect(functionResponsePart.functionResponse.name).toBe('mockTool');
      expect(functionResponsePart.functionResponse.response).toHaveProperty(
        'error',
      );
      expect(
        (functionResponsePart.functionResponse.response as { error: string })
          .error,
      ).toContain('Tool call cancelled by user');
    });

    it('should not double-report completed tools when concurrent completions occur', async () => {
      // Arrange
      const executeFn = vi.fn().mockResolvedValue({ llmContent: 'success' });
      const mockTool = new MockTool({ name: 'mockTool', execute: executeFn });
      const declarativeTool = mockTool;

      const mockToolRegistry = {
        getTool: () => declarativeTool,
        getToolByName: () => declarativeTool,
        getFunctionDeclarations: () => [],
        tools: new Map(),
        discovery: {},
        registerTool: () => {},
        getToolByDisplayName: () => declarativeTool,
        getTools: () => [],
        discoverTools: async () => {},
        getAllTools: () => [],
        getToolsByServer: () => [],
      } as unknown as ToolRegistry;

      let completionCallCount = 0;
      const onAllToolCallsComplete = vi.fn().mockImplementation(async () => {
        completionCallCount++;
        // Simulate slow reporting (e.g. Gemini API call)
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      const mockConfig = createMockConfig({
        getToolRegistry: () => mockToolRegistry,
        getApprovalMode: () => ApprovalMode.YOLO,
        isInteractive: () => false,
      });
      const mockMessageBus = createMockMessageBus();
      mockConfig.getMessageBus = vi.fn().mockReturnValue(mockMessageBus);
      mockConfig.getEnableHooks = vi.fn().mockReturnValue(false);
      mockConfig.getHookSystem = vi
        .fn()
        .mockReturnValue(new HookSystem(mockConfig));

      const scheduler = new CoreToolScheduler({
        config: mockConfig,
        messageBus: mockMessageBus,
        toolRegistry: mockToolRegistry,
        onAllToolCallsComplete,
        getPreferredEditor: () => 'vscode',
      });

      const abortController = new AbortController();
      const request = {
        callId: '1',
        name: 'mockTool',
        args: {},
        isClientInitiated: false,
        prompt_id: 'prompt-1',
      };

      // Act
      // 1. Start execution
      const schedulePromise = scheduler.schedule(
        [request],
        abortController.signal,
      );

      // 2. Wait just enough for it to finish and enter checkAndNotifyCompletion
      // (awaiting our slow mock)
      await vi.waitFor(() => {
        expect(completionCallCount).toBe(1);
      });

      // 3. Trigger a concurrent completion event (e.g. via cancelAll)
      scheduler.cancelAll(abortController.signal);

      await schedulePromise;

      // Assert
      // Even though cancelAll was called while the first completion was in progress,
      // it should not have triggered a SECOND completion call because the first one
      // was still 'finalizing' and will drain any new tools.
      expect(onAllToolCallsComplete).toHaveBeenCalledTimes(1);
    });

    it('should complete reporting all tools even mid-callback during abort', async () => {
      // Arrange
      const onAllToolCallsComplete = vi.fn().mockImplementation(async () => {
        // Simulate slow reporting
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      const mockTool = new MockTool({ name: 'mockTool' });
      const mockToolRegistry = {
        getTool: () => mockTool,
        getToolByName: () => mockTool,
        getFunctionDeclarations: () => [],
        tools: new Map(),
        discovery: {},
        registerTool: () => {},
        getToolByDisplayName: () => mockTool,
        getTools: () => [],
        discoverTools: async () => {},
        getAllTools: () => [],
        getToolsByServer: () => [],
      } as unknown as ToolRegistry;

      const mockConfig = createMockConfig({
        getToolRegistry: () => mockToolRegistry,
        getApprovalMode: () => ApprovalMode.YOLO,
        isInteractive: () => false,
      });
      const mockMessageBus = createMockMessageBus();

      const scheduler = new CoreToolScheduler({
        config: mockConfig,
        messageBus: mockMessageBus,
        toolRegistry: mockToolRegistry,
        onAllToolCallsComplete,
        getPreferredEditor: () => 'vscode',
      });

      const abortController = new AbortController();
      const signal = abortController.signal;

      // Act
      // 1. Start execution of two tools
      const schedulePromise = scheduler.schedule(
        [
          {
            callId: '1',
            name: 'mockTool',
            args: {},
            isClientInitiated: false,
            prompt_id: 'prompt-1',
          },
          {
            callId: '2',
            name: 'mockTool',
            args: {},
            isClientInitiated: false,
            prompt_id: 'prompt-1',
          },
        ],
        signal,
      );

      // 2. Wait for reporting to start
      await vi.waitFor(() => {
        expect(onAllToolCallsComplete).toHaveBeenCalled();
      });

      // 3. Abort the signal while reporting is in progress
      abortController.abort();

      await schedulePromise;

      // Assert
      // Verify that onAllToolCallsComplete was called and processed the tools,
      // and that the scheduler didn't just drop them because of the abort.
      expect(onAllToolCallsComplete).toHaveBeenCalled();

      const reportedTools = onAllToolCallsComplete.mock.calls.flatMap((call) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        call[0].map((t: any) => t.request.callId),
      );

      // Both tools should have been reported exactly once with success status
      expect(reportedTools).toContain('1');
      expect(reportedTools).toContain('2');

      const allStatuses = onAllToolCallsComplete.mock.calls.flatMap((call) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        call[0].map((t: any) => t.status),
      );
      expect(allStatuses).toStrictEqual(['success', 'success']);

      expect(onAllToolCallsComplete).toHaveBeenCalledTimes(1);
    });
  });
});
