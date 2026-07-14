/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { CoreToolScheduler } from './coreToolScheduler.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import { DEFAULT_GEMINI_MODEL } from '@vybestack/llxprt-code-core/config/models.js';
import { MockTool } from '@vybestack/llxprt-code-core/test-utils/mock-tool.js';
import {
  createMockMessageBus,
  createMockPolicyEngine,
} from './coreToolScheduler-test-helpers.js';

describe('CoreToolScheduler race conditions and recovery', () => {
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
