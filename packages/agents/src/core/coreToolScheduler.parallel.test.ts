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
});
