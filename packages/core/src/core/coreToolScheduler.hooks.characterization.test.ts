/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CoreToolScheduler,
  type CompletedToolCall,
} from './coreToolScheduler.js';
import { ApprovalMode, type Config, type ToolRegistry } from '../index.js';
import { MockTool } from '../test-utils/mock-tool.js';
import { PolicyDecision } from '../policy/types.js';
import { getTestRuntimeMessageBus } from '../test-utils/config.js';

function createMockPolicyEngine() {
  return {
    evaluate: vi.fn().mockReturnValue(PolicyDecision.ALLOW),
    checkDecision: vi.fn().mockReturnValue(PolicyDecision.ALLOW),
  };
}

function createMockToolRegistry(tool: MockTool): ToolRegistry {
  return {
    getTool: () => tool,
    getToolByName: () => tool,
    getFunctionDeclarations: () => [],
    tools: new Map(),
    discovery: {},
    registerTool: () => {},
    getToolByDisplayName: () => tool,
    getTools: () => [tool],
    discoverTools: async () => {},
    getAllTools: () => [tool],
    getAllToolNames: () => [tool.name],
    getToolsByServer: () => [],
  } as unknown as ToolRegistry;
}

function createHookSystem(options?: {
  beforeToolResult: Record<string, unknown> | undefined;
  afterToolResult: Record<string, unknown> | undefined;
}) {
  const eventHandler = {
    fireBeforeToolEvent: vi.fn().mockResolvedValue(options?.beforeToolResult),
    fireAfterToolEvent: vi.fn().mockResolvedValue(options?.afterToolResult),
  };

  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    getEventHandler: vi.fn().mockReturnValue(eventHandler),
    fireBeforeToolEvent: vi.fn().mockResolvedValue(options?.beforeToolResult),
    fireAfterToolEvent: vi.fn().mockResolvedValue(options?.afterToolResult),
    eventHandler,
  };
}

function createMockConfig(
  toolRegistry: ToolRegistry,
  hookSystem: ReturnType<typeof createHookSystem>,
): Config {
  const mockPolicyEngine = createMockPolicyEngine();

  return {
    getSessionId: () => 'test-session-id',
    getUsageStatisticsEnabled: () => false,
    getDebugMode: () => false,
    isInteractive: () => true,
    getApprovalMode: () => ApprovalMode.YOLO,
    getEphemeralSettings: () => ({}),
    getAllowedTools: () => [],
    getExcludeTools: () => [],
    getContentGeneratorConfig: () => ({ model: 'test-model' }),
    getToolRegistry: () => toolRegistry,
    getPolicyEngine: () => mockPolicyEngine,
    getEnableHooks: () => true,
    getHookSystem: () => hookSystem,
  } as unknown as Config;
}

async function scheduleAndWaitForCompletion(
  scheduler: CoreToolScheduler,
  request:
    | {
        callId: string;
        name: string;
        args: Record<string, unknown>;
        isClientInitiated: boolean;
        prompt_id: string;
      }
    | Array<{
        callId: string;
        name: string;
        args: Record<string, unknown>;
        isClientInitiated: boolean;
        prompt_id: string;
      }>,
): Promise<CompletedToolCall[]> {
  let completionResolver: ((calls: CompletedToolCall[]) => void) | null = null;
  const completionPromise = new Promise<CompletedToolCall[]>((resolve) => {
    completionResolver = resolve;
  });

  scheduler.onAllToolCallsComplete = async (calls) => {
    completionResolver?.(calls);
  };

  await scheduler.schedule(
    Array.isArray(request) ? request : [request],
    new AbortController().signal,
  );
  return completionPromise;
}

describe('CoreToolScheduler hook-enabled characterization', () => {
  let scheduler: CoreToolScheduler | undefined;

  afterEach(() => {
    if (scheduler != null) {
      scheduler.dispose();
      scheduler = undefined;
    }
  });

  it('buffers an error and skips tool execution when a before-hook blocks', async () => {
    const mockTool = new MockTool('hooked-tool');
    const toolRegistry = createMockToolRegistry(mockTool);
    const hookSystem = createHookSystem({
      beforeToolResult: {
        decision: 'block',
        reason: 'blocked by before hook',
      },
    });
    const config = createMockConfig(toolRegistry, hookSystem);

    scheduler = new CoreToolScheduler({
      config,
      messageBus: getTestRuntimeMessageBus(config),
      toolRegistry: config.getToolRegistry(),
      onAllToolCallsComplete: async () => {},
      onToolCallsUpdate: vi.fn(),
      getPreferredEditor: () => undefined,
      onEditorClose: () => {},
    });

    const completedCalls = await scheduleAndWaitForCompletion(scheduler, {
      callId: 'blocked-call',
      name: 'hooked-tool',
      args: { original: true },
      isClientInitiated: false,
      prompt_id: 'prompt-1',
    });

    expect(mockTool.executeFn).not.toHaveBeenCalled();
    expect(completedCalls).toHaveLength(1);
    expect(completedCalls[0].status).toBe('error');
    // eslint-disable-next-line vitest/no-conditional-in-test -- Type narrowing for discriminated union
    if (completedCalls[0].status === 'error') {
      expect(completedCalls[0].response.error.message).toBe(
        'blocked by before hook',
      );
    }
  });

  it('surfaces an error and skips tool execution when a before-hook requests stop', async () => {
    const mockTool = new MockTool({
      name: 'hooked-tool',
      execute: async () => ({
        llmContent: 'tool should not run',
        returnDisplay: 'tool should not run',
      }),
    });
    const toolRegistry = createMockToolRegistry(mockTool);
    const hookSystem = createHookSystem({
      beforeToolResult: {
        continue: false,
        stopReason: 'stop requested by before hook',
      },
    });
    const config = createMockConfig(toolRegistry, hookSystem);

    scheduler = new CoreToolScheduler({
      config,
      messageBus: getTestRuntimeMessageBus(config),
      toolRegistry: config.getToolRegistry(),
      onAllToolCallsComplete: async () => {},
      onToolCallsUpdate: vi.fn(),
      getPreferredEditor: () => undefined,
      onEditorClose: () => {},
    });

    const completedCalls = await scheduleAndWaitForCompletion(scheduler, {
      callId: 'stop-before-call',
      name: 'hooked-tool',
      args: {},
      isClientInitiated: false,
      prompt_id: 'prompt-1',
    });

    expect(mockTool.executeFn).not.toHaveBeenCalled();
    expect(completedCalls).toHaveLength(1);
    expect(completedCalls[0].status).toBe('error');
    // eslint-disable-next-line vitest/no-conditional-in-test -- Type narrowing for discriminated union
    if (completedCalls[0].status === 'error') {
      expect(completedCalls[0].response.error.message).toBe(
        'stop requested by before hook',
      );
    }
  });

  it('executes the tool with modified input when a before-hook returns tool_input', async () => {
    const receivedArgs: Array<Record<string, unknown>> = [];
    const mockTool = new MockTool({
      name: 'hooked-tool',
      execute: async (args) => {
        receivedArgs.push(args);
        return {
          llmContent: JSON.stringify(args),
          returnDisplay: JSON.stringify(args),
        };
      },
    });
    const toolRegistry = createMockToolRegistry(mockTool);
    const hookSystem = createHookSystem({
      beforeToolResult: {
        hookSpecificOutput: {
          tool_input: { rewritten: true, count: 2 },
        },
      },
    });
    const config = createMockConfig(toolRegistry, hookSystem);

    scheduler = new CoreToolScheduler({
      config,
      messageBus: getTestRuntimeMessageBus(config),
      toolRegistry: config.getToolRegistry(),
      onAllToolCallsComplete: async () => {},
      onToolCallsUpdate: vi.fn(),
      getPreferredEditor: () => undefined,
      onEditorClose: () => {},
    });

    await scheduleAndWaitForCompletion(scheduler, {
      callId: 'modified-call',
      name: 'hooked-tool',
      args: { original: true },
      isClientInitiated: false,
      prompt_id: 'prompt-1',
    });

    expect(receivedArgs).toStrictEqual([{ rewritten: true, count: 2 }]);
  });

  it('appends after-hook systemMessage text to the successful result content', async () => {
    const mockTool = new MockTool({
      name: 'hooked-tool',
      execute: async () => ({
        llmContent: 'tool output',
        returnDisplay: 'tool output',
      }),
    });
    const toolRegistry = createMockToolRegistry(mockTool);
    const hookSystem = createHookSystem({
      afterToolResult: {
        systemMessage: 'after hook note',
      },
    });
    const config = createMockConfig(toolRegistry, hookSystem);

    scheduler = new CoreToolScheduler({
      config,
      messageBus: getTestRuntimeMessageBus(config),
      toolRegistry: config.getToolRegistry(),
      onAllToolCallsComplete: async () => {},
      onToolCallsUpdate: vi.fn(),
      getPreferredEditor: () => undefined,
      onEditorClose: () => {},
    });

    const completedCalls = await scheduleAndWaitForCompletion(scheduler, {
      callId: 'after-message-call',
      name: 'hooked-tool',
      args: {},
      isClientInitiated: false,
      prompt_id: 'prompt-1',
    });

    expect(completedCalls[0].status).toBe('success');
    // eslint-disable-next-line vitest/no-conditional-in-test -- Type narrowing for discriminated union
    if (completedCalls[0].status === 'success') {
      const responsePart = completedCalls[0].response.responseParts[0];
      expect(responsePart.functionResponse?.response).toStrictEqual({
        output: 'tool output\n\nafter hook note',
      });
    }
  });

  it('appends before-hook systemMessage text to the successful result content', async () => {
    const mockTool = new MockTool({
      name: 'hooked-tool',
      execute: async () => ({
        llmContent: 'tool output',
        returnDisplay: 'tool output',
      }),
    });
    const toolRegistry = createMockToolRegistry(mockTool);
    const hookSystem = createHookSystem({
      beforeToolResult: {
        systemMessage: 'before hook note',
      },
    });
    const config = createMockConfig(toolRegistry, hookSystem);

    scheduler = new CoreToolScheduler({
      config,
      messageBus: getTestRuntimeMessageBus(config),
      toolRegistry: config.getToolRegistry(),
      onAllToolCallsComplete: async () => {},
      onToolCallsUpdate: vi.fn(),
      getPreferredEditor: () => undefined,
      onEditorClose: () => {},
    });

    const completedCalls = await scheduleAndWaitForCompletion(scheduler, {
      callId: 'before-message-call',
      name: 'hooked-tool',
      args: {},
      isClientInitiated: false,
      prompt_id: 'prompt-1',
    });

    expect(completedCalls[0].status).toBe('success');
    if (completedCalls[0].status === 'success') {
      const responsePart = completedCalls[0].response.responseParts[0];
      expect(responsePart.functionResponse?.response).toStrictEqual({
        output: 'tool output\n\nbefore hook note',
      });
    }
  });

  it('surfaces an error when an after-hook requests stop', async () => {
    const mockTool = new MockTool({
      name: 'hooked-tool',
      execute: async () => ({
        llmContent: 'tool output',
        returnDisplay: 'tool output',
      }),
    });
    const toolRegistry = createMockToolRegistry(mockTool);
    const hookSystem = createHookSystem({
      afterToolResult: {
        continue: false,
        stopReason: 'stop requested by after hook',
      },
    });
    const config = createMockConfig(toolRegistry, hookSystem);

    scheduler = new CoreToolScheduler({
      config,
      messageBus: getTestRuntimeMessageBus(config),
      toolRegistry: config.getToolRegistry(),
      onAllToolCallsComplete: async () => {},
      onToolCallsUpdate: vi.fn(),
      getPreferredEditor: () => undefined,
      onEditorClose: () => {},
    });

    const completedCalls = await scheduleAndWaitForCompletion(scheduler, {
      callId: 'stop-after-call',
      name: 'hooked-tool',
      args: {},
      isClientInitiated: false,
      prompt_id: 'prompt-1',
    });

    expect(mockTool.executeFn).toHaveBeenCalledTimes(1);
    expect(completedCalls).toHaveLength(1);
    expect(completedCalls[0].status).toBe('error');
    // eslint-disable-next-line vitest/no-conditional-in-test -- Type narrowing for discriminated union
    if (completedCalls[0].status === 'error') {
      expect(completedCalls[0].response.error.message).toBe(
        'stop requested by after hook',
      );
    }
  });

  it('surfaces an error when an after-hook blocks after tool execution', async () => {
    const mockTool = new MockTool({
      name: 'hooked-tool',
      execute: async () => ({
        llmContent: 'tool output',
        returnDisplay: 'tool output',
      }),
    });
    const toolRegistry = createMockToolRegistry(mockTool);
    const hookSystem = createHookSystem({
      afterToolResult: {
        decision: 'block',
        reason: 'blocked by after hook',
      },
    });
    const config = createMockConfig(toolRegistry, hookSystem);

    scheduler = new CoreToolScheduler({
      config,
      messageBus: getTestRuntimeMessageBus(config),
      toolRegistry: config.getToolRegistry(),
      onAllToolCallsComplete: async () => {},
      onToolCallsUpdate: vi.fn(),
      getPreferredEditor: () => undefined,
      onEditorClose: () => {},
    });

    const completedCalls = await scheduleAndWaitForCompletion(scheduler, {
      callId: 'block-after-call',
      name: 'hooked-tool',
      args: {},
      isClientInitiated: false,
      prompt_id: 'prompt-1',
    });

    expect(mockTool.executeFn).toHaveBeenCalledTimes(1);
    expect(completedCalls).toHaveLength(1);
    expect(completedCalls[0].status).toBe('error');
    // eslint-disable-next-line vitest/no-conditional-in-test -- Type narrowing for discriminated union
    if (completedCalls[0].status === 'error') {
      expect(completedCalls[0].response.error.message).toBe(
        'blocked by after hook',
      );
    }
  });

  it('sets suppressDisplay when an after-hook requests suppressOutput', async () => {
    const mockTool = new MockTool({
      name: 'hooked-tool',
      execute: async () => ({
        llmContent: 'tool output',
        returnDisplay: 'tool output',
      }),
    });
    const toolRegistry = createMockToolRegistry(mockTool);
    const hookSystem = createHookSystem({
      afterToolResult: {
        suppressOutput: true,
      },
    });
    const config = createMockConfig(toolRegistry, hookSystem);

    scheduler = new CoreToolScheduler({
      config,
      messageBus: getTestRuntimeMessageBus(config),
      toolRegistry: config.getToolRegistry(),
      onAllToolCallsComplete: async () => {},
      onToolCallsUpdate: vi.fn(),
      getPreferredEditor: () => undefined,
      onEditorClose: () => {},
    });

    const completedCalls = await scheduleAndWaitForCompletion(scheduler, {
      callId: 'suppress-call',
      name: 'hooked-tool',
      args: {},
      isClientInitiated: false,
      prompt_id: 'prompt-1',
    });

    expect(completedCalls[0].status).toBe('success');
    // eslint-disable-next-line vitest/no-conditional-in-test -- Type narrowing for discriminated union
    if (completedCalls[0].status === 'success') {
      expect(completedCalls[0].response.suppressDisplay).toBe(true);
    }
  });

  it('preserves parallel batching while publishing results in request order', async () => {
    let activeExecutions = 0;
    let maxConcurrentExecutions = 0;
    const resolvers = new Map<string, () => void>();

    const mockTool = new MockTool({
      name: 'hooked-tool',
      execute: async (args) => {
        const id = String(args.id);
        activeExecutions += 1;
        maxConcurrentExecutions = Math.max(
          maxConcurrentExecutions,
          activeExecutions,
        );

        await new Promise<void>((resolve) => {
          resolvers.set(id, () => {
            activeExecutions -= 1;
            resolve();
          });
        });

        return {
          llmContent: `tool output ${id}`,
          returnDisplay: `tool output ${id}`,
        };
      },
    });
    const toolRegistry = createMockToolRegistry(mockTool);
    const hookSystem = createHookSystem();
    const config = createMockConfig(toolRegistry, hookSystem);

    scheduler = new CoreToolScheduler({
      config,
      messageBus: getTestRuntimeMessageBus(config),
      toolRegistry: config.getToolRegistry(),
      onAllToolCallsComplete: async () => {},
      onToolCallsUpdate: vi.fn(),
      getPreferredEditor: () => undefined,
      onEditorClose: () => {},
    });

    const completionPromise = scheduleAndWaitForCompletion(scheduler, [
      {
        callId: 'batch-1',
        name: 'hooked-tool',
        args: { id: '1' },
        isClientInitiated: false,
        prompt_id: 'prompt-1',
      },
      {
        callId: 'batch-2',
        name: 'hooked-tool',
        args: { id: '2' },
        isClientInitiated: false,
        prompt_id: 'prompt-1',
      },
      {
        callId: 'batch-3',
        name: 'hooked-tool',
        args: { id: '3' },
        isClientInitiated: false,
        prompt_id: 'prompt-1',
      },
    ]);

    await vi.waitFor(() => {
      expect(resolvers.size).toBe(3);
    });

    resolvers.get('2')?.();
    resolvers.get('3')?.();
    await Promise.resolve();
    resolvers.get('1')?.();

    const completedCalls = await completionPromise;

    expect(maxConcurrentExecutions).toBeGreaterThan(1);
    expect(completedCalls.map((call) => call.request.callId)).toStrictEqual([
      'batch-1',
      'batch-2',
      'batch-3',
    ]);
    expect(completedCalls.map((call) => call.status)).toStrictEqual([
      'success',
      'success',
      'success',
    ]);
  });
});
