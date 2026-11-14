/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import {
  MessageBusType,
  type ToolConfirmationRequest,
} from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import type { ToolCall } from '@vybestack/llxprt-code-core/scheduler/types.js';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import { MockTool } from '@vybestack/llxprt-code-test-utils/core/mock-tool.js';
import { CoreToolScheduler } from './coreToolScheduler.js';
import { createSchedulerPolicyFixture } from './__tests__/scheduler-policy-fixture.js';
import { createToolRegistryForTest } from './agenticLoop/__tests__/agenticLoop-test-helpers.js';
import { PolicyDecision } from '@vybestack/llxprt-code-core/policy/types.js';

describe('approval request publication ordering', () => {
  it('exposes the waiting status before an approval bus subscriber can respond', async () => {
    const { config, settingsOwner, messageBus } = createSchedulerPolicyFixture(
      {
        isInteractive: () => true,
        getApprovalMode: () => ApprovalMode.DEFAULT,
      },
      PolicyDecision.ASK_USER,
    );
    const tool = new MockTool({
      name: 'lookup',
      shouldConfirmExecute: async () => ({
        type: 'exec',
        title: 'Lookup',
        command: 'lookup',
        rootCommand: 'lookup',
        rootCommands: ['lookup'],
        onConfirm: async () => {},
      }),
    });
    let calls: ToolCall[] = [];
    const observed: Array<ToolCall['status'] | undefined> = [];
    const stop = messageBus.subscribe<ToolConfirmationRequest>(
      MessageBusType.TOOL_CONFIRMATION_REQUEST,
      (request) => {
        observed.push(
          calls.find((call) => call.request.callId === request.toolCall.id)
            ?.status,
        );
        messageBus.publish({
          type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
          correlationId: request.correlationId,
          confirmed: false,
          outcome: ToolConfirmationOutcome.Cancel,
        });
      },
    );
    const scheduler = new CoreToolScheduler({
      config,
      messageBus,
      telemetry: settingsOwner.telemetry,
      readExecutionPolicy: () => settingsOwner.readToolExecutionPolicy(),
      getToolGovernance: () => settingsOwner.readToolGovernance([]),
      toolRegistry: createToolRegistryForTest([tool]),
      onToolCallsUpdate: (updated) => {
        calls = updated;
      },
      getPreferredEditor: () => undefined,
      onEditorClose: () => {},
    });
    try {
      await scheduler.schedule(
        {
          callId: 'approval-order',
          name: 'lookup',
          args: { param: 'query' },
          isClientInitiated: false,
          prompt_id: 'approval-order',
        },
        new AbortController().signal,
      );
      expect(observed).toStrictEqual(['awaiting_approval']);
    } finally {
      stop();
      await scheduler.cancelAll();
      await config.dispose();
    }
  });
});
