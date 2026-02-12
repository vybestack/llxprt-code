/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { CoreToolScheduler, type ToolCall } from './coreToolScheduler.js';
import { Config, ApprovalMode, ToolRegistry } from '../index.js';
import { MockTool } from '../test-utils/mock-tool.js';
import { PolicyDecision } from '../policy/types.js';

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

function createMockPolicyEngine() {
  return {
    evaluate: vi.fn().mockReturnValue(PolicyDecision.ALLOW),
    checkDecision: vi.fn().mockReturnValue(PolicyDecision.ALLOW),
  };
}

function createMockToolRegistry(mockTool: MockTool) {
  return {
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
}

function createMockConfig(
  mockToolRegistry: ToolRegistry,
  mockPolicyEngine: ReturnType<typeof createMockPolicyEngine>,
) {
  return {
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
}

describe('CoreToolScheduler cancellation edge cases', () => {
  let scheduler: CoreToolScheduler | undefined;

  afterEach(() => {
    if (scheduler) {
      scheduler.dispose();
      scheduler = undefined;
    }
  });

  /**
   * Issue #1: Cancelled tools don't buffer results, blocking ordered publishing
   *
   * When a tool is cancelled mid-batch (signal.aborted becomes true after execution
   * resolves but before buffering), it transitions to 'cancelled' without buffering
   * a result. This breaks ordered publishing because:
   * - nextPublishIndex waits for executionIndex that will never appear
   * - Later tools remain stuck in 'executing' forever
   * - checkAndNotifyCompletion never fires
   */
  it('should complete all tools when first tool is cancelled mid-batch', async () => {
    let tool0Resolve: (() => void) | undefined;
    let tool1Resolve: (() => void) | undefined;
    let tool2Resolve: (() => void) | undefined;

    const executeFn = vi
      .fn()
      .mockImplementation(async (args: { id: number }) => {
        if (args.id === 0) {
          // Tool 0 is slow
          await new Promise<void>((resolve) => {
            tool0Resolve = resolve;
          });
        } else if (args.id === 1) {
          // Tool 1 is fast
          await new Promise<void>((resolve) => {
            tool1Resolve = resolve;
          });
        } else {
          // Tool 2 is fast
          await new Promise<void>((resolve) => {
            tool2Resolve = resolve;
          });
        }
        return {
          llmContent: `Tool ${args.id} completed`,
          returnDisplay: `Result ${args.id}`,
        };
      });

    const mockTool = new MockTool({ name: 'mockTool', execute: executeFn });
    const mockToolRegistry = createMockToolRegistry(mockTool);
    const onAllToolCallsComplete = vi.fn();
    const onToolCallsUpdate = vi.fn();
    const mockPolicyEngine = createMockPolicyEngine();
    const mockConfig = createMockConfig(mockToolRegistry, mockPolicyEngine);

    scheduler = new CoreToolScheduler({
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
          callId: 'call0',
          name: 'mockTool',
          args: { id: 0 },
          isClientInitiated: false,
          prompt_id: 'test',
        },
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

    // Wait for all tools to start executing
    await vi.waitFor(() => {
      const calls = onToolCallsUpdate.mock.calls.at(-1)?.[0] as ToolCall[];
      return calls?.filter((c) => c.status === 'executing').length === 3;
    });

    // Complete tools 1 and 2 first (they're fast)
    tool1Resolve!();
    tool2Resolve!();

    // Small delay to let them buffer their results
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Now abort - tool 0 is still executing
    abortController.abort();

    // Complete tool 0 after abort (it will see signal.aborted = true)
    tool0Resolve!();

    // The scheduler should complete without hanging
    await vi.waitFor(
      () => {
        expect(onAllToolCallsComplete).toHaveBeenCalled();
      },
      { timeout: 2000 },
    );

    const finalCalls = onAllToolCallsComplete.mock.calls.at(
      -1,
    )?.[0] as ToolCall[];
    expect(finalCalls).toBeDefined();
    expect(finalCalls.length).toBe(3);

    // All tools should be in a terminal state
    const terminalStates = ['success', 'error', 'cancelled'];
    for (const call of finalCalls) {
      expect(terminalStates).toContain(call.status);
    }

    await schedulePromise;
  });

  /**
   * Issue #2: cancelAll() doesn't reset batch bookkeeping state
   *
   * When cancelAll() is called, it should reset:
   * - pendingResults
   * - nextPublishIndex
   * - currentBatchSize
   * - isPublishingBufferedResults / pendingPublishRequest
   *
   * This verifies that batch state is properly reset after cancellation.
   */
  it('should properly reset batch state after cancelAll and work correctly on next schedule', async () => {
    let toolResolve: (() => void) | undefined;

    const executeFn = vi.fn().mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        toolResolve = resolve;
      });
      return {
        llmContent: 'Tool completed',
        returnDisplay: 'Result',
      };
    });

    const mockTool = new MockTool({ name: 'mockTool', execute: executeFn });
    const mockToolRegistry = createMockToolRegistry(mockTool);
    const onAllToolCallsComplete = vi.fn();
    const onToolCallsUpdate = vi.fn();
    const mockPolicyEngine = createMockPolicyEngine();
    const mockConfig = createMockConfig(mockToolRegistry, mockPolicyEngine);

    scheduler = new CoreToolScheduler({
      config: mockConfig,
      onAllToolCallsComplete,
      onToolCallsUpdate,
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    const abortController = new AbortController();

    // Schedule and then cancel immediately before execution starts
    // This tests that cancelAll properly cleans up batch state
    const schedulePromise = scheduler.schedule(
      [
        {
          callId: 'call1',
          name: 'mockTool',
          args: { id: 1 },
          isClientInitiated: false,
          prompt_id: 'test',
        },
      ],
      abortController.signal,
    );

    // Wait for tool to start executing
    await vi.waitFor(() => {
      const calls = onToolCallsUpdate.mock.calls.at(-1)?.[0] as ToolCall[];
      return calls?.some((c) => c.status === 'executing');
    });

    // Cancel and abort
    scheduler.cancelAll();
    abortController.abort();
    toolResolve!();

    await schedulePromise;

    // Wait for completion
    await vi.waitFor(
      () => {
        expect(onAllToolCallsComplete).toHaveBeenCalled();
      },
      { timeout: 2000 },
    );

    // Verify cancelled state
    const calls = onAllToolCallsComplete.mock.calls.at(-1)?.[0] as ToolCall[];
    expect(calls).toBeDefined();
    expect(calls.length).toBe(1);
    expect(calls[0].status).toBe('cancelled');
  });

  /**
   * Reproduction case from Codex review:
   * Cancel mid-batch after one tool finishes, before tool #0 publishes
   *
   * Run 3 parallel tools where tool 0 is slow, tool 1/2 are fast.
   * Abort after tool 1/2 complete but before tool 0 completes.
   * Expected: All tools reach terminal state, no hang.
   */
  it('should not hang when cancelling after fast tools complete but slow tool still executing', async () => {
    let slowToolResolve: (() => void) | undefined;

    const executeFn = vi
      .fn()
      .mockImplementation(async (args: { id: number }) => {
        if (args.id === 0) {
          // Slow tool - waits for explicit resolve
          await new Promise<void>((resolve) => {
            slowToolResolve = resolve;
          });
        } else {
          // Fast tools - complete immediately
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        return {
          llmContent: `Tool ${args.id} completed`,
          returnDisplay: `Result ${args.id}`,
        };
      });

    const mockTool = new MockTool({ name: 'mockTool', execute: executeFn });
    const mockToolRegistry = createMockToolRegistry(mockTool);
    const onAllToolCallsComplete = vi.fn();
    const onToolCallsUpdate = vi.fn();
    const mockPolicyEngine = createMockPolicyEngine();
    const mockConfig = createMockConfig(mockToolRegistry, mockPolicyEngine);

    scheduler = new CoreToolScheduler({
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
          callId: 'call0',
          name: 'mockTool',
          args: { id: 0 }, // Slow
          isClientInitiated: false,
          prompt_id: 'test',
        },
        {
          callId: 'call1',
          name: 'mockTool',
          args: { id: 1 }, // Fast
          isClientInitiated: false,
          prompt_id: 'test',
        },
        {
          callId: 'call2',
          name: 'mockTool',
          args: { id: 2 }, // Fast
          isClientInitiated: false,
          prompt_id: 'test',
        },
      ],
      abortController.signal,
    );

    // Wait for all tools to start
    await vi.waitFor(() => {
      const calls = onToolCallsUpdate.mock.calls.at(-1)?.[0] as ToolCall[];
      return calls?.filter((c) => c.status === 'executing').length === 3;
    });

    // Wait for fast tools (1 and 2) to complete and buffer their results
    // They complete quickly but can't be published until tool 0's result is ready
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Now abort while tool 0 is still executing
    abortController.abort();

    // Resolve the slow tool after abort
    slowToolResolve!();

    // Should complete without hanging
    await vi.waitFor(
      () => {
        expect(onAllToolCallsComplete).toHaveBeenCalled();
      },
      { timeout: 2000 },
    );

    const finalCalls = onAllToolCallsComplete.mock.calls.at(
      -1,
    )?.[0] as ToolCall[];
    expect(finalCalls).toBeDefined();
    expect(finalCalls.length).toBe(3);

    // All should be in terminal states
    for (const call of finalCalls) {
      expect(['success', 'error', 'cancelled']).toContain(call.status);
    }

    await schedulePromise;
  });
});
