/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import type {
  ToolCall,
  WaitingToolCall,
  CompletedToolCall,
} from './coreToolScheduler.js';
import { CoreToolScheduler } from './coreToolScheduler.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import { DEFAULT_GEMINI_MODEL } from '@vybestack/llxprt-code-core/config/models.js';
import { MockTool } from '@vybestack/llxprt-code-core/test-utils/mock-tool.js';
import { PolicyDecision } from '@vybestack/llxprt-code-core/policy/types.js';
import { HookSystem } from '@vybestack/llxprt-code-core/hooks/hookSystem.js';
import {
  createMockMessageBus,
  createMockPolicyEngine,
  createMockConfig,
  waitForStatus,
} from './coreToolScheduler-test-helpers.js';

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

  it('should not double-report completed tools when concurrent completions occur', async () => {
    // Arrange
    const executeFn = vi.fn().mockResolvedValue({ llmContent: 'success' });
    const mockTool = new MockTool({ name: 'mockTool', execute: executeFn });
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

    let completionCallCount = 0;
    const onAllToolCallsComplete = vi.fn().mockImplementation(async () => {
      completionCallCount++;
      // Simulate slow reporting (e.g. Gemini API call)
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const mockConfig = createMockConfig({
      getToolRegistry: () => mockToolRegistry,
      getApprovalMode: () => ApprovalMode.YOLO,
      isInteractive: () => false,
    });
    const mockMessageBus = createMockMessageBus();
    mockConfig.getMessageBus = vi.fn().mockReturnValue(mockMessageBus);
    mockConfig.getEnableHooks = vi.fn().mockReturnValue(false);
    mockConfig.getHookSystem = vi
      .fn()
      .mockReturnValue(new HookSystem(mockConfig));

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
      messageBus: mockMessageBus,
      toolRegistry: mockToolRegistry,
      onAllToolCallsComplete,
      getPreferredEditor: () => 'vscode',
    });

    const abortController = new AbortController();
    const request = {
      callId: '1',
      name: 'mockTool',
      args: {},
      isClientInitiated: false,
      prompt_id: 'prompt-1',
    };

    // Act
    // 1. Start execution
    const schedulePromise = scheduler.schedule(
      [request],
      abortController.signal,
    );

    // 2. Wait just enough for it to finish and enter checkAndNotifyCompletion
    // (awaiting our slow mock)
    await vi.waitFor(() => {
      expect(completionCallCount).toBe(1);
    });

    // 3. Trigger a concurrent completion event (e.g. via cancelAll)
    scheduler.cancelAll(abortController.signal);

    await schedulePromise;

    // Assert
    // Even though cancelAll was called while the first completion was in progress,
    // it should not have triggered a SECOND completion call because the first one
    // was still 'finalizing' and will drain any new tools.
    expect(onAllToolCallsComplete).toHaveBeenCalledTimes(1);
  });

  it('should complete reporting all tools even mid-callback during abort', async () => {
    // Arrange
    const onAllToolCallsComplete = vi.fn().mockImplementation(async () => {
      // Simulate slow reporting
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const mockTool = new MockTool({ name: 'mockTool' });
    const mockToolRegistry = {
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
    } as unknown as ToolRegistry;

    const mockConfig = createMockConfig({
      getToolRegistry: () => mockToolRegistry,
      getApprovalMode: () => ApprovalMode.YOLO,
      isInteractive: () => false,
    });
    const mockMessageBus = createMockMessageBus();

    const scheduler = new CoreToolScheduler({
      config: mockConfig,
      messageBus: mockMessageBus,
      toolRegistry: mockToolRegistry,
      onAllToolCallsComplete,
      getPreferredEditor: () => 'vscode',
    });

    const abortController = new AbortController();
    const signal = abortController.signal;

    // Act
    // 1. Start execution of two tools
    const schedulePromise = scheduler.schedule(
      [
        {
          callId: '1',
          name: 'mockTool',
          args: {},
          isClientInitiated: false,
          prompt_id: 'prompt-1',
        },
        {
          callId: '2',
          name: 'mockTool',
          args: {},
          isClientInitiated: false,
          prompt_id: 'prompt-1',
        },
      ],
      signal,
    );

    // 2. Wait for reporting to start
    await vi.waitFor(() => {
      expect(onAllToolCallsComplete).toHaveBeenCalled();
    });

    // 3. Abort the signal while reporting is in progress
    abortController.abort();

    await schedulePromise;

    // Assert
    // Verify that onAllToolCallsComplete was called and processed the tools,
    // and that the scheduler didn't just drop them because of the abort.
    expect(onAllToolCallsComplete).toHaveBeenCalled();

    const reportedTools = onAllToolCallsComplete.mock.calls.flatMap((call) =>
      call[0].map((t: ToolCall) => t.request.callId),
    );

    // Both tools should have been reported exactly once with success status
    expect(reportedTools).toContain('1');
    expect(reportedTools).toContain('2');

    const allStatuses = onAllToolCallsComplete.mock.calls.flatMap((call) =>
      call[0].map((t: ToolCall) => t.status),
    );
    expect(allStatuses).toStrictEqual(['success', 'success']);

    expect(onAllToolCallsComplete).toHaveBeenCalledTimes(1);
  });
});
