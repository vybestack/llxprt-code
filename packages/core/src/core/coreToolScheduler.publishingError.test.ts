/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
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

describe('CoreToolScheduler publishing error handling', () => {
  it('should transition tool to success state after successful execution', async () => {
    const publishOrder: number[] = [];

    const executeFn = vi
      .fn()
      .mockImplementation(async (args: { call: number }) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return {
          llmContent: `Call ${args.call} done`,
          returnDisplay: `Result ${args.call}`,
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
      ],
      signal,
    );

    await vi.waitFor(
      () => {
        expect(onAllToolCallsComplete).toHaveBeenCalled();
      },
      { timeout: 2000 },
    );

    const completedCalls = onAllToolCallsComplete.mock.calls.at(
      -1,
    )?.[0] as ToolCall[];
    expect(completedCalls).toBeDefined();
    expect(completedCalls.length).toBe(1);

    const finalStatus = completedCalls[0].status;
    expect(finalStatus).toBe('success');
  });

  it('should force tool to error state if publishBufferedResults throws', async () => {
    const executeFn = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return {
        llmContent: 'Tool executed successfully',
        returnDisplay: 'Success',
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

    // Spy on publishBufferedResults to throw an error, simulating a publishing failure
    // This tests the final catch handler (lines 1620-1652) that ensures tools reach
    // terminal state even when publishBufferedResults throws
    const publishSpy = vi
      .spyOn(
        scheduler as unknown as {
          publishBufferedResults: (signal: AbortSignal) => Promise<void>;
        },
        'publishBufferedResults',
      )
      .mockRejectedValue(new Error('Publishing crashed unexpectedly'));

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
      ],
      signal,
    );

    await vi.waitFor(
      () => {
        expect(onAllToolCallsComplete).toHaveBeenCalled();
      },
      { timeout: 2000 },
    );

    const completedCalls = onAllToolCallsComplete.mock.calls.at(
      -1,
    )?.[0] as ToolCall[];
    expect(completedCalls).toBeDefined();
    expect(completedCalls.length).toBe(1);
    // The tool should end up in 'error' state because the final catch handler
    // forces it to error when publishBufferedResults throws
    expect(completedCalls[0].status).toBe('error');
    expect(publishSpy).toHaveBeenCalled();
  });
});
