/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import {
  ToolConfirmationOutcome,
  type ToolInvocation,
  BaseDeclarativeTool,
  BaseToolInvocation,
  ToolResult,
  ApprovalMode,
  Config,
} from '../index.js';
import {
  CoreToolScheduler,
  type CompletedToolCall,
  type ToolCall,
  type WaitingToolCall,
} from './coreToolScheduler.js';
import { MessageBusType } from '../confirmation-bus/types.js';
import { PolicyDecision } from '../policy/types.js';

/**
 * TEST SUITE: CoreToolScheduler Duplication and Double Execution Prevention
 *
 * This test suite addresses two critical bugs:
 *
 * BUG #1: Multiple scheduler instances causing "unknown correlationId" spam
 * - When multiple schedulers exist, ALL subscribe to MessageBus
 * - Only one scheduler owns each correlationId
 * - Other schedulers log "unknown correlationId" for every tool call
 *
 * BUG #2: Tools execute before user confirmation then execute again
 * - Tools in non-YOLO mode transition to scheduled/executing BEFORE user confirms
 * - They then execute AGAIN after user confirms
 * - Root cause: Multiple handlers can schedule the same tool (IDE + message bus + wrapped onConfirm)
 */

/**
 * Helper function to create a mock MessageBus
 */
function createMockMessageBus() {
  const callbacks: Map<string, Set<(response: unknown) => void>> = new Map();

  return {
    subscribe: vi
      .fn()
      .mockImplementation(
        (type: string, callback: (response: unknown) => void) => {
          if (!callbacks.has(type)) {
            callbacks.set(type, new Set());
          }
          callbacks.get(type)!.add(callback);
          return () => {
            callbacks.get(type)?.delete(callback);
          };
        },
      ),
    publish: vi.fn().mockImplementation((event: { type: string }) => {
      const typeCallbacks = callbacks.get(event.type);
      if (typeCallbacks) {
        for (const cb of typeCallbacks) {
          cb(event);
        }
      }
    }),
    respondToConfirmation: vi.fn(),
    requestConfirmation: vi.fn(),
    removeAllListeners: vi.fn(),
    listenerCount: vi.fn().mockReturnValue(0),
  };
}

/**
 * Helper function to create a mock PolicyEngine
 */
function createMockPolicyEngine() {
  return {
    evaluate: vi.fn().mockReturnValue(PolicyDecision.ASK_USER),
    checkDecision: vi.fn().mockReturnValue(PolicyDecision.ASK_USER),
  };
}

/**
 * A tool that tracks execution count
 */
class ExecutionTrackingTool extends BaseDeclarativeTool<
  { id: string },
  ToolResult
> {
  displayName = 'ExecutionTrackingTool';
  static executionCount = 0;

  createInvocation(params: {
    id: string;
  }): ToolInvocation<{ id: string }, ToolResult> {
    return new ExecutionTrackingToolInvocation(this, params);
  }

  static resetCount() {
    ExecutionTrackingTool.executionCount = 0;
  }
}

class ExecutionTrackingToolInvocation extends BaseToolInvocation<
  { id: string },
  ToolResult
> {
  constructor(_tool: ExecutionTrackingTool, params: { id: string }) {
    super(params);
  }

  override async shouldConfirmExecute(): Promise<{
    type: 'exec';
    title: string;
    description: string;
    command: string;
    rootCommand: string;
    onConfirm: (outcome: ToolConfirmationOutcome) => Promise<void>;
  }> {
    return {
      type: 'exec',
      title: 'Test Tool',
      description: 'A tool for testing',
      command: 'test command',
      rootCommand: 'test',
      onConfirm: async () => {},
    };
  }

  async execute(): Promise<ToolResult> {
    ExecutionTrackingTool.executionCount++;
    return {
      llmContent: `Tool executed (count: ${ExecutionTrackingTool.executionCount})`,
      returnDisplay: `Success (count: ${ExecutionTrackingTool.executionCount})`,
    };
  }

  getDescription(): string {
    return 'A tool that tracks execution count';
  }
}

/**
 * Helper to wait for a specific tool status
 */
async function waitForStatus(
  onToolCallsUpdate: ReturnType<typeof vi.fn>,
  targetStatus: string,
  timeoutMs = 5000,
): Promise<ToolCall | undefined> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const calls = onToolCallsUpdate.mock.calls;
    if (calls.length > 0) {
      const latestCalls = calls[calls.length - 1][0] as ToolCall[];
      const found = latestCalls.find((call) => call.status === targetStatus);
      if (found) return found;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return undefined;
}

describe('CoreToolScheduler Duplication Prevention', () => {
  it('should prevent duplicate confirmation processing for the same callId', async () => {
    const mockMessageBus = createMockMessageBus();
    const mockPolicyEngine = createMockPolicyEngine();

    const testTool = new ExecutionTrackingTool();
    ExecutionTrackingTool.resetCount();

    const mockToolRegistry = {
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
      mcpClientManager: undefined,
      getToolByName: () => testTool,
      getToolByDisplayName: () => testTool,
      getTools: () => [],
      discoverTools: async () => {},
      discovery: {},
    };

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

    const onAllToolCallsComplete = vi.fn();
    const onToolCallsUpdate = vi.fn();

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
      onAllToolCallsComplete,
      onToolCallsUpdate,
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    const request = {
      callId: 'duplicate-test-call',
      name: 'ExecutionTrackingTool',
      args: { id: 'test' },
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

    // Verify the tool executed only once
    expect(ExecutionTrackingTool.executionCount).toBe(1);

    // Verify the tool completed successfully
    const completedCalls = onAllToolCallsComplete.mock
      .calls[0][0] as CompletedToolCall[];
    expect(completedCalls.length).toBe(1);
    expect(completedCalls[0].status).toBe('success');
    expect(completedCalls[0].request.callId).toBe('duplicate-test-call');

    scheduler.dispose();
  });

  it('should execute tool only once when message bus confirmation is received', async () => {
    const mockMessageBus = createMockMessageBus();
    const mockPolicyEngine = createMockPolicyEngine();

    const testTool = new ExecutionTrackingTool();
    ExecutionTrackingTool.resetCount();

    const mockToolRegistry = {
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
      mcpClientManager: undefined,
      getToolByName: () => testTool,
      getToolByDisplayName: () => testTool,
      getTools: () => [],
      discoverTools: async () => {},
      discovery: {},
    };

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

    const onAllToolCallsComplete = vi.fn();
    const onToolCallsUpdate = vi.fn();

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
      onAllToolCallsComplete,
      onToolCallsUpdate,
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    const request = {
      callId: 'message-bus-test-call',
      name: 'ExecutionTrackingTool',
      args: { id: 'test' },
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

    // Get the correlationId
    const correlationId = (waitingCall as WaitingToolCall).confirmationDetails
      ?.correlationId;
    expect(correlationId).toBeDefined();

    // Simulate message bus confirmation
    mockMessageBus.publish({
      type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
      correlationId,
      outcome: ToolConfirmationOutcome.ProceedOnce,
      confirmed: true,
      requiresUserConfirmation: false,
    });

    // Wait for completion
    await schedulePromise;
    await vi.waitFor(() => {
      expect(onAllToolCallsComplete).toHaveBeenCalled();
    });

    // Verify the tool executed only once
    expect(ExecutionTrackingTool.executionCount).toBe(1);

    scheduler.dispose();
  });

  it('multiple schedulers should not cause unknown correlationId spam when one handles confirmation', async () => {
    const mockMessageBus = createMockMessageBus();
    const mockPolicyEngine = createMockPolicyEngine();

    const testTool = new ExecutionTrackingTool();
    ExecutionTrackingTool.resetCount();

    const mockToolRegistry = {
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
      mcpClientManager: undefined,
      getToolByName: () => testTool,
      getToolByDisplayName: () => testTool,
      getTools: () => [],
      discoverTools: async () => {},
      discovery: {},
    };

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

    // Create TWO schedulers (this simulates the bug where subagents create their own schedulers)
    const onAllToolCallsComplete1 = vi.fn();
    const onToolCallsUpdate1 = vi.fn();
    const scheduler1 = new CoreToolScheduler({
      config: mockConfig,
      onAllToolCallsComplete: onAllToolCallsComplete1,
      onToolCallsUpdate: onToolCallsUpdate1,
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    const onAllToolCallsComplete2 = vi.fn();
    const onToolCallsUpdate2 = vi.fn();
    const scheduler2 = new CoreToolScheduler({
      config: mockConfig,
      onAllToolCallsComplete: onAllToolCallsComplete2,
      onToolCallsUpdate: onToolCallsUpdate2,
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    const request = {
      callId: 'multi-scheduler-test-call',
      name: 'ExecutionTrackingTool',
      args: { id: 'test' },
      isClientInitiated: false,
      prompt_id: 'test',
    };

    // Schedule the tool on scheduler1 only
    const schedulePromise = scheduler1.schedule(
      [request],
      new AbortController().signal,
    );

    // Wait for tool to reach awaiting_approval on scheduler1
    const waitingCall = await waitForStatus(
      onToolCallsUpdate1,
      'awaiting_approval',
    );
    expect(waitingCall).toBeDefined();

    // Get the correlationId
    const correlationId = (waitingCall as WaitingToolCall).confirmationDetails
      ?.correlationId;
    expect(correlationId).toBeDefined();

    // Simulate message bus confirmation - this will be received by BOTH schedulers
    // scheduler1 should process it, scheduler2 should ignore it silently
    mockMessageBus.publish({
      type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
      correlationId,
      outcome: ToolConfirmationOutcome.ProceedOnce,
      confirmed: true,
      requiresUserConfirmation: false,
    });

    // Wait for completion on scheduler1
    await schedulePromise;
    await vi.waitFor(() => {
      expect(onAllToolCallsComplete1).toHaveBeenCalled();
    });

    // Verify the tool executed only once (scheduler1 handled it)
    expect(ExecutionTrackingTool.executionCount).toBe(1);

    // scheduler2 should NOT have completed any tool calls
    expect(onAllToolCallsComplete2).not.toHaveBeenCalled();

    scheduler1.dispose();
    scheduler2.dispose();
  });
});

describe('BUG: Tool executing before user approval in DEFAULT mode', () => {
  it('should NOT execute tool until user confirms in DEFAULT (non-YOLO) mode', async () => {
    const mockMessageBus = createMockMessageBus();
    const mockPolicyEngine = createMockPolicyEngine();

    const testTool = new ExecutionTrackingTool();
    ExecutionTrackingTool.resetCount();

    const mockToolRegistry = {
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
      mcpClientManager: undefined,
      getToolByName: () => testTool,
      getToolByDisplayName: () => testTool,
      getTools: () => [],
      discoverTools: async () => {},
      discovery: {},
    };

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

    const onAllToolCallsComplete = vi.fn();
    const onToolCallsUpdate = vi.fn();

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
      onAllToolCallsComplete,
      onToolCallsUpdate,
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    const request = {
      callId: 'approval-test-call',
      name: 'ExecutionTrackingTool',
      args: { id: 'test' },
      isClientInitiated: false,
      prompt_id: 'test-prompt',
    };

    const signal = new AbortController().signal;

    // Schedule the tool - it should NOT execute until user confirms
    const schedulePromise = scheduler.schedule([request], signal);

    // Wait for tool to reach awaiting_approval
    const waitingCall = await waitForStatus(
      onToolCallsUpdate,
      'awaiting_approval',
    );
    expect(waitingCall).toBeDefined();
    expect(waitingCall?.status).toBe('awaiting_approval');

    // CRITICAL ASSERTION: Tool should NOT have executed yet
    expect(ExecutionTrackingTool.executionCount).toBe(0);

    // Get the correlationId
    const correlationId = (waitingCall as WaitingToolCall).confirmationDetails
      ?.correlationId;
    expect(correlationId).toBeDefined();

    // Now simulate user confirmation via message bus
    mockMessageBus.publish({
      type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
      correlationId,
      outcome: ToolConfirmationOutcome.ProceedOnce,
      confirmed: true,
      requiresUserConfirmation: false,
    });

    // Wait for completion
    await schedulePromise;
    await vi.waitFor(() => {
      expect(onAllToolCallsComplete).toHaveBeenCalled();
    });

    // Tool should execute exactly ONCE after confirmation
    expect(ExecutionTrackingTool.executionCount).toBe(1);

    // Verify final state
    const completedCalls = onAllToolCallsComplete.mock
      .calls[0][0] as CompletedToolCall[];
    expect(completedCalls.length).toBe(1);
    expect(completedCalls[0].status).toBe('success');
    expect(completedCalls[0].request.callId).toBe('approval-test-call');

    scheduler.dispose();
  });
});
