/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createSchedulerPolicyFixture } from './__tests__/scheduler-policy-fixture.js';

import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';

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
import {
  AbortDuringConfirmationTool,
  createMockMessageBus,
} from './__tests__/coreToolScheduler-test-helpers.js';

describe('CoreToolScheduler suggest edit and abort', () => {
  it('should publish suggest edit response as not confirmed and execute with edited command', async () => {
    const executeFn = vi.fn().mockResolvedValue({
      llmContent: 'Shell command executed',
      returnDisplay: 'Shell command executed',
    });

    const mockShellTool = new MockTool({
      name: 'run_shell_command',
      shouldConfirmExecute: (params) =>
        Promise.resolve({
          type: 'exec',
          title: 'Confirm Shell Command',
          command: String(params['command'] ?? ''),
          rootCommand: 'npm',
          rootCommands: ['npm'],
          onConfirm: async () => {},
        }),
      execute: (params) => executeFn(params),
    });

    const mockToolRegistry = {
      getTool: () => mockShellTool,
      getFunctionDeclarations: () => [],
      tools: new Map(),
      discovery: {},
      registerTool: () => {},
      getToolByName: () => mockShellTool,
      getToolByDisplayName: () => mockShellTool,
      getTools: () => [],
      discoverTools: async () => {},
      getAllTools: () => [],
      getToolsByServer: () => [],
    } as unknown as ToolRegistry;

    const onAllToolCallsComplete = vi.fn();
    const onToolCallsUpdate = vi.fn();

    const mockMessageBus = Object.assign(
      new MessageBus(),
      createMockMessageBus(),
    );
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
        getShellExecutionConfig: () => ({
          terminalWidth: 80,
          terminalHeight: 24,
        }),
        getModel: () => 'gemini-2.5-pro',
      },
      policyDecision,
    );

    const busHandler = (message: ToolConfirmationResponse): void =>
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
          callId: 'ask-suggest-1',
          name: 'run_shell_command',
          args: { command: 'npm instal' },
          isClientInitiated: false,
          prompt_id: 'prompt-ask-suggest',
        },
      ],
      new AbortController().signal,
    );

    const latestUpdate = onToolCallsUpdate.mock.calls[
      onToolCallsUpdate.mock.calls.length - 1
    ]?.[0] as ToolCall[];
    const waitingCall = latestUpdate[0] as WaitingToolCall;
    expect(waitingCall.status).toBe('awaiting_approval');
    if (!('correlationId' in waitingCall.confirmationDetails))
      throw new Error('Missing confirmation correlation');
    expect(waitingCall.confirmationDetails.correlationId).toBeDefined();
    const correlationId = waitingCall.confirmationDetails
      .correlationId as string;

    expect(waitingCall.status).toBe('awaiting_approval');
    busHandler({
      type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
      correlationId,
      outcome: ToolConfirmationOutcome.SuggestEdit,
      payload: {
        editedCommand: 'npm install',
      },
    });

    await waitFor(() => {
      expect(onAllToolCallsComplete).toHaveBeenCalled();
      const completedCallsAsk = onAllToolCallsComplete.mock.calls[
        onAllToolCallsComplete.mock.calls.length - 1
      ]?.[0] as ToolCall[];
      expect(completedCallsAsk[0]?.status).toBe('success');
    });

    expect(executeFn).toHaveBeenCalledWith({ command: 'npm install' });

    const messageBusResponses = mockMessageBus.publish.mock.calls
      .map((call) => call[0])
      .filter(
        (message) => message.type === MessageBusType.TOOL_CONFIRMATION_RESPONSE,
      );

    expect(messageBusResponses).toHaveLength(0);
  });

  it('should mark tool call as cancelled when abort happens during confirmation error', async () => {
    const abortController = new AbortController();
    const abortError = new Error('Abort requested during confirmation');
    const declarativeTool = new AbortDuringConfirmationTool(
      abortController,
      abortError,
    );

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
        getShellExecutionConfig: () => ({
          terminalWidth: 90,
          terminalHeight: 30,
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

    const request = {
      callId: 'abort-1',
      name: 'abortDuringConfirmationTool',
      args: {},
      isClientInitiated: false,
      prompt_id: 'prompt-id-abort',
    };

    await scheduler.schedule([request], abortController.signal);

    expect(onAllToolCallsComplete).toHaveBeenCalled();
    const completedCalls = onAllToolCallsComplete.mock
      .calls[0][0] as ToolCall[];
    expect(completedCalls[0].status).toBe('cancelled');
    const statuses = onToolCallsUpdate.mock.calls.flatMap((call) =>
      (call[0] as ToolCall[]).map((toolCall) => toolCall.status),
    );
    expect(statuses).not.toContain('error');
  });
});
