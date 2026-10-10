/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CompletedToolCall } from './coreToolScheduler.js';
import { createSchedulerPolicyFixture } from './__tests__/scheduler-policy-fixture.js';

import { waitFor } from '@vybestack/llxprt-code-test-utils';
import { describe, it, expect, vi } from 'bun:test';
import type { ToolCall, WaitingToolCall } from './coreToolScheduler.js';
import { CoreToolScheduler } from './coreToolScheduler.js';

import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools/types/tool-confirmation-types.js';
import { MockTool } from '@vybestack/llxprt-code-test-utils/core/mock-tool.js';
import { PolicyDecision } from '@vybestack/llxprt-code-core/policy/types.js';
import {
  MessageBusType,
  type ToolConfirmationResponse,
} from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import { ToolErrorType } from '@vybestack/llxprt-code-tools/types/tool-error.js';

describe('CoreToolScheduler policy decisions', () => {
  it('should reject tool execution when policy denies it', async () => {
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
    policyDecision = PolicyDecision.DENY;

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
          callId: 'deny-1',
          name: 'mockTool',
          args: {},
          isClientInitiated: false,
          prompt_id: 'prompt-deny',
        },
      ],
      new AbortController().signal,
    );

    expect(onAllToolCallsComplete).toHaveBeenCalled();
    const completedCallsDeny = onAllToolCallsComplete.mock
      .calls[0][0] as CompletedToolCall[];
    expect(completedCallsDeny[0].status).toBe('error');
    expect(completedCallsDeny[0].response.errorType).toBe(
      ToolErrorType.POLICY_VIOLATION,
    );
    expect(runtimeMessageBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageBusType.TOOL_POLICY_REJECTION,
      }),
    );
  });

  it('should publish confirmation requests when policy asks the user', async () => {
    const {
      waitingCall,
      mockMessageBus: runtimeMessageBus,
      correlationId,
      busHandler,
      completionCallCount,
      completedStatus,
    } = await observePublishConfirmationRequestsWhenPolicyAsksTheUser();
    expect(completionCallCount).toBeGreaterThan(0);
    expect(completedStatus).toBe('success');
    expect(waitingCall.status).toBe('awaiting_approval');
    if (!('correlationId' in waitingCall.confirmationDetails))
      throw new Error('Expected correlation');
    expect(waitingCall.confirmationDetails.correlationId).toBeDefined();
    expect(runtimeMessageBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageBusType.TOOL_CONFIRMATION_REQUEST,
        correlationId,
      }),
    );
    expect(busHandler).toBeDefined();
  });

  const observePublishConfirmationRequestsWhenPolicyAsksTheUser = async () => {
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
        getDebugMode: () => true,
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

    const busHandler = (message: ToolConfirmationResponse) =>
      runtimeMessageBus.publish(message);
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
          callId: 'ask-1',
          name: 'mockTool',
          args: {},
          isClientInitiated: false,
          prompt_id: 'prompt-ask',
        },
      ],
      new AbortController().signal,
    );

    const latestUpdate = onToolCallsUpdate.mock.calls.at(-1)?.[0] as ToolCall[];
    const waitingCall = latestUpdate[0] as WaitingToolCall;

    if (!('correlationId' in waitingCall.confirmationDetails))
      throw new Error('Expected correlation');
    const correlationId = waitingCall.confirmationDetails
      .correlationId as string;

    busHandler({
      type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
      correlationId,
      outcome: ToolConfirmationOutcome.ProceedOnce,
    });

    await waitFor(() => {
      const completedCalls = onAllToolCallsComplete.mock.calls.at(-1)?.[0] as
        | ToolCall[]
        | undefined;
      if (completedCalls?.[0]?.status !== 'success') {
        throw new Error('Waiting for the tool call to succeed');
      }
    });
    const completionCallCount = onAllToolCallsComplete.mock.calls.length;
    const completedStatus =
      onAllToolCallsComplete.mock.calls.at(-1)?.[0]?.[0]?.status;

    return {
      waitingCall,
      mockMessageBus: runtimeMessageBus,
      correlationId,
      busHandler,
      completionCallCount,
      completedStatus,
    };
  };
});
