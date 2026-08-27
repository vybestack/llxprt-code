/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { waitFor } from '@vybestack/llxprt-code-test-utils';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { PolicyEngine } from '@vybestack/llxprt-code-core/policy/policy-engine.js';
import {
  PolicyDecision,
  type PolicyEngineConfig,
} from '@vybestack/llxprt-code-core/policy/types.js';
import { CoreMessageBusAdapter } from '@vybestack/llxprt-code-core/tools-adapters/CoreMessageBusAdapter.js';
import { MockTool } from '@vybestack/llxprt-code-core/test-utils/mock-tool.js';
import { ToolRegistry } from '@vybestack/llxprt-code-tools/tools/tool-registry.js';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools/types/tool-confirmation-types.js';
import { ToolErrorType } from '@vybestack/llxprt-code-tools/types/tool-error.js';
import type { ToolCallRequestInfo } from '@vybestack/llxprt-code-core/core/turn.js';
import type {
  CompletedToolCall,
  ToolCall,
  WaitingToolCall,
} from './coreToolScheduler.js';
import { CoreToolScheduler } from './coreToolScheduler.js';
import { createMockConfig } from './coreToolScheduler-test-helpers.js';

interface SchedulerHarness {
  readonly scheduler: CoreToolScheduler;
  readonly latestCalls: () => readonly ToolCall[];
  readonly completedCalls: () => readonly CompletedToolCall[];
}

function createHarness(defaultDecision: PolicyDecision): SchedulerHarness {
  const policyConfig: PolicyEngineConfig = {
    rules: [],
    defaultDecision,
    nonInteractive: false,
  };
  const policyEngine = new PolicyEngine(policyConfig);
  policyEngine.setApprovalMode(ApprovalMode.DEFAULT);
  const messageBus = new MessageBus(policyEngine, false);
  const messageBusAdapter = new CoreMessageBusAdapter(messageBus);
  const toolRegistry = new ToolRegistry(
    {
      getEphemeralSettings: (): Record<string, unknown> => ({}),
      getCoreTools: (): string[] => [],
      getExcludeTools: (): string[] => [],
    },
    messageBusAdapter,
  );
  const tool = new MockTool({
    name: 'approval_tool',
    messageBus: messageBusAdapter,
  });
  tool.shouldConfirm = true;
  toolRegistry.registerTool(tool);

  let latestCalls: readonly ToolCall[] = [];
  let completedCalls: readonly CompletedToolCall[] = [];
  const config = createMockConfig({
    getSessionId: (): string => `denial-transition-${defaultDecision}`,
    getApprovalMode: (): ApprovalMode => ApprovalMode.DEFAULT,
    isInteractive: (): boolean => true,
    getToolRegistry: (): ToolRegistry => toolRegistry,
    getPolicyEngine: (): PolicyEngine => policyEngine,
  });
  const scheduler = new CoreToolScheduler({
    config,
    messageBus,
    toolRegistry,
    onToolCallsUpdate: (calls): void => {
      latestCalls = calls;
    },
    onAllToolCallsComplete: async (calls): Promise<void> => {
      completedCalls = calls;
    },
    getPreferredEditor: () => undefined,
    onEditorClose: (): void => {},
  });

  return {
    scheduler,
    latestCalls: (): readonly ToolCall[] => latestCalls,
    completedCalls: (): readonly CompletedToolCall[] => completedCalls,
  };
}

function createRequest(callId: string): ToolCallRequestInfo {
  return {
    callId,
    name: 'approval_tool',
    args: {},
    isClientInitiated: false,
    prompt_id: `prompt-${callId}`,
  };
}

function requireWaitingCall(calls: readonly ToolCall[]): WaitingToolCall {
  const waitingCall = calls.find(
    (call): call is WaitingToolCall => call.status === 'awaiting_approval',
  );
  if (waitingCall === undefined) {
    throw new Error('Expected a tool call awaiting approval');
  }
  return waitingCall;
}

function requireCompletedCall(
  calls: readonly CompletedToolCall[],
): CompletedToolCall {
  for (const call of calls) {
    return call;
  }
  throw new Error('Expected a completed tool call');
}

async function cancelWaitingCall(call: WaitingToolCall): Promise<void> {
  const details = call.confirmationDetails;
  if (!('onConfirm' in details) || typeof details.onConfirm !== 'function') {
    throw new Error('Expected interactive confirmation details');
  }

  await details.onConfirm(ToolConfirmationOutcome.Cancel);
}

function requireToolResponseError(call: CompletedToolCall): string {
  const responsePart = call.response.responseParts.find(
    (part) => 'type' in part && part.type === 'tool_response',
  );
  if (responsePart === undefined || !('result' in responsePart)) {
    throw new Error('Expected a tool response result');
  }
  const result: unknown = responsePart.result;
  if (
    result === null ||
    typeof result !== 'object' ||
    !Reflect.has(result, 'error')
  ) {
    throw new Error('Expected a tool response error');
  }
  const error: unknown = Reflect.get(result, 'error');
  if (typeof error !== 'string') {
    throw new Error('Expected a string tool response error');
  }
  return error;
}

describe('CoreToolScheduler denial transitions', () => {
  it('distinguishes policy denial from user cancellation in terminal results', async (): Promise<void> => {
    const policyDenied = createHarness(PolicyDecision.DENY);
    const userDenied = createHarness(PolicyDecision.ASK_USER);

    try {
      await policyDenied.scheduler.schedule(
        createRequest('policy-denied'),
        new AbortController().signal,
      );
      await waitFor((): void => {
        expect(policyDenied.completedCalls()).toHaveLength(1);
      });

      await userDenied.scheduler.schedule(
        createRequest('user-denied'),
        new AbortController().signal,
      );
      const waitingCall = requireWaitingCall(userDenied.latestCalls());
      await cancelWaitingCall(waitingCall);
      await waitFor((): void => {
        expect(userDenied.completedCalls()).toHaveLength(1);
      });

      const policyDeniedCall = requireCompletedCall(
        policyDenied.completedCalls(),
      );
      const userDeniedCall = requireCompletedCall(userDenied.completedCalls());

      expect(policyDeniedCall.status).toBe('error');
      expect(policyDeniedCall.response.errorType).toBe(
        ToolErrorType.POLICY_VIOLATION,
      );
      expect(userDeniedCall.status).toBe('cancelled');
      expect(userDeniedCall.response.errorType).toBeUndefined();
      expect(requireToolResponseError(userDeniedCall)).toContain(
        'User did not allow tool call',
      );
    } finally {
      policyDenied.scheduler.dispose();
      userDenied.scheduler.dispose();
    }
  });
});
