/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createSchedulerPolicyFixture } from './__tests__/scheduler-policy-fixture.js';

import { waitFor } from '@vybestack/llxprt-code-test-utils';
import { describe, it, expect, vi } from 'bun:test';
import type { ToolCall, WaitingToolCall } from './coreToolScheduler.js';
import { CoreToolScheduler } from './coreToolScheduler.js';

import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools/types/tool-confirmation-types.js';
import { type ToolConfirmationPayload } from '@vybestack/llxprt-code-tools';
import { MockModifiableTool } from '@vybestack/llxprt-code-test-utils/core/tools.js';
import { MockTool } from '@vybestack/llxprt-code-test-utils/core/mock-tool.js';
import { PolicyDecision } from '@vybestack/llxprt-code-core/policy/types.js';
import { waitForStatus } from './__tests__/coreToolScheduler-test-helpers.js';

describe('CoreToolScheduler with payload', () => {
  it('should update args and diff and execute tool when payload is provided', async () => {
    const mockTool = new MockModifiableTool();
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
      name: 'mockModifiableTool',
      args: {},
      isClientInitiated: false,
      prompt_id: 'prompt-id-2',
    };

    await scheduler.schedule([request], abortController.signal);

    const awaitingCall = (await waitForStatus(
      onToolCallsUpdate,
      'awaiting_approval',
    )) as WaitingToolCall;
    const confirmationDetails = awaitingCall.confirmationDetails;

    expect(confirmationDetails).toBeDefined();
    const payload: ToolConfirmationPayload = { newContent: 'final version' };
    if (!('onConfirm' in confirmationDetails))
      throw new Error('Missing scheduler confirmation callback');
    await confirmationDetails.onConfirm(
      ToolConfirmationOutcome.ProceedOnce,
      payload,
    );

    await waitFor(() => {
      expect(onAllToolCallsComplete).toHaveBeenCalled();
    });
    const completedCalls = onAllToolCallsComplete.mock
      .calls[0][0] as ToolCall[];
    expect(completedCalls[0].status).toBe('success');
    const executeCall =
      mockTool.executeFn.mock.calls[mockTool.executeFn.mock.calls.length - 1];
    expect(executeCall[0]).toStrictEqual({ newContent: 'final version' });
    expect(executeCall[1]).toBeInstanceOf(AbortSignal);
  });

  it('should update shell command args and execute when suggest edit payload is provided', async () => {
    const executeFn = vi.fn().mockResolvedValue({
      llmContent: 'Shell command executed',
      returnDisplay: 'Shell command executed',
    });

    const originalOnConfirm = vi.fn(
      async (
        _outcome: ToolConfirmationOutcome,
        _payload?: ToolConfirmationPayload,
      ) => {},
    );

    const mockShellTool = new MockTool({
      name: 'run_shell_command',
      shouldConfirmExecute: (params) =>
        Promise.resolve({
          type: 'exec',
          title: 'Confirm Shell Command',
          command: String(params['command'] ?? ''),
          rootCommand: 'npm',
          rootCommands: ['npm'],
          onConfirm: originalOnConfirm,
        }),
      execute: (params) => executeFn(params),
    });

    const toolRegistry = {
      getTool: () => mockShellTool,
      getToolByName: () => mockShellTool,
      getFunctionDeclarations: () => [],
      tools: new Map(),
      discovery: {},
      registerTool: () => {},
      getToolByDisplayName: () => mockShellTool,
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
        getModel: () => 'gemini-2.5-pro',
        getShellExecutionConfig: () => ({
          terminalWidth: 80,
          terminalHeight: 24,
        }),
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
      toolRegistry,
      onAllToolCallsComplete,
      onToolCallsUpdate,
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    const abortController = new AbortController();
    const request = {
      callId: 'shell-suggest-edit',
      name: 'run_shell_command',
      args: { command: 'npm instal' },
      isClientInitiated: false,
      prompt_id: 'prompt-shell-suggest-edit',
    };

    await scheduler.schedule([request], abortController.signal);

    const awaitingCall = (await waitForStatus(
      onToolCallsUpdate,
      'awaiting_approval',
    )) as WaitingToolCall;

    expect(awaitingCall.confirmationDetails).toBeDefined();

    const payload: ToolConfirmationPayload = {
      editedCommand: 'npm install',
    };

    if (!('onConfirm' in awaitingCall.confirmationDetails))
      throw new Error('Missing live confirmation callback');
    await awaitingCall.confirmationDetails.onConfirm(
      ToolConfirmationOutcome.SuggestEdit,
      payload,
    );

    await waitFor(() => {
      expect(onAllToolCallsComplete).toHaveBeenCalled();
    });

    expect(originalOnConfirm).toHaveBeenCalledWith(
      ToolConfirmationOutcome.SuggestEdit,
      payload,
    );

    const executeCall = executeFn.mock.calls[executeFn.mock.calls.length - 1];
    expect(executeCall[0]).toStrictEqual({ command: 'npm install' });
  });
});
