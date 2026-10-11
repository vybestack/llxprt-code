/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createSchedulerPolicyFixture } from './__tests__/scheduler-policy-fixture.js';

import { describe, it, expect, vi } from 'bun:test';
import type { ToolCall } from './coreToolScheduler.js';
import { CoreToolScheduler } from './coreToolScheduler.js';

import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import { MockTool } from '@vybestack/llxprt-code-test-utils/core/mock-tool.js';
import { PolicyDecision } from '@vybestack/llxprt-code-core/policy/types.js';
import { MessageBusType } from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import { createMockMessageBus } from './__tests__/coreToolScheduler-test-helpers.js';

describe('CoreToolScheduler confirmation and policy', () => {
  it('should cancel a tool call if the signal is aborted before confirmation', async () => {
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
        isInteractive: () => true,
        getApprovalMode: () => ApprovalMode.DEFAULT,

        getAllowedTools: () => [],
        getContentGeneratorConfig: () => ({
          model: 'test-model',
        }),
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
      onEditorClose: vi.fn(),
    });

    const abortController = new AbortController();
    const request = {
      callId: '1',
      name: 'mockTool',
      args: {},
      isClientInitiated: false,
      prompt_id: 'prompt-id-1',
    };

    abortController.abort();
    await scheduler.schedule([request], abortController.signal);

    expect(onAllToolCallsComplete).toHaveBeenCalled();
    const completedCalls = onAllToolCallsComplete.mock
      .calls[0][0] as ToolCall[];
    expect(completedCalls[0].status).toBe('cancelled');
  });

  it('should skip confirmation when policy allows execution', async () => {
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
    let policyDecision = PolicyDecision.ALLOW;
    policyDecision = PolicyDecision.ALLOW;

    const {
      config: mockConfig,
      settingsOwner,
      messageBus: runtimeMessageBus,
    } = createSchedulerPolicyFixture(
      {
        getSessionId: () => 'test-session-id',
        getUsageStatisticsEnabled: () => true,
        getDebugMode: () => false,
        isInteractive: () => true,
        getApprovalMode: () => ApprovalMode.DEFAULT,

        getAllowedTools: () => [],
        getContentGeneratorConfig: () => ({
          model: 'test-model',
        }),
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
      onEditorClose: vi.fn(),
    });

    await scheduler.schedule(
      [
        {
          callId: 'allow-1',
          name: 'mockTool',
          args: {},
          isClientInitiated: false,
          prompt_id: 'prompt-allow',
        },
      ],
      new AbortController().signal,
    );

    expect(
      onToolCallsUpdate.mock.calls
        .flatMap(([calls]) => calls)
        .some((call: ToolCall) => call.status === 'awaiting_approval'),
    ).toBe(false);
    expect(onAllToolCallsComplete).toHaveBeenCalled();
    const completedCallsAllow = onAllToolCallsComplete.mock
      .calls[0][0] as ToolCall[];
    expect(completedCallsAllow[0].status).toBe('success');
    expect(mockMessageBus.publish).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageBusType.TOOL_CONFIRMATION_REQUEST,
      }),
    );
  });
});
