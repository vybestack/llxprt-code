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

// Track execution order for verifying parallel execution
const executionLog: Array<{
  name: string;
  startTime: number;
  endTime?: number;
}> = [];

class OrderTrackingInvocation extends BaseToolInvocation<
  Record<string, unknown>,
  ToolResult
> {
  constructor(
    params: Record<string, unknown>,
    private readonly toolName: string,
    private readonly delayMs: number = 10,
    private readonly outputSize: number = 0,
  ) {
    super(params);
  }

  async execute(): Promise<ToolResult> {
    const entry = { name: this.toolName, startTime: Date.now() };
    executionLog.push(entry);

    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }

    entry.endTime = Date.now();

    // Generate large output if requested. Use varied characters so
    // tiktoken doesn't compress repeated chars into few tokens.
    let content: string;
    if (this.outputSize > 0) {
      const words =
        'The quick brown fox jumps over the lazy dog and returns some data. ';
      const repeats = Math.ceil(this.outputSize / words.length);
      content = words.repeat(repeats).slice(0, this.outputSize);
    } else {
      content = `${this.toolName} completed`;
    }

    return {
      llmContent: content,
      returnDisplay: content,
    };
  }

  getDescription(): string {
    return `Order tracking invocation for ${this.toolName}`;
  }
}

class OrderTrackingTool extends BaseDeclarativeTool<
  Record<string, unknown>,
  ToolResult
> {
  constructor(
    name: string,
    private readonly delayMs: number = 10,
    private readonly outputSize: number = 0,
  ) {
    super(name, name, `A tool named ${name}`, Kind.Other, {
      type: 'object',
      properties: {},
    });
  }

  protected createInvocation(
    params: Record<string, unknown>,
  ): ToolInvocation<Record<string, unknown>, ToolResult> {
    return new OrderTrackingInvocation(
      params,
      this.name,
      this.delayMs,
      this.outputSize,
    );
  }
}

describe('CoreToolScheduler - Issue #1301 Batch Output Budget', () => {
  let onAllToolCallsComplete: ReturnType<typeof vi.fn>;
  let onToolCallsUpdate: ReturnType<typeof vi.fn>;

  function createConfig(
    tools: Map<string, OrderTrackingTool>,
    ephemeralOverrides: Record<string, unknown> = {},
  ): Config {
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
      getEphemeralSettings: () => ({ ...ephemeralOverrides }),
      getAllowedTools: () => [],
      getContentGeneratorConfig: () => ({
        model: 'test-model',
      }),
      getModel: () => 'test-model',
      getToolRegistry: () => mockToolRegistry,
      getMessageBus: () => mockMessageBus,
      getPolicyEngine: () => mockPolicyEngine,
    } as unknown as Config;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    executionLog.length = 0;
    onAllToolCallsComplete = vi.fn();
    onToolCallsUpdate = vi.fn();
  });

  it('should not apply batch limits for a single tool call', async () => {
    const tools = new Map([
      ['solo_tool', new OrderTrackingTool('solo_tool', 10)],
    ]);
    const config = createConfig(tools, {
      'tool-output-max-tokens': 50000,
    });

    const scheduler = new CoreToolScheduler({
      config,
      onAllToolCallsComplete,
      onToolCallsUpdate,
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    await scheduler.schedule(
      [
        {
          callId: 'solo-1',
          name: 'solo_tool',
          args: {},
          isClientInitiated: false,
          prompt_id: 'p1',
        },
      ],
      new AbortController().signal,
    );

    await vi.waitFor(() => {
      expect(onAllToolCallsComplete).toHaveBeenCalled();
    });

    const calls = onAllToolCallsComplete.mock
      .calls[0][0] as CompletedToolCall[];
    expect(calls).toHaveLength(1);
    expect(calls[0].status).toBe('success');

    scheduler.dispose();
  });

  it('should execute multiple tools in parallel with reduced per-tool limits', async () => {
    // 2 tools: each gets 50k/2 = 25k token budget
    const tools = new Map([
      ['tool_a', new OrderTrackingTool('tool_a', 30)],
      ['tool_b', new OrderTrackingTool('tool_b', 30)],
    ]);
    const config = createConfig(tools);

    const scheduler = new CoreToolScheduler({
      config,
      onAllToolCallsComplete,
      onToolCallsUpdate,
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    await scheduler.schedule(
      [
        {
          callId: 'a1',
          name: 'tool_a',
          args: {},
          isClientInitiated: false,
          prompt_id: 'p1',
        },
        {
          callId: 'b1',
          name: 'tool_b',
          args: {},
          isClientInitiated: false,
          prompt_id: 'p1',
        },
      ],
      new AbortController().signal,
    );

    await vi.waitFor(() => {
      expect(onAllToolCallsComplete).toHaveBeenCalled();
    });

    const calls = onAllToolCallsComplete.mock
      .calls[0][0] as CompletedToolCall[];
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.status === 'success')).toBe(true);

    // Both tools should have started before either finished (parallel execution)
    expect(executionLog).toHaveLength(2);
    const earliestEnd = Math.min(...executionLog.map((e) => e.endTime!));
    const latestStart = Math.max(...executionLog.map((e) => e.startTime));
    expect(latestStart).toBeLessThan(earliestEnd);

    scheduler.dispose();
  });

  it('should truncate tool output when it exceeds per-tool budget', async () => {
    // tool-output-max-tokens = 10k → 4 tools each get 10k/4 = 2.5k tokens
    // effective limit after escape buffer = 2.5k × 0.8 = 2k tokens
    // Each tool produces 30k chars of English text ≈ 7.5k tokens → must be truncated
    const largeOutputSize = 30_000;
    const tools = new Map([
      ['big_tool_1', new OrderTrackingTool('big_tool_1', 10, largeOutputSize)],
      ['big_tool_2', new OrderTrackingTool('big_tool_2', 10, largeOutputSize)],
      ['big_tool_3', new OrderTrackingTool('big_tool_3', 10, largeOutputSize)],
      ['big_tool_4', new OrderTrackingTool('big_tool_4', 10, largeOutputSize)],
    ]);

    const config = createConfig(tools, {
      'tool-output-max-tokens': 10000,
    });

    const scheduler = new CoreToolScheduler({
      config,
      onAllToolCallsComplete,
      onToolCallsUpdate,
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    await scheduler.schedule(
      [
        {
          callId: 'big-1',
          name: 'big_tool_1',
          args: {},
          isClientInitiated: false,
          prompt_id: 'p1',
        },
        {
          callId: 'big-2',
          name: 'big_tool_2',
          args: {},
          isClientInitiated: false,
          prompt_id: 'p1',
        },
        {
          callId: 'big-3',
          name: 'big_tool_3',
          args: {},
          isClientInitiated: false,
          prompt_id: 'p1',
        },
        {
          callId: 'big-4',
          name: 'big_tool_4',
          args: {},
          isClientInitiated: false,
          prompt_id: 'p1',
        },
      ],
      new AbortController().signal,
    );

    await vi.waitFor(() => {
      expect(onAllToolCallsComplete).toHaveBeenCalled();
    });

    const calls = onAllToolCallsComplete.mock
      .calls[0][0] as CompletedToolCall[];
    expect(calls).toHaveLength(4);
    expect(calls.every((c) => c.status === 'success')).toBe(true);

    // Verify each tool's output was truncated to fit within per-tool budget
    for (const call of calls) {
      if (call.status !== 'success') continue;
      const responseParts = call.response.responseParts;

      const frPart = responseParts.find(
        (p) =>
          typeof p === 'object' &&
          'functionResponse' in p &&
          p.functionResponse?.response,
      );
      expect(frPart).toBeDefined();
      const output = (
        frPart as { functionResponse: { response: { output: string } } }
      ).functionResponse.response.output;

      // Original was 30k chars. With per-tool budget of 2.5k tokens (2k effective),
      // the output must be significantly smaller.
      expect(output.length).toBeLessThan(largeOutputSize);
      expect(output).toContain('[Output truncated due to token limit]');
    }

    scheduler.dispose();
  });

  it('should divide custom tool-output-max-tokens across batch', async () => {
    // User sets tool-output-max-tokens=100k → 10 tools each get 10k
    const tools = new Map<string, OrderTrackingTool>();
    const requests = [];
    for (let i = 0; i < 10; i++) {
      const name = `tool_${i}`;
      tools.set(name, new OrderTrackingTool(name, 10));
      requests.push({
        callId: `id-${i}`,
        name,
        args: {},
        isClientInitiated: false,
        prompt_id: 'p1',
      });
    }

    const config = createConfig(tools, {
      'tool-output-max-tokens': 100000,
    });

    const scheduler = new CoreToolScheduler({
      config,
      onAllToolCallsComplete,
      onToolCallsUpdate,
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    await scheduler.schedule(requests, new AbortController().signal);

    await vi.waitFor(() => {
      expect(onAllToolCallsComplete).toHaveBeenCalled();
    });

    const calls = onAllToolCallsComplete.mock
      .calls[0][0] as CompletedToolCall[];
    expect(calls).toHaveLength(10);
    expect(calls.every((c) => c.status === 'success')).toBe(true);

    // All 10 should still run in parallel
    expect(executionLog).toHaveLength(10);
    const firstStart = Math.min(...executionLog.map((e) => e.startTime));
    const lastStart = Math.max(...executionLog.map((e) => e.startTime));
    expect(lastStart - firstStart).toBeLessThan(50);

    scheduler.dispose();
  });

  it('should enforce minimum per-tool budget of 1000 tokens', async () => {
    // tool-output-max-tokens = 5000, 10 tools → 500 each → clamped to 1000
    const tools = new Map<string, OrderTrackingTool>();
    const requests = [];
    for (let i = 0; i < 10; i++) {
      const name = `tool_min_${i}`;
      tools.set(name, new OrderTrackingTool(name, 10));
      requests.push({
        callId: `min-${i}`,
        name,
        args: {},
        isClientInitiated: false,
        prompt_id: 'p1',
      });
    }

    const config = createConfig(tools, {
      'tool-output-max-tokens': 5000,
    });

    const scheduler = new CoreToolScheduler({
      config,
      onAllToolCallsComplete,
      onToolCallsUpdate,
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    await scheduler.schedule(requests, new AbortController().signal);

    await vi.waitFor(() => {
      expect(onAllToolCallsComplete).toHaveBeenCalled();
    });

    const calls = onAllToolCallsComplete.mock
      .calls[0][0] as CompletedToolCall[];
    expect(calls).toHaveLength(10);
    // All tools should complete (with clamped budget), not error
    expect(calls.every((c) => c.status === 'success')).toBe(true);

    scheduler.dispose();
  });
});
