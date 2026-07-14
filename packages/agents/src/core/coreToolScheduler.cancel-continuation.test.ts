/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import type { ToolCall, WaitingToolCall } from './coreToolScheduler.js';
import { CoreToolScheduler } from './coreToolScheduler.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import { DEFAULT_GEMINI_MODEL } from '@vybestack/llxprt-code-core/config/models.js';
import { MockTool } from '@vybestack/llxprt-code-core/test-utils/mock-tool.js';
import { PolicyDecision } from '@vybestack/llxprt-code-core/policy/types.js';
import {
  createMockMessageBus,
  createMockPolicyEngine,
  waitForStatus,
} from './coreToolScheduler-test-helpers.js';

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
      return calls.some((c) => c.status === 'executing');
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
      return calls.filter((c) => c.status === 'executing').length === 2;
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
