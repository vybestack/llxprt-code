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
} from './coreToolScheduler.js';
import {
  CoreToolScheduler,
  ToolCall,
  WaitingToolCall,
  convertToFunctionResponse,
} from './coreToolScheduler.js';
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

class AbortDuringConfirmationInvocation extends BaseToolInvocation<
  Record<string, unknown>,
  ToolResult
> {
  constructor(
    private readonly abortController: AbortController,
    private readonly abortError: Error,
    params: Record<string, unknown>,
  ) {
    super(params);
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
  ) {
    super(
      'abortDuringConfirmationTool',
      'Abort During Confirmation Tool',
      'Test tool that aborts while confirming execution.',
      Kind.Other,
      { type: 'object', properties: {} },
    );
  }

  protected createInvocation(
    params: Record<string, unknown>,
  ): ToolInvocation<Record<string, unknown>, ToolResult> {
    return new AbortDuringConfirmationInvocation(
      this.abortController,
      this.abortError,
      params,
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
      getApprovalMode: () => ApprovalMode.DEFAULT,
      getEphemeralSettings: () => ({}),
      getAllowedTools: () => [],
      getContentGeneratorConfig: () => ({
        model: 'test-model',
      }),
      getToolRegistry: () => mockToolRegistry,
      getMessageBus: vi.fn().mockReturnValue(createMockMessageBus()),
      getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
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
      getApprovalMode: () => ApprovalMode.DEFAULT,
      getEphemeralSettings: () => ({}),
      getAllowedTools: () => [],
      getContentGeneratorConfig: () => ({
        model: 'test-model',
      }),
      getToolRegistry: () => mockToolRegistry,
      getMessageBus: () => mockMessageBus,
      getPolicyEngine: () => mockPolicyEngine,
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
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
      getApprovalMode: () => ApprovalMode.DEFAULT,
      getEphemeralSettings: () => ({}),
      getAllowedTools: () => [],
      getContentGeneratorConfig: () => ({
        model: 'test-model',
      }),
      getToolRegistry: () => mockToolRegistry,
      getMessageBus: () => mockMessageBus,
      getPolicyEngine: () => mockPolicyEngine,
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
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
    (mockMessageBus.subscribe as Mock).mockImplementation(
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
      getApprovalMode: () => ApprovalMode.DEFAULT,
      getEphemeralSettings: () => ({}),
      getAllowedTools: () => [],
      getContentGeneratorConfig: () => ({
        model: 'test-model',
      }),
      getToolRegistry: () => mockToolRegistry,
      getMessageBus: () => mockMessageBus,
      getPolicyEngine: () => mockPolicyEngine,
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
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
      getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
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
      getApprovalMode: () => ApprovalMode.DEFAULT,
      getAllowedTools: () => [],
      getToolRegistry: () => toolRegistry,
      getContentGeneratorConfig: () => ({
        model: 'test-model',
      }),
      getMessageBus: vi.fn().mockReturnValue(createMockMessageBus()),
      getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
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
      getApprovalMode: () => ApprovalMode.DEFAULT,
      getAllowedTools: () => [],
      getToolRegistry: () => toolRegistry,
      getContentGeneratorConfig: () => ({
        model: 'test-model',
      }),
      getMessageBus: vi.fn().mockReturnValue(createMockMessageBus()),
      getPolicyEngine: vi.fn().mockReturnValue(createMockPolicyEngine()),
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
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
      getApprovalMode: () => ApprovalMode.DEFAULT,
      getAllowedTools: () => [],
      getToolRegistry: () => toolRegistry,
      getContentGeneratorConfig: () => ({
        model: 'test-model',
      }),
      getMessageBus: vi.fn().mockReturnValue(createMockMessageBus()),
      getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
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
        getPolicyEngine: vi.fn().mockReturnValue(createMockPolicyEngine()),
      } as unknown as Config;

      // Create scheduler
      const scheduler = new CoreToolScheduler({
        config: mockConfig,
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
      getApprovalMode: () => ApprovalMode.DEFAULT,
      getEphemeralSettings: () => ({}),
      getAllowedTools: () => [],
      getContentGeneratorConfig: () => ({
        model: 'test-model',
      }),
      getToolRegistry: () => mockToolRegistry,
      getMessageBus: vi.fn().mockReturnValue(createMockMessageBus()),
      getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
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
    await confirmationDetails!.onConfirm(
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
    expect(executeCall?.[0]).toEqual({ newContent: 'final version' });
    expect(executeCall?.[1]).toBeInstanceOf(AbortSignal);
  });
});

describe('convertToFunctionResponse', () => {
  const toolName = 'testTool';
  const callId = 'call1';

  it('should handle simple string llmContent', () => {
    const llmContent = 'Simple text output';
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toEqual([
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
    expect(result).toEqual([
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
    expect(result).toEqual([
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
    expect(result).toEqual([
      {
        functionResponse: {
          name: toolName,
          id: callId,
          response: {
            output: 'Binary content of type image/png was processed.',
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
    expect(result).toEqual([
      {
        functionResponse: {
          name: toolName,
          id: callId,
          response: {
            output: 'Binary content of type application/pdf was processed.',
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
    // When array contains mixed parts, it creates a generic function response and includes all parts
    expect(result).toEqual([
      {
        functionResponse: {
          name: toolName,
          id: callId,
          response: { output: 'Tool execution succeeded.' },
        },
      },
      { text: 'Some textual description' },
      { inlineData: { mimeType: 'image/jpeg', data: 'base64data...' } },
      { text: 'Another text part' },
    ]);
  });

  it('should handle llmContent as an array with a single inlineData Part', () => {
    const llmContent: PartListUnion = [
      { inlineData: { mimeType: 'image/gif', data: 'gifdata...' } },
    ];
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toEqual([
      {
        functionResponse: {
          name: toolName,
          id: callId,
          response: {
            output: 'Binary content of type image/gif was processed.',
          },
        },
      },
      llmContent[0],
    ]);
  });

  it('should handle llmContent as a generic Part (not text, inlineData, or fileData)', () => {
    const llmContent: Part = { functionCall: { name: 'test', args: {} } };
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toEqual([
      {
        functionResponse: {
          name: toolName,
          id: callId,
          response: { output: 'Tool execution succeeded.' },
        },
      },
    ]);
  });

  it('should handle empty string llmContent', () => {
    const llmContent = '';
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toEqual([
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
    // Empty array is treated as array, so returns generic function response
    expect(result).toEqual([
      {
        functionResponse: {
          name: toolName,
          id: callId,
          response: { output: 'Tool execution succeeded.' },
        },
      },
    ]);
  });

  it('should handle llmContent as a Part with undefined inlineData/fileData/text', () => {
    const llmContent: Part = {}; // An empty part object
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toEqual([
      {
        functionResponse: {
          name: toolName,
          id: callId,
          response: { output: 'Tool execution succeeded.' },
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
    expect(result).toEqual([llmContent]);
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
    expect(result).toEqual([llmContent]);
  });

  it('should trim string outputs using tool-output limits when config is provided', () => {
    const llmContent = Array(5000).fill('long-line').join('\n');
    const config = {
      getEphemeralSettings: () => ({
        'tool-output-max-tokens': 50,
        'tool-output-truncate-mode': 'truncate',
      }),
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
  constructor(params: Record<string, unknown>) {
    super(params);
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
  constructor() {
    super('mockEditTool', 'mockEditTool', 'A mock edit tool', Kind.Edit, {});
  }

  protected createInvocation(
    params: Record<string, unknown>,
  ): ToolInvocation<Record<string, unknown>, ToolResult> {
    return new MockEditToolInvocation(params);
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
      getApprovalMode: () => ApprovalMode.DEFAULT,
      getEphemeralSettings: () => ({}),
      getAllowedTools: () => [],
      getContentGeneratorConfig: () => ({
        model: 'test-model',
      }),
      getToolRegistry: () => mockToolRegistry,
      getMessageBus: vi.fn().mockReturnValue(createMockMessageBus()),
      getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
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
  it.skip('should queue tool calls when another is running', async () => {
    // Arrange
    const mockTool1 = new MockTool('tool1');
    const mockTool2 = new MockTool('tool2');
    let tool1ExecuteResolve: () => void;
    const tool1ExecutePromise = new Promise<void>((resolve) => {
      tool1ExecuteResolve = resolve;
    });

    // Make tool1 take time to execute
    mockTool1.executeFn.mockImplementation(async () => {
      await tool1ExecutePromise;
      return { output: 'Tool 1 result' };
    });

    mockTool2.executeFn.mockResolvedValue({ output: 'Tool 2 result' });

    const toolRegistry = {
      getTool: (name: string) => (name === 'tool1' ? mockTool1 : mockTool2),
      getFunctionDeclarations: () => [],
      tools: new Map(),
      discovery: {},
      registerTool: () => {},
      getToolByName: (name: string) =>
        name === 'tool1' ? mockTool1 : mockTool2,
      getToolByDisplayName: () => mockTool1,
    };

    const completedCalls: ToolCall[][] = [];
    const scheduler = new CoreToolScheduler({
      toolRegistry: Promise.resolve(toolRegistry as unknown as ToolRegistry),
      onAllToolCallsComplete: (calls) => {
        completedCalls.push(calls);
      },
      getPreferredEditor: () => undefined,
      config: {
        getApprovalMode: () => ApprovalMode.YOLO,
      } as Config,
      onEditorClose: vi.fn(),
    });

    // Act
    const signal1 = new AbortController().signal;
    const signal2 = new AbortController().signal;

    // Schedule first tool
    const schedule1Promise = scheduler.schedule(
      {
        callId: 'call1',
        name: 'tool1',
        args: {},
        isClientInitiated: false,
        prompt_id: 'test-prompt',
      },
      signal1,
    );

    // Give the first tool time to start executing
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Try to schedule second tool while first is running - should be queued
    const schedule2Promise = scheduler.schedule(
      {
        callId: 'call2',
        name: 'tool2',
        args: {},
        isClientInitiated: false,
        prompt_id: 'test-prompt',
      },
      signal2,
    );

    // Wait for both schedule calls to complete
    await Promise.all([schedule1Promise, schedule2Promise]);

    // At this point, tool1 should be executing and tool2 should be queued
    expect(mockTool1.executeFn).toHaveBeenCalled();
    expect(mockTool2.executeFn).not.toHaveBeenCalled();

    // Complete tool1
    tool1ExecuteResolve!();

    // Wait for queue processing
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Assert
    expect(mockTool2.executeFn).toHaveBeenCalled();
    expect(completedCalls).toHaveLength(2);
    expect(completedCalls[0]).toHaveLength(1);
    expect(completedCalls[0][0].request.callId).toBe('call1');
    expect(completedCalls[1]).toHaveLength(1);
    expect(completedCalls[1][0].request.callId).toBe('call2');
  });

  it.skip('should process multiple queued requests in order', async () => {
    // Arrange
    const mockTool = new MockTool();
    const executionOrder: string[] = [];
    let activeExecutions = 0;
    let maxConcurrentExecutions = 0;

    mockTool.executeFn.mockImplementation(async (args: { id: string }) => {
      activeExecutions++;
      maxConcurrentExecutions = Math.max(
        maxConcurrentExecutions,
        activeExecutions,
      );
      executionOrder.push(args.id);
      await new Promise((resolve) => setTimeout(resolve, 50));
      activeExecutions--;
      return { output: `Result for ${args.id}` };
    });

    const toolRegistry = {
      getTool: () => mockTool,
      getFunctionDeclarations: () => [],
      tools: new Map(),
      discovery: {},
      registerTool: () => {},
      getToolByName: () => mockTool,
      getToolByDisplayName: () => mockTool,
    };

    const scheduler = new CoreToolScheduler({
      toolRegistry: Promise.resolve(toolRegistry as unknown as ToolRegistry),
      getPreferredEditor: () => undefined,
      config: {
        getApprovalMode: () => ApprovalMode.YOLO,
      } as Config,
      onEditorClose: vi.fn(),
    });

    // Act
    const signal = new AbortController().signal;

    // Schedule the first tool
    const firstSchedulePromise = scheduler.schedule(
      {
        callId: 'call1',
        name: 'mockTool',
        args: { id: 'tool1' },
        isClientInitiated: false,
        prompt_id: 'test-prompt',
      },
      signal,
    );

    // Wait a bit to ensure first tool is executing
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Schedule remaining tools while first is running - they should be queued
    const remainingPromises = [];
    for (let i = 2; i <= 4; i++) {
      remainingPromises.push(
        scheduler.schedule(
          {
            callId: `call${i}`,
            name: 'mockTool',
            args: { id: `tool${i}` },
            isClientInitiated: false,
            prompt_id: 'test-prompt',
          },
          signal,
        ),
      );
    }

    await firstSchedulePromise;
    await Promise.all(remainingPromises);

    // Wait for all to complete
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Assert - only one tool should execute at a time
    expect(maxConcurrentExecutions).toBe(1);
    // Tools should execute in order
    expect(executionOrder).toEqual(['tool1', 'tool2', 'tool3', 'tool4']);
  });
});

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
      getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
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
    expect(executeCall?.[0]).toEqual({ param: 'value' });
    expect(executeCall?.[1]).toBeInstanceOf(AbortSignal);

    // 2. The tool call status never entered 'awaiting_approval'.
    const statusUpdates = onToolCallsUpdate.mock.calls
      .map((call) => (call[0][0] as ToolCall)?.status)
      .filter(Boolean);
    expect(statusUpdates).not.toContain('awaiting_approval');
    expect(statusUpdates).toEqual([
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

describe.skip('CoreToolScheduler request queueing', () => {
  // Skipped: These tests expect parallel execution but llxprt uses batch processing
  it('should queue a request if another is running', async () => {
    let resolveFirstCall: (result: ToolResult) => void;
    const firstCallPromise = new Promise<ToolResult>((resolve) => {
      resolveFirstCall = resolve;
    });

    const mockTool = new MockTool();
    mockTool.executeFn.mockImplementation(() => firstCallPromise);
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

    const onAllToolCallsComplete = vi.fn();
    const onToolCallsUpdate = vi.fn();

    const mockConfig = {
      getSessionId: () => 'test-session-id',
      getUsageStatisticsEnabled: () => true,
      getDebugMode: () => false,
      getApprovalMode: () => ApprovalMode.YOLO, // Use YOLO to avoid confirmation prompts
      getAllowedTools: () => [],
      getContentGeneratorConfig: () => ({
        model: 'test-model',
      }),
      getToolRegistry: () => mockToolRegistry,
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
      toolRegistry: mockToolRegistry,
      onAllToolCallsComplete,
      onToolCallsUpdate,
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    const abortController = new AbortController();
    const request1 = {
      callId: '1',
      name: 'mockTool',
      args: { a: 1 },
      isClientInitiated: false,
      prompt_id: 'prompt-1',
    };
    const request2 = {
      callId: '2',
      name: 'mockTool',
      args: { b: 2 },
      isClientInitiated: false,
      prompt_id: 'prompt-2',
    };

    // Schedule the first call, which will pause execution.
    scheduler.schedule([request1], abortController.signal);

    // Wait for the first call to be in the 'executing' state.
    await waitForStatus(onToolCallsUpdate, 'executing');

    // Schedule the second call while the first is "running".
    const schedulePromise2 = scheduler.schedule(
      [request2],
      abortController.signal,
    );

    // Ensure the second tool call hasn't been executed yet.
    expect(mockTool.executeFn).toHaveBeenCalledTimes(1);
    let executeCall =
      mockTool.executeFn.mock.calls[mockTool.executeFn.mock.calls.length - 1];
    expect(executeCall?.[0]).toEqual({ a: 1 });
    expect(executeCall?.[1]).toBeInstanceOf(AbortSignal);

    // Complete the first tool call.
    resolveFirstCall!({
      llmContent: 'First call complete',
      returnDisplay: 'First call complete',
    });

    // Wait for the second schedule promise to resolve.
    await schedulePromise2;

    // Let the second call finish.
    const secondCallResult = {
      llmContent: 'Second call complete',
      returnDisplay: 'Second call complete',
    };
    // Since the mock is shared, we need to resolve the current promise.
    // In a real scenario, a new promise would be created for the second call.
    resolveFirstCall!(secondCallResult);

    await vi.waitFor(() => {
      // Now the second tool call should have been executed.
      expect(mockTool.executeFn).toHaveBeenCalledTimes(2);
    });
    executeCall =
      mockTool.executeFn.mock.calls[mockTool.executeFn.mock.calls.length - 1];
    expect(executeCall?.[0]).toEqual({ b: 2 });
    expect(executeCall?.[1]).toBeInstanceOf(AbortSignal);

    // Wait for the second completion.
    await vi.waitFor(() => {
      expect(onAllToolCallsComplete).toHaveBeenCalledTimes(2);
    });

    // Verify the completion callbacks were called correctly.
    expect(onAllToolCallsComplete.mock.calls[0][0][0].status).toBe('success');
    expect(onAllToolCallsComplete.mock.calls[1][0][0].status).toBe('success');
  });

  it('should auto-approve a tool call if it is on the allowedTools list', async () => {
    // Arrange
    const mockTool = new MockTool('mockTool');
    mockTool.executeFn.mockResolvedValue({
      llmContent: 'Tool executed',
      returnDisplay: 'Tool executed',
    });
    // This tool would normally require confirmation.
    mockTool.shouldConfirm = true;
    const declarativeTool = mockTool;

    const toolRegistry = {
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
    };

    const onAllToolCallsComplete = vi.fn();
    const onToolCallsUpdate = vi.fn();

    // Configure the scheduler to auto-approve the specific tool call.
    const mockConfig = {
      getSessionId: () => 'test-session-id',
      getUsageStatisticsEnabled: () => true,
      getDebugMode: () => false,
      getApprovalMode: () => ApprovalMode.DEFAULT, // Not YOLO mode
      getAllowedTools: () => ['mockTool'], // Auto-approve this tool
      getToolRegistry: () => toolRegistry,
      getContentGeneratorConfig: () => ({
        model: 'test-model',
      }),
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
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
      prompt_id: 'prompt-auto-approved',
    };

    // Act
    await scheduler.schedule([request], abortController.signal);

    // Assert
    // 1. The tool's execute method was called directly.
    const executeCall =
      mockTool.executeFn.mock.calls[mockTool.executeFn.mock.calls.length - 1];
    expect(executeCall?.[0]).toEqual({ param: 'value' });
    expect(executeCall?.[1]).toBeInstanceOf(AbortSignal);

    // 2. The tool call status never entered 'awaiting_approval'.
    const statusUpdates = onToolCallsUpdate.mock.calls
      .map((call) => (call[0][0] as ToolCall)?.status)
      .filter(Boolean);
    expect(statusUpdates).not.toContain('awaiting_approval');
    expect(statusUpdates).toEqual([
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
    expect(
      completedCall.status === 'success'
        ? completedCall.response.resultDisplay
        : '',
    ).toBe('Tool executed');
  });

  it('should require approval for a chained shell command even when prefix is allowlisted', async () => {
    expect(
      isShellInvocationAllowlisted(
        {
          params: { command: 'git status && rm -rf /tmp/should-not-run' },
        } as unknown as AnyToolInvocation,
        ['run_shell_command(git)'],
      ),
    ).toBe(false);

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
          rootCommand: 'git',
          onConfirm: async () => {},
        }),
      execute: () => executeFn({}),
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
    };

    const onAllToolCallsComplete = vi.fn();
    const onToolCallsUpdate = vi.fn();

    const mockConfig = {
      getSessionId: () => 'test-session-id',
      getUsageStatisticsEnabled: () => true,
      getDebugMode: () => false,
      getApprovalMode: () => ApprovalMode.DEFAULT,
      getAllowedTools: () => ['run_shell_command(git)'],
      getContentGeneratorConfig: () => ({
        model: 'test-model',
      }),
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
      getToolRegistry: () => toolRegistry,
      getUseSmartEdit: () => false,
      getUseModelRouter: () => false,
      getGeminiClient: () => null,
      getEnableMessageBusIntegration: () => false,
      getMessageBus: () => null,
      getPolicyEngine: () => null,
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
      onAllToolCallsComplete,
      onToolCallsUpdate,
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    const abortController = new AbortController();
    const request = {
      callId: 'shell-1',
      name: 'run_shell_command',
      args: { command: 'git status && rm -rf /tmp/should-not-run' },
      isClientInitiated: false,
      prompt_id: 'prompt-shell-auto-approved',
    };

    await scheduler.schedule([request], abortController.signal);

    const statusUpdates = onToolCallsUpdate.mock.calls
      .map((call) => (call[0][0] as ToolCall)?.status)
      .filter(Boolean);

    expect(statusUpdates).toContain('awaiting_approval');
    expect(executeFn).not.toHaveBeenCalled();
    expect(onAllToolCallsComplete).not.toHaveBeenCalled();
  }, 20000);

  it('should handle two synchronous calls to schedule', async () => {
    const mockTool = new MockTool();
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
    const onAllToolCallsComplete = vi.fn();
    const onToolCallsUpdate = vi.fn();

    const mockConfig = {
      getSessionId: () => 'test-session-id',
      getUsageStatisticsEnabled: () => true,
      getDebugMode: () => false,
      getApprovalMode: () => ApprovalMode.YOLO,
      getAllowedTools: () => [],
      getContentGeneratorConfig: () => ({
        model: 'test-model',
      }),
      getToolRegistry: () => mockToolRegistry,
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
      toolRegistry: mockToolRegistry,
      onAllToolCallsComplete,
      onToolCallsUpdate,
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    const abortController = new AbortController();
    const request1 = {
      callId: '1',
      name: 'mockTool',
      args: { a: 1 },
      isClientInitiated: false,
      prompt_id: 'prompt-1',
    };
    const request2 = {
      callId: '2',
      name: 'mockTool',
      args: { b: 2 },
      isClientInitiated: false,
      prompt_id: 'prompt-2',
    };

    // Schedule two calls synchronously.
    const schedulePromise1 = scheduler.schedule(
      [request1],
      abortController.signal,
    );
    const schedulePromise2 = scheduler.schedule(
      [request2],
      abortController.signal,
    );

    // Wait for both promises to resolve.
    await Promise.all([schedulePromise1, schedulePromise2]);

    // Ensure the tool was called twice with the correct arguments.
    expect(mockTool.executeFn).toHaveBeenCalledTimes(2);
    const firstExecuteCall = mockTool.executeFn.mock.calls[0];
    const secondExecuteCall = mockTool.executeFn.mock.calls[1];
    expect(firstExecuteCall?.[0]).toEqual({ a: 1 });
    expect(secondExecuteCall?.[0]).toEqual({ b: 2 });
    expect(firstExecuteCall?.[1]).toBeInstanceOf(AbortSignal);
    expect(secondExecuteCall?.[1]).toBeInstanceOf(AbortSignal);

    // Ensure completion callbacks were called twice.
    expect(onAllToolCallsComplete).toHaveBeenCalledTimes(2);
  });

  it('should auto-approve remaining tool calls when first tool call is approved with ProceedAlways', async () => {
    let approvalMode = ApprovalMode.DEFAULT;
    const mockConfig = {
      getSessionId: () => 'test-session-id',
      getUsageStatisticsEnabled: () => true,
      getDebugMode: () => false,
      getApprovalMode: () => approvalMode,
      getAllowedTools: () => [],
      setApprovalMode: (mode: ApprovalMode) => {
        approvalMode = mode;
      },
    } as unknown as Config;

    const testTool = new TestApprovalTool(mockConfig);
    const toolRegistry = {
      getTool: () => testTool,
      getFunctionDeclarations: () => [],
      getFunctionDeclarationsFiltered: () => [],
      registerTool: () => {},
      discoverAllTools: async () => {},
      discoverMcpTools: async () => {},
      discoverToolsForServer: async () => {},
      removeMcpToolsByServer: () => {},
      getAllTools: () => [],
      getToolsByServer: () => [],
      tools: new Map(),
      config: mockConfig,
      mcpClientManager: undefined,
      getToolByName: () => testTool,
      getToolByDisplayName: () => testTool,
      getTools: () => [],
      discoverTools: async () => {},
      discovery: {},
    };

    const onAllToolCallsComplete = vi.fn();
    const onToolCallsUpdate = vi.fn();
    const pendingConfirmations: Array<
      (outcome: ToolConfirmationOutcome) => void
    > = [];

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
      toolRegistry: toolRegistry as unknown as ToolRegistry,
      onAllToolCallsComplete,
      onToolCallsUpdate: (toolCalls) => {
        onToolCallsUpdate(toolCalls);
        // Capture confirmation handlers for awaiting_approval tools
        toolCalls.forEach((call) => {
          if (call.status === 'awaiting_approval') {
            const waitingCall = call as WaitingToolCall;
            if (waitingCall.confirmationDetails?.onConfirm) {
              const originalHandler = pendingConfirmations.find(
                (h) => h === waitingCall.confirmationDetails.onConfirm,
              );
              if (!originalHandler) {
                pendingConfirmations.push(
                  waitingCall.confirmationDetails.onConfirm,
                );
              }
            }
          }
        });
      },
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    const abortController = new AbortController();

    // Schedule multiple tools that need confirmation
    const requests = [
      {
        callId: '1',
        name: 'testApprovalTool',
        args: { id: 'first' },
        isClientInitiated: false,
        prompt_id: 'prompt-1',
      },
      {
        callId: '2',
        name: 'testApprovalTool',
        args: { id: 'second' },
        isClientInitiated: false,
        prompt_id: 'prompt-2',
      },
      {
        callId: '3',
        name: 'testApprovalTool',
        args: { id: 'third' },
        isClientInitiated: false,
        prompt_id: 'prompt-3',
      },
    ];

    await scheduler.schedule(requests, abortController.signal);

    // Wait for all tools to be awaiting approval
    await vi.waitFor(() => {
      const calls = onToolCallsUpdate.mock.calls.at(-1)?.[0] as ToolCall[];
      expect(calls?.length).toBe(3);
      expect(calls?.every((call) => call.status === 'awaiting_approval')).toBe(
        true,
      );
    });

    expect(pendingConfirmations.length).toBe(3);

    // Approve the first tool with ProceedAlways
    const firstConfirmation = pendingConfirmations[0];
    firstConfirmation(ToolConfirmationOutcome.ProceedAlways);

    // Wait for all tools to be completed
    await vi.waitFor(() => {
      expect(onAllToolCallsComplete).toHaveBeenCalled();
      const completedCalls = onAllToolCallsComplete.mock.calls.at(
        -1,
      )?.[0] as ToolCall[];
      expect(completedCalls?.length).toBe(3);
      expect(completedCalls?.every((call) => call.status === 'success')).toBe(
        true,
      );
    });

    // Verify approval mode was changed
    expect(approvalMode).toBe(ApprovalMode.AUTO_EDIT);
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
      getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
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
    expect(completionOrder).toEqual([2, 3, 1]); // Fastest to slowest

    // Verify ordered publishing (publish order == request order)
    expect(publishOrder).toEqual([1, 2, 3]); // Request order maintained
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
      getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
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
    expect(completionOrder).toEqual([2, 3, 1]); // Fastest to slowest

    // Verify ordered publishing despite error in tool 2
    expect(publishOrder).toEqual([1, 2, 3]); // Request order maintained
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
      getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
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
    expect(publishOrder).toEqual([1, 2, 3, 4, 5]);
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
      getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
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
    expect(completionOrder).toEqual([2, 3, 4, 5, 1]);

    // But publish order should still be in request order
    expect(publishOrder).toEqual([1, 2, 3, 4, 5]);
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
    getApprovalMode: () => ApprovalMode.DEFAULT,
    getAllowedTools: () => [],
    getToolRegistry: () => toolRegistry,
    getContentGeneratorConfig: () => ({
      model: 'test-model',
    }),
    getMessageBus: vi.fn().mockReturnValue(createMockMessageBus()),
    getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
  } as unknown as Config;

  const scheduler = new CoreToolScheduler({
    config: mockConfig,
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

  expect(contextAwareTool.context).toEqual({
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
      getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
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
      getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
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
    expect(callsAfterCancel.every((c) => c.status === 'cancelled')).toBe(true);

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
      getApprovalMode: () => ApprovalMode.DEFAULT,
      getEphemeralSettings: () => ({}),
      getAllowedTools: () => [],
      getContentGeneratorConfig: () => ({
        model: 'test-model',
      }),
      getToolRegistry: () => mockToolRegistry,
      getMessageBus: () => mockMessageBus,
      getPolicyEngine: () => mockPolicyEngine,
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
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

    const mockMessageBus = createMockMessageBus();
    const mockPolicyEngine = createMockPolicyEngine();
    mockPolicyEngine.evaluate = vi
      .fn()
      .mockReturnValue(PolicyDecision.ASK_USER);

    const mockConfig = {
      getSessionId: () => 'test-session-id',
      getUsageStatisticsEnabled: () => true,
      getDebugMode: () => false,
      getApprovalMode: () => ApprovalMode.DEFAULT,
      getEphemeralSettings: () => ({}),
      getAllowedTools: () => [],
      getContentGeneratorConfig: () => ({
        model: 'test-model',
        authType: 'oauth-personal',
      }),
      getToolRegistry: () => mockToolRegistry,
      getMessageBus: () => mockMessageBus,
      getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
    } as unknown as Config;

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
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
});
