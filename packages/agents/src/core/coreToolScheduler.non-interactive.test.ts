/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createSchedulerPolicyFixture } from './__tests__/scheduler-policy-fixture.js';

import { describe, it, expect, vi } from 'bun:test';
import type { ToolCall, ErroredToolCall } from './coreToolScheduler.js';
import { CoreToolScheduler } from './coreToolScheduler.js';

import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import { MockTool } from '@vybestack/llxprt-code-test-utils/core/mock-tool.js';
import { PolicyDecision } from '@vybestack/llxprt-code-core/policy/types.js';

describe('CoreToolScheduler non-interactive mode', () => {
  it('should error when tool requires confirmation in non-interactive mode', async () => {
    // ARRANGE
    const mockTool = new MockTool({ name: 'confirmTool' });
    mockTool.shouldConfirm = true; // Tool requires confirmation

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

    const onAllToolCallsComplete = vi.fn();
    const onToolCallsUpdate = vi.fn();

    let policyDecision = PolicyDecision.ALLOW;
    policyDecision = PolicyDecision.ASK_USER;

    const {
      config: mockConfig,
      settingsOwner,
      messageBus: runtimeMessageBus,
    } = createSchedulerPolicyFixture(
      {
        getSessionId: () => 'test-session-id',
        getUsageStatisticsEnabled: () => true,
        getDebugMode: () => false,
        isInteractive: () => false,
        getApprovalMode: () => ApprovalMode.DEFAULT,

        getAllowedTools: () => [],
        getContentGeneratorConfig: () => ({ model: 'test-model' }),
        getEnableHooks: () => false,
        getModel: () => 'gemini-2.5-pro',
      },
      policyDecision,
    );

    const scheduler = new CoreToolScheduler({
      telemetry: settingsOwner.telemetry,
      readExecutionPolicy: () => settingsOwner.readToolExecutionPolicy(),
      getToolGovernance: () =>
        settingsOwner.readToolGovernance(mockConfig.getExcludeTools() ?? []),
      config: mockConfig,
      messageBus: runtimeMessageBus,
      toolRegistry: mockToolRegistry,
      onAllToolCallsComplete,
      onToolCallsUpdate,
      getPreferredEditor: () => 'vscode',
      onEditorClose: () => {},
    });

    const request = {
      callId: 'non-interactive-confirm',
      name: 'confirmTool',
      args: {},
      isClientInitiated: false,
      prompt_id: 'prompt-1',
    };

    // ACT
    await scheduler.schedule([request], new AbortController().signal);

    // ASSERT
    expect(onAllToolCallsComplete).toHaveBeenCalled();
    const completedCalls = onAllToolCallsComplete.mock
      .calls[0][0] as ToolCall[];
    expect(completedCalls).toHaveLength(1);
    expect(completedCalls[0].status).toBe('error');

    const erroredCall = completedCalls[0] as ErroredToolCall;
    const errorResponse = erroredCall.response;
    const errorParts = errorResponse.responseParts;
    const errorMessage = (errorParts[0] as { result?: { error?: string } })
      .result?.error;
    expect(errorMessage).toContain(
      'Tool execution for "confirmTool" requires user confirmation, which is not supported in non-interactive mode.',
    );
  });

  it('should not error in non-interactive mode with YOLO approval', async () => {
    // ARRANGE
    const mockTool = new MockTool({ name: 'yoloTool' });
    mockTool.shouldConfirm = true;

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

    const onAllToolCallsComplete = vi.fn();
    const onToolCallsUpdate = vi.fn();

    let policyDecision = PolicyDecision.ALLOW;
    policyDecision = PolicyDecision.ASK_USER;

    const {
      config: mockConfig,
      settingsOwner,
      messageBus: runtimeMessageBus,
    } = createSchedulerPolicyFixture(
      {
        getSessionId: () => 'test-session-id',
        getUsageStatisticsEnabled: () => true,
        getDebugMode: () => false,
        isInteractive: () => false,
        getApprovalMode: () => ApprovalMode.YOLO,

        getAllowedTools: () => [],
        getContentGeneratorConfig: () => ({ model: 'test-model' }),
        getEnableHooks: () => false,
        getModel: () => 'gemini-2.5-pro',
      },
      policyDecision,
    );

    const scheduler = new CoreToolScheduler({
      telemetry: settingsOwner.telemetry,
      readExecutionPolicy: () => settingsOwner.readToolExecutionPolicy(),
      getToolGovernance: () =>
        settingsOwner.readToolGovernance(mockConfig.getExcludeTools() ?? []),
      config: mockConfig,
      messageBus: runtimeMessageBus,
      toolRegistry: mockToolRegistry,
      onAllToolCallsComplete,
      onToolCallsUpdate,
      getPreferredEditor: () => 'vscode',
      onEditorClose: () => {},
    });

    // ACT
    await scheduler.schedule(
      [
        {
          callId: 'yolo-1',
          name: 'yoloTool',
          args: {},
          isClientInitiated: false,
          prompt_id: 'prompt-1',
        },
      ],
      new AbortController().signal,
    );

    // ASSERT
    expect(onAllToolCallsComplete).toHaveBeenCalled();
    const completedCalls = onAllToolCallsComplete.mock
      .calls[0][0] as ToolCall[];
    expect(completedCalls[0].status).toBe('success'); // Not error
  });

  it('should not error in non-interactive mode for allowed tools', async () => {
    // ARRANGE
    const mockTool = new MockTool({ name: 'allowedTool' });
    mockTool.shouldConfirm = true;

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

    const onAllToolCallsComplete = vi.fn();
    const onToolCallsUpdate = vi.fn();

    let policyDecision = PolicyDecision.ALLOW;
    policyDecision = PolicyDecision.ASK_USER;

    const {
      config: mockConfig,
      settingsOwner,
      messageBus: runtimeMessageBus,
    } = createSchedulerPolicyFixture(
      {
        getSessionId: () => 'test-session-id',
        getUsageStatisticsEnabled: () => true,
        getDebugMode: () => false,
        isInteractive: () => false,
        getApprovalMode: () => ApprovalMode.DEFAULT,

        getAllowedTools: () => ['allowedTool'],
        getContentGeneratorConfig: () => ({ model: 'test-model' }),
        getEnableHooks: () => false,
        getModel: () => 'gemini-2.5-pro',
      },
      policyDecision,
    );

    const scheduler = new CoreToolScheduler({
      telemetry: settingsOwner.telemetry,
      readExecutionPolicy: () => settingsOwner.readToolExecutionPolicy(),
      getToolGovernance: () =>
        settingsOwner.readToolGovernance(mockConfig.getExcludeTools() ?? []),
      config: mockConfig,
      messageBus: runtimeMessageBus,
      toolRegistry: mockToolRegistry,
      onAllToolCallsComplete,
      onToolCallsUpdate,
      getPreferredEditor: () => 'vscode',
      onEditorClose: () => {},
    });

    // ACT
    await scheduler.schedule(
      [
        {
          callId: 'allowed-1',
          name: 'allowedTool',
          args: {},
          isClientInitiated: false,
          prompt_id: 'prompt-1',
        },
      ],
      new AbortController().signal,
    );

    // ASSERT
    expect(onAllToolCallsComplete).toHaveBeenCalled();
    const completedCalls = onAllToolCallsComplete.mock
      .calls[0][0] as ToolCall[];
    expect(completedCalls[0].status).toBe('success'); // Not error
  });

  it('should handle mixed batch: safe tool executes, dangerous tool errors in non-interactive', async () => {
    // ARRANGE
    const safeTool = new MockTool({ name: 'safeTool' });
    safeTool.shouldConfirm = false; // No confirmation needed

    const dangerousTool = new MockTool({ name: 'dangerousTool' });
    dangerousTool.shouldConfirm = true; // Requires confirmation

    const mockToolRegistry = {
      getTool: (name: string) =>
        name === 'safeTool' ? safeTool : dangerousTool,
      getFunctionDeclarations: () => [],
      tools: new Map([
        ['safeTool', safeTool],
        ['dangerousTool', dangerousTool],
      ]),
      discovery: {},
      registerTool: () => {},
      getToolByName: (name: string) =>
        name === 'safeTool' ? safeTool : dangerousTool,
      getToolByDisplayName: (name: string) =>
        name === 'safeTool' ? safeTool : dangerousTool,
      getTools: () => [safeTool, dangerousTool],
      discoverTools: async () => {},
      getAllTools: () => [safeTool, dangerousTool],
      getToolsByServer: () => [],
    } as unknown as ToolRegistry;

    const onAllToolCallsComplete = vi.fn();
    const onToolCallsUpdate = vi.fn();

    let policyDecision = PolicyDecision.ALLOW;
    policyDecision = PolicyDecision.ASK_USER;

    const {
      config: mockConfig,
      settingsOwner,
      messageBus: runtimeMessageBus,
    } = createSchedulerPolicyFixture(
      {
        getSessionId: () => 'test-session-id',
        getUsageStatisticsEnabled: () => true,
        getDebugMode: () => false,
        isInteractive: () => false,
        getApprovalMode: () => ApprovalMode.DEFAULT,

        getAllowedTools: () => [],
        getContentGeneratorConfig: () => ({ model: 'test-model' }),
        getEnableHooks: () => false,
        getModel: () => 'gemini-2.5-pro',
      },
      policyDecision,
    );

    const scheduler = new CoreToolScheduler({
      telemetry: settingsOwner.telemetry,
      readExecutionPolicy: () => settingsOwner.readToolExecutionPolicy(),
      getToolGovernance: () =>
        settingsOwner.readToolGovernance(mockConfig.getExcludeTools() ?? []),
      config: mockConfig,
      messageBus: runtimeMessageBus,
      toolRegistry: mockToolRegistry,
      onAllToolCallsComplete,
      onToolCallsUpdate,
      getPreferredEditor: () => 'vscode',
      onEditorClose: () => {},
    });

    // ACT - Schedule both tools in a batch
    await scheduler.schedule(
      [
        {
          callId: 'safe-call',
          name: 'safeTool',
          args: {},
          isClientInitiated: false,
          prompt_id: 'prompt-1',
        },
        {
          callId: 'dangerous-call',
          name: 'dangerousTool',
          args: {},
          isClientInitiated: false,
          prompt_id: 'prompt-1',
        },
      ],
      new AbortController().signal,
    );

    // ASSERT
    expect(onAllToolCallsComplete).toHaveBeenCalled();
    const completedCalls = onAllToolCallsComplete.mock
      .calls[0][0] as ToolCall[];
    expect(completedCalls).toHaveLength(2);

    const safeCall = completedCalls.find(
      (c) => c.request.callId === 'safe-call',
    );
    const dangerousCall = completedCalls.find(
      (c) => c.request.callId === 'dangerous-call',
    );

    expect(safeCall?.status).toBe('success');
    expect(dangerousCall?.status).toBe('error');

    const erroredCall = dangerousCall as ErroredToolCall;
    const errorParts = erroredCall.response.responseParts;
    const errorMessage = (errorParts[0] as { result?: { error?: string } })
      .result?.error;
    expect(errorMessage).toContain('requires user confirmation');
    expect(errorMessage).toContain('non-interactive mode');
  });
});
