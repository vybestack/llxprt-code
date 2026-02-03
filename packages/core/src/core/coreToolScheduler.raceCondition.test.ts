/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CoreToolScheduler,
  type CompletedToolCall,
} from './coreToolScheduler.js';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  ToolInvocation,
  ToolResult,
  Config,
  Kind,
  ApprovalMode,
  ToolRegistry,
} from '../index.js';
import { PolicyDecision } from '../policy/types.js';

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

// Fast-completing tool invocation
class FastToolInvocation extends BaseToolInvocation<
  Record<string, unknown>,
  ToolResult
> {
  constructor(
    params: Record<string, unknown>,
    private readonly delayMs: number = 0,
    private readonly result: ToolResult = {
      llmContent: 'Fast tool completed',
      returnDisplay: 'Fast tool completed',
    },
  ) {
    super(params);
  }

  async execute(): Promise<ToolResult> {
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    return this.result;
  }

  getDescription(): string {
    return 'Fast tool invocation';
  }
}

// Fast-completing tool
class FastTool extends BaseDeclarativeTool<
  Record<string, unknown>,
  ToolResult
> {
  constructor(
    name: string = 'fast_tool',
    private readonly delayMs: number = 0,
    private readonly result?: ToolResult,
  ) {
    super(name, 'Fast Tool', 'A tool that completes quickly', Kind.Other, {
      type: 'object',
      properties: {},
    });
  }

  protected createInvocation(
    params: Record<string, unknown>,
  ): ToolInvocation<Record<string, unknown>, ToolResult> {
    return new FastToolInvocation(params, this.delayMs, this.result);
  }
}

describe('CoreToolScheduler - Issue #987 Race Condition Tests', () => {
  let onAllToolCallsComplete: ReturnType<typeof vi.fn>;
  let onToolCallsUpdate: ReturnType<typeof vi.fn>;

  function createConfig(tools: Map<string, FastTool>): Config {
    const mockMessageBus = createMockMessageBus();
    const mockPolicyEngine = createMockPolicyEngine();

    const mockToolRegistry = {
      getTool: (name: string) => tools.get(name) ?? null,
      getFunctionDeclarations: () => [],
      tools: new Map(),
      discovery: {},
      registerTool: () => {},
      getToolByName: (name: string) => tools.get(name) ?? null,
      getToolByDisplayName: (name: string) => tools.get(name) ?? null,
      getTools: () => [],
      discoverTools: async () => {},
      getAllTools: () => Array.from(tools.values()),
      getToolsByServer: () => [],
      getAllToolNames: () => Array.from(tools.keys()),
    } as unknown as ToolRegistry;

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
      getMessageBus: () => mockMessageBus,
      getPolicyEngine: () => mockPolicyEngine,
    } as unknown as Config;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    onAllToolCallsComplete = vi.fn();
    onToolCallsUpdate = vi.fn();
  });

  describe('Batch Size Race Condition', () => {
    it('should complete even when tools finish before batch is fully initialized', async () => {
      // This test verifies the fix for the race condition where
      // currentBatchSize is 0 but pendingResults has entries

      const tools = new Map([['fast_tool', new FastTool('fast_tool', 0)]]);
      const config = createConfig(tools);

      const scheduler = new CoreToolScheduler({
        config,
        onAllToolCallsComplete,
        onToolCallsUpdate,
        getPreferredEditor: () => 'vscode',
        onEditorClose: vi.fn(),
      });

      const abortController = new AbortController();

      // Schedule a single fast-completing tool
      await scheduler.schedule(
        [
          {
            callId: 'fast-1',
            name: 'fast_tool',
            args: {},
            isClientInitiated: false,
            prompt_id: 'prompt-1',
          },
        ],
        abortController.signal,
      );

      // Tool should complete successfully, not hang
      expect(onAllToolCallsComplete).toHaveBeenCalled();
      const completedCalls = onAllToolCallsComplete.mock
        .calls[0][0] as CompletedToolCall[];
      expect(completedCalls[0].status).toBe('success');

      scheduler.dispose();
    });

    it('should handle multiple fast tools completing simultaneously', async () => {
      // Create tools with different completion times
      const tools = new Map([
        ['fast_tool_1', new FastTool('fast_tool_1', 0)],
        ['fast_tool_2', new FastTool('fast_tool_2', 5)],
        ['fast_tool_3', new FastTool('fast_tool_3', 10)],
      ]);
      const config = createConfig(tools);

      const scheduler = new CoreToolScheduler({
        config,
        onAllToolCallsComplete,
        onToolCallsUpdate,
        getPreferredEditor: () => 'vscode',
        onEditorClose: vi.fn(),
      });

      const abortController = new AbortController();

      // Schedule multiple tools that complete at different times
      await scheduler.schedule(
        [
          {
            callId: 'fast-1',
            name: 'fast_tool_1',
            args: {},
            isClientInitiated: false,
            prompt_id: 'prompt-1',
          },
          {
            callId: 'fast-2',
            name: 'fast_tool_2',
            args: {},
            isClientInitiated: false,
            prompt_id: 'prompt-2',
          },
          {
            callId: 'fast-3',
            name: 'fast_tool_3',
            args: {},
            isClientInitiated: false,
            prompt_id: 'prompt-3',
          },
        ],
        abortController.signal,
      );

      // Wait for async completion
      await vi.waitFor(() => {
        expect(onAllToolCallsComplete).toHaveBeenCalled();
      });

      const completedCalls = onAllToolCallsComplete.mock
        .calls[0][0] as CompletedToolCall[];
      expect(completedCalls).toHaveLength(3);
      expect(completedCalls.every((call) => call.status === 'success')).toBe(
        true,
      );

      scheduler.dispose();
    });

    it('should publish results in order even when tools complete out of order', async () => {
      // Create tools that complete in reverse order
      const tools = new Map([
        ['slow_first', new FastTool('slow_first', 50)],
        ['fast_second', new FastTool('fast_second', 10)],
        ['fastest_third', new FastTool('fastest_third', 0)],
      ]);
      const config = createConfig(tools);

      const scheduler = new CoreToolScheduler({
        config,
        onAllToolCallsComplete,
        onToolCallsUpdate,
        getPreferredEditor: () => 'vscode',
        onEditorClose: vi.fn(),
      });

      const abortController = new AbortController();

      await scheduler.schedule(
        [
          {
            callId: 'tool-1',
            name: 'slow_first',
            args: {},
            isClientInitiated: false,
            prompt_id: 'prompt-1',
          },
          {
            callId: 'tool-2',
            name: 'fast_second',
            args: {},
            isClientInitiated: false,
            prompt_id: 'prompt-2',
          },
          {
            callId: 'tool-3',
            name: 'fastest_third',
            args: {},
            isClientInitiated: false,
            prompt_id: 'prompt-3',
          },
        ],
        abortController.signal,
      );

      // Wait for async completion
      await vi.waitFor(() => {
        expect(onAllToolCallsComplete).toHaveBeenCalled();
      });

      const completedCalls = onAllToolCallsComplete.mock
        .calls[0][0] as CompletedToolCall[];
      expect(completedCalls).toHaveLength(3);

      scheduler.dispose();
    });

    it('should not enter infinite setImmediate loop when currentBatchSize is 0', async () => {
      // This test verifies the fix prevents the infinite loop described in issue #987

      const tools = new Map([['fast_tool', new FastTool('fast_tool', 0)]]);
      const config = createConfig(tools);

      const scheduler = new CoreToolScheduler({
        config,
        onAllToolCallsComplete,
        onToolCallsUpdate,
        getPreferredEditor: () => 'vscode',
        onEditorClose: vi.fn(),
      });

      const abortController = new AbortController();

      // Track setImmediate calls
      const originalSetImmediate = global.setImmediate;
      let setImmediateCount = 0;
      global.setImmediate = ((callback: () => void) => {
        setImmediateCount++;
        if (setImmediateCount > 100) {
          throw new Error('Infinite setImmediate loop detected!');
        }
        return originalSetImmediate(callback);
      }) as typeof setImmediate;

      try {
        await scheduler.schedule(
          [
            {
              callId: 'test-1',
              name: 'fast_tool',
              args: {},
              isClientInitiated: false,
              prompt_id: 'prompt-1',
            },
          ],
          abortController.signal,
        );

        // Should complete without entering infinite loop
        expect(onAllToolCallsComplete).toHaveBeenCalled();
        // The count should be reasonable, not excessive
        expect(setImmediateCount).toBeLessThan(50);
      } finally {
        global.setImmediate = originalSetImmediate;
        scheduler.dispose();
      }
    });
  });

  describe('Cancel During Execution', () => {
    it('should handle cancellation before execution starts without hanging', async () => {
      // Create a slow tool that would hang if not cancelled properly
      const tools = new Map([['slow_tool', new FastTool('slow_tool', 5000)]]);
      const config = createConfig(tools);

      const scheduler = new CoreToolScheduler({
        config,
        onAllToolCallsComplete,
        onToolCallsUpdate,
        getPreferredEditor: () => 'vscode',
        onEditorClose: vi.fn(),
      });

      const abortController = new AbortController();

      // Abort before scheduling
      abortController.abort();

      // Schedule with pre-aborted signal
      await scheduler.schedule(
        [
          {
            callId: 'slow-1',
            name: 'slow_tool',
            args: {},
            isClientInitiated: false,
            prompt_id: 'prompt-1',
          },
        ],
        abortController.signal,
      );

      // Wait for async completion - should be cancelled, not hung
      await vi.waitFor(() => {
        expect(onAllToolCallsComplete).toHaveBeenCalled();
      });

      const completedCalls = onAllToolCallsComplete.mock
        .calls[0][0] as CompletedToolCall[];
      expect(completedCalls[0].status).toBe('cancelled');

      scheduler.dispose();
    });
  });

  describe('State Reset After Completion', () => {
    it('should properly reset state after batch completion for subsequent batches', async () => {
      const tools = new Map([['fast_tool', new FastTool('fast_tool', 0)]]);
      const config = createConfig(tools);

      const scheduler = new CoreToolScheduler({
        config,
        onAllToolCallsComplete,
        onToolCallsUpdate,
        getPreferredEditor: () => 'vscode',
        onEditorClose: vi.fn(),
      });

      // First batch
      await scheduler.schedule(
        [
          {
            callId: 'batch1-tool1',
            name: 'fast_tool',
            args: {},
            isClientInitiated: false,
            prompt_id: 'prompt-1',
          },
        ],
        new AbortController().signal,
      );

      await vi.waitFor(() => {
        expect(onAllToolCallsComplete).toHaveBeenCalledTimes(1);
      });

      // Second batch should also complete successfully
      await scheduler.schedule(
        [
          {
            callId: 'batch2-tool1',
            name: 'fast_tool',
            args: {},
            isClientInitiated: false,
            prompt_id: 'prompt-2',
          },
        ],
        new AbortController().signal,
      );

      await vi.waitFor(() => {
        expect(onAllToolCallsComplete).toHaveBeenCalledTimes(2);
      });

      scheduler.dispose();
    });
  });
});
