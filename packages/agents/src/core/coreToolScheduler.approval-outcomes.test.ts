/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'bun:test';
import type { ToolCall } from './coreToolScheduler.js';
import { CoreToolScheduler } from './coreToolScheduler.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import { MockTool } from '@vybestack/llxprt-code-core/test-utils/mock-tool.js';
import { PolicyDecision } from '@vybestack/llxprt-code-core/policy/types.js';
import { ToolErrorType } from '@vybestack/llxprt-code-tools/types/tool-error.js';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools/types/tool-confirmation-types.js';
import { MessageBusType } from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import type { ToolConfirmationResponse } from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import type { DeclarativeTool, ToolResult } from '@vybestack/llxprt-code-tools';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { waitFor } from '@vybestack/llxprt-code-test-utils';
import {
  createMockConfig,
  createMockMessageBus,
  createMockPolicyEngine,
} from './coreToolScheduler-test-helpers.js';

function makeRegistry(
  tools: Array<DeclarativeTool<Record<string, unknown>, ToolResult>>,
): ToolRegistry {
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  return {
    getTool: (name: string) => toolsByName.get(name),
    getFunctionDeclarations: () => [],
    tools: new Map(),
    discovery: {},
    registerTool: () => {},
    getToolByName: (name: string) => toolsByName.get(name),
    getToolByDisplayName: (name: string) => toolsByName.get(name),
    getTools: () => [],
    discoverTools: async () => {},
    getAllTools: () => tools,
    getToolsByServer: () => [],
  } as unknown as ToolRegistry;
}

function makeConfig(
  policyDecision: PolicyDecision,
  toolRegistry: ToolRegistry,
  messageBus: ReturnType<typeof createMockMessageBus>,
): Config {
  const mockPolicyEngine = createMockPolicyEngine();
  mockPolicyEngine.evaluate = vi.fn().mockReturnValue(policyDecision);
  return createMockConfig({
    isInteractive: () => true,
    getApprovalMode: () => ApprovalMode.DEFAULT,
    getToolRegistry: () => toolRegistry,
    getMessageBus: () => messageBus,
    getPolicyEngine: () =>
      mockPolicyEngine as unknown as ReturnType<Config['getPolicyEngine']>,
  } as Partial<Config>);
}

function makeScheduler(
  policyDecision: PolicyDecision,
  toolRegistry: ToolRegistry,
  messageBus: ReturnType<typeof createMockMessageBus> = createMockMessageBus(),
) {
  const onAllToolCallsComplete = vi.fn();
  const onToolCallsUpdate = vi.fn<(calls: ToolCall[]) => void>();
  const scheduler = new CoreToolScheduler({
    config: makeConfig(policyDecision, toolRegistry, messageBus),
    messageBus: messageBus as unknown as MessageBus,
    toolRegistry,
    onAllToolCallsComplete,
    onToolCallsUpdate,
    getPreferredEditor: () => 'vscode',
    onEditorClose: vi.fn(),
  });
  return { scheduler, onAllToolCallsComplete, onToolCallsUpdate, messageBus };
}

function gatedTool(
  name: string,
  allowed: Set<string>,
  executed: string[],
): MockTool {
  return new MockTool({
    name,
    shouldConfirmExecute: async () => {
      if (allowed.has(name)) {
        return false;
      }
      return {
        type: 'exec',
        title: `Confirm ${name}`,
        command: name,
        rootCommand: name,
        rootCommands: [name],
        onConfirm: async (outcome: ToolConfirmationOutcome) => {
          if (outcome === ToolConfirmationOutcome.ProceedAlways) {
            allowed.add(name);
          }
        },
      };
    },
    execute: async () => {
      executed.push(name);
      return {
        llmContent: `${name} ran`,
        returnDisplay: `${name} ran`,
      };
    },
  });
}

async function waitForCallStatus(
  onToolCallsUpdate: ReturnType<typeof makeScheduler>['onToolCallsUpdate'],
  callId: string,
  status: ToolCall['status'],
): Promise<ToolCall> {
  let matchingCall: ToolCall | undefined;
  await waitFor(() => {
    for (const args of onToolCallsUpdate.mock.calls) {
      const calls = args[0];
      const found = calls.find(
        (call) => call.request.callId === callId && call.status === status,
      );
      if (found) {
        matchingCall = found;
      }
    }
    if (!matchingCall) {
      const calls = onToolCallsUpdate.mock.calls;
      const latest = calls[calls.length - 1]?.[0] as ToolCall[] | undefined;
      throw new Error(
        `Waiting for call "${callId}" to reach "${status}", saw statuses: ${latest
          ?.map((call) => `${call.request.callId}:${call.status}`)
          .join(', ')}`,
      );
    }
  });
  return matchingCall as ToolCall;
}

function latestSnapshot(
  onToolCallsUpdate: ReturnType<typeof makeScheduler>['onToolCallsUpdate'],
): ToolCall[] {
  const calls = onToolCallsUpdate.mock.calls;
  return calls[calls.length - 1]?.[0];
}

async function flushAsyncWork(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await Promise.resolve();
  }
  await new Promise((resolve) => setImmediate(resolve));
}

function recordedStatuses(
  onToolCallsUpdate: ReturnType<typeof makeScheduler>['onToolCallsUpdate'],
  callId: string,
): Array<ToolCall['status']> {
  return onToolCallsUpdate.mock.calls
    .map((args) => args[0])
    .flatMap((calls) =>
      calls
        .filter((call) => call.request.callId === callId)
        .map((call) => call.status),
    );
}

function expectNeverLeaves(
  statuses: Array<ToolCall['status']>,
  status: ToolCall['status'],
): void {
  const first = statuses.indexOf(status);
  expect(first).toBeGreaterThanOrEqual(0);
  expect(statuses.slice(first).every((s) => s === status)).toBe(true);
}

function confirmationRequestCount(
  messageBus: ReturnType<typeof createMockMessageBus>,
): number {
  return messageBus.publish.mock.calls.filter(
    ([message]) =>
      (message as { type?: MessageBusType }).type ===
      MessageBusType.TOOL_CONFIRMATION_REQUEST,
  ).length;
}

async function confirmCall(
  call: ToolCall,
  outcome: ToolConfirmationOutcome,
): Promise<void> {
  await (
    call as {
      confirmationDetails: { onConfirm: (o: unknown) => Promise<void> };
    }
  ).confirmationDetails.onConfirm(outcome);
}

function cancelledReason(call: ToolCall): string {
  const part = (
    call as {
      response?: {
        responseParts?: Array<{ result?: { error?: string } }>;
      };
    }
  ).response?.responseParts?.[0];
  return part?.result?.error ?? '';
}

describe('CoreToolScheduler approval outcomes', () => {
  describe('single-call terminal states', () => {
    it('ProceedOnce resolves to success with exactly one execution', async () => {
      // @plan PLAN-20260824-ISSUE2021.P01 @requirement REQ-2021.1
      const executed: string[] = [];
      const tool = gatedTool('proceedOnceTool', new Set(), executed);
      const { scheduler, onToolCallsUpdate, onAllToolCallsComplete } =
        makeScheduler(PolicyDecision.ASK_USER, makeRegistry([tool]));

      await scheduler.schedule(
        [
          {
            callId: 'call-once',
            name: 'proceedOnceTool',
            args: {},
            isClientInitiated: false,
            prompt_id: 'prompt-1',
          },
        ],
        new AbortController().signal,
      );

      const awaiting = await waitForCallStatus(
        onToolCallsUpdate,
        'call-once',
        'awaiting_approval',
      );
      await confirmCall(awaiting, ToolConfirmationOutcome.ProceedOnce);

      await waitForCallStatus(onToolCallsUpdate, 'call-once', 'success');
      expect(executed).toEqual(['proceedOnceTool']);
      const completedCalls = onAllToolCallsComplete.mock.calls;
      const completed = completedCalls[
        completedCalls.length - 1
      ]?.[0] as ToolCall[];
      expect(
        completed.find((c) => c.request.callId === 'call-once')?.status,
      ).toBe('success');
    });

    it('Cancel resolves to cancelled carrying the user-deny reason', async () => {
      // @plan PLAN-20260824-ISSUE2021.P01 @requirement REQ-2021.1
      const executed: string[] = [];
      const tool = gatedTool('cancelTool', new Set(), executed);
      const { scheduler, onToolCallsUpdate } = makeScheduler(
        PolicyDecision.ASK_USER,
        makeRegistry([tool]),
      );

      await scheduler.schedule(
        [
          {
            callId: 'call-cancel',
            name: 'cancelTool',
            args: {},
            isClientInitiated: false,
            prompt_id: 'prompt-1',
          },
        ],
        new AbortController().signal,
      );

      const awaiting = await waitForCallStatus(
        onToolCallsUpdate,
        'call-cancel',
        'awaiting_approval',
      );
      await confirmCall(awaiting, ToolConfirmationOutcome.Cancel);

      const cancelled = await waitForCallStatus(
        onToolCallsUpdate,
        'call-cancel',
        'cancelled',
      );
      expect(cancelledReason(cancelled)).toContain(
        'User did not allow tool call',
      );
      expect(executed).toEqual([]);
    });

    it('an aborted signal while awaiting resolves to cancelled, never error', async () => {
      // @plan PLAN-20260824-ISSUE2021.P01 @requirement REQ-2021.1
      const executed: string[] = [];
      const tool = gatedTool('abortTool', new Set(), executed);
      const { scheduler, onToolCallsUpdate } = makeScheduler(
        PolicyDecision.ASK_USER,
        makeRegistry([tool]),
      );

      const abortController = new AbortController();
      await scheduler.schedule(
        [
          {
            callId: 'call-abort',
            name: 'abortTool',
            args: {},
            isClientInitiated: false,
            prompt_id: 'prompt-1',
          },
        ],
        abortController.signal,
      );

      const awaiting = await waitForCallStatus(
        onToolCallsUpdate,
        'call-abort',
        'awaiting_approval',
      );
      abortController.abort();
      await confirmCall(awaiting, ToolConfirmationOutcome.ProceedOnce);

      const cancelled = await waitForCallStatus(
        onToolCallsUpdate,
        'call-abort',
        'cancelled',
      );
      expect(cancelled.status).toBe('cancelled');
      expect(executed).toEqual([]);
      const abortStatuses = onToolCallsUpdate.mock.calls
        .map((args) => args[0])
        .flatMap((calls) =>
          calls
            .filter((call) => call.request.callId === 'call-abort')
            .map((call) => call.status),
        );
      expect(abortStatuses).not.toContain('error');
    });

    it('policy denial errors with POLICY_VIOLATION and never prompts for confirmation', async () => {
      // @plan PLAN-20260824-ISSUE2021.P01 @requirement REQ-2021.1
      const executed: string[] = [];
      const tool = gatedTool('deniedTool', new Set(), executed);
      const { scheduler, onToolCallsUpdate, messageBus } = makeScheduler(
        PolicyDecision.DENY,
        makeRegistry([tool]),
      );

      await scheduler.schedule(
        [
          {
            callId: 'call-deny',
            name: 'deniedTool',
            args: {},
            isClientInitiated: false,
            prompt_id: 'prompt-1',
          },
        ],
        new AbortController().signal,
      );

      const errored = await waitForCallStatus(
        onToolCallsUpdate,
        'call-deny',
        'error',
      );
      expect(
        (errored as { response?: { errorType?: ToolErrorType } }).response
          ?.errorType,
      ).toBe(ToolErrorType.POLICY_VIOLATION);
      expect(messageBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageBusType.TOOL_POLICY_REJECTION,
        }),
      );
      expect(confirmationRequestCount(messageBus)).toBe(0);
      expect(executed).toEqual([]);
    });

    it('user denial contrasts with policy denial: prompt first, cancelled, no errorType', async () => {
      // @plan PLAN-20260824-ISSUE2021.P01 @requirement REQ-2021.1
      const executed: string[] = [];
      const tool = gatedTool('userDeniedTool', new Set(), executed);
      const { scheduler, onToolCallsUpdate, messageBus } = makeScheduler(
        PolicyDecision.ASK_USER,
        makeRegistry([tool]),
      );

      await scheduler.schedule(
        [
          {
            callId: 'call-user-deny',
            name: 'userDeniedTool',
            args: {},
            isClientInitiated: false,
            prompt_id: 'prompt-1',
          },
        ],
        new AbortController().signal,
      );

      const awaiting = await waitForCallStatus(
        onToolCallsUpdate,
        'call-user-deny',
        'awaiting_approval',
      );
      expect(confirmationRequestCount(messageBus)).toBe(1);
      await confirmCall(awaiting, ToolConfirmationOutcome.Cancel);

      const cancelled = await waitForCallStatus(
        onToolCallsUpdate,
        'call-user-deny',
        'cancelled',
      );
      expect(
        (cancelled as { response?: { errorType?: ToolErrorType } }).response
          ?.errorType,
      ).toBeUndefined();
      expect(messageBus.publish).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageBusType.TOOL_POLICY_REJECTION,
        }),
      );
    });
  });

  describe('multiple pending tool calls', () => {
    it('ProceedOnce on one call gates execution behind the sibling decision; cancelling the sibling strands the approved call (characterization, see #3299)', async () => {
      // @plan PLAN-20260824-ISSUE2021.P02 @requirement REQ-2021.2
      // Current behavior: handleCancellation does not re-attempt execution,
      // so a call already approved (scheduled) never executes after its
      // sibling's denial. Pinned here as a characterization; a fix belongs to
      // a follow-up issue.
      const executed: string[] = [];
      const allowed = new Set<string>();
      const tool = gatedTool('sharedTool', allowed, executed);
      const { scheduler, onToolCallsUpdate } = makeScheduler(
        PolicyDecision.ASK_USER,
        makeRegistry([tool]),
      );

      await scheduler.schedule(
        [
          {
            callId: 'call-a',
            name: 'sharedTool',
            args: {},
            isClientInitiated: false,
            prompt_id: 'prompt-1',
          },
          {
            callId: 'call-b',
            name: 'sharedTool',
            args: {},
            isClientInitiated: false,
            prompt_id: 'prompt-1',
          },
        ],
        new AbortController().signal,
      );

      const awaitingA = await waitForCallStatus(
        onToolCallsUpdate,
        'call-a',
        'awaiting_approval',
      );
      const awaitingB = await waitForCallStatus(
        onToolCallsUpdate,
        'call-b',
        'awaiting_approval',
      );
      await confirmCall(awaitingA, ToolConfirmationOutcome.ProceedOnce);

      await waitForCallStatus(onToolCallsUpdate, 'call-a', 'scheduled');
      const latest = latestSnapshot(onToolCallsUpdate);
      expect(
        latest.find((call) => call.request.callId === 'call-b')?.status,
      ).toBe('awaiting_approval');
      expect(executed).toEqual([]);

      await confirmCall(awaitingB, ToolConfirmationOutcome.Cancel);
      await waitForCallStatus(onToolCallsUpdate, 'call-b', 'cancelled');
      await flushAsyncWork();
      expectNeverLeaves(
        recordedStatuses(onToolCallsUpdate, 'call-a'),
        'scheduled',
      );
      expect(executed).toEqual([]);
    });

    it('ProceedAlways cascades to the compatible pending call without a second prompt', async () => {
      // @plan PLAN-20260824-ISSUE2021.P02 @requirement REQ-2021.2
      const executed: string[] = [];
      const allowed = new Set<string>();
      const tool = gatedTool('sharedTool', allowed, executed);
      const { scheduler, onToolCallsUpdate, messageBus } = makeScheduler(
        PolicyDecision.ASK_USER,
        makeRegistry([tool]),
      );

      await scheduler.schedule(
        [
          {
            callId: 'call-a',
            name: 'sharedTool',
            args: {},
            isClientInitiated: false,
            prompt_id: 'prompt-1',
          },
          {
            callId: 'call-b',
            name: 'sharedTool',
            args: {},
            isClientInitiated: false,
            prompt_id: 'prompt-1',
          },
        ],
        new AbortController().signal,
      );

      const awaitingA = await waitForCallStatus(
        onToolCallsUpdate,
        'call-a',
        'awaiting_approval',
      );
      await waitForCallStatus(onToolCallsUpdate, 'call-b', 'awaiting_approval');
      const requestsBeforeCascade = confirmationRequestCount(messageBus);
      expect(requestsBeforeCascade).toBe(2);
      await confirmCall(awaitingA, ToolConfirmationOutcome.ProceedAlways);

      await waitForCallStatus(onToolCallsUpdate, 'call-a', 'success');
      await waitForCallStatus(onToolCallsUpdate, 'call-b', 'success');
      expect(executed).toEqual(['sharedTool', 'sharedTool']);
      expect(confirmationRequestCount(messageBus)).toBe(requestsBeforeCascade);
    });

    it('ProceedAlways cascade skips a call whose tool is not allowlisted (characterization: denying it strands the cascaded calls, see #3299)', async () => {
      // @plan PLAN-20260824-ISSUE2021.P02 @requirement REQ-2021.2
      // Same stranded-sibling behavior as the ProceedOnce characterization:
      // cancelling the last awaiting call leaves scheduled calls unexecuted.
      const executed: string[] = [];
      const allowed = new Set<string>();
      const shared = gatedTool('sharedTool', allowed, executed);
      const other = gatedTool('otherTool', allowed, executed);
      const { scheduler, onToolCallsUpdate, messageBus } = makeScheduler(
        PolicyDecision.ASK_USER,
        makeRegistry([shared, other]),
      );

      await scheduler.schedule(
        [
          {
            callId: 'call-a',
            name: 'sharedTool',
            args: {},
            isClientInitiated: false,
            prompt_id: 'prompt-1',
          },
          {
            callId: 'call-b',
            name: 'sharedTool',
            args: {},
            isClientInitiated: false,
            prompt_id: 'prompt-1',
          },
          {
            callId: 'call-c',
            name: 'otherTool',
            args: {},
            isClientInitiated: false,
            prompt_id: 'prompt-1',
          },
        ],
        new AbortController().signal,
      );

      const awaitingA = await waitForCallStatus(
        onToolCallsUpdate,
        'call-a',
        'awaiting_approval',
      );
      const awaitingC = await waitForCallStatus(
        onToolCallsUpdate,
        'call-c',
        'awaiting_approval',
      );
      await waitForCallStatus(onToolCallsUpdate, 'call-b', 'awaiting_approval');
      const requestsBeforeCascade = confirmationRequestCount(messageBus);
      expect(requestsBeforeCascade).toBe(3);
      await confirmCall(awaitingA, ToolConfirmationOutcome.ProceedAlways);

      await waitForCallStatus(onToolCallsUpdate, 'call-a', 'scheduled');
      await waitForCallStatus(onToolCallsUpdate, 'call-b', 'scheduled');
      const latest = latestSnapshot(onToolCallsUpdate);
      expect(
        latest.find((call) => call.request.callId === 'call-c')?.status,
      ).toBe('awaiting_approval');
      expect(confirmationRequestCount(messageBus)).toBe(requestsBeforeCascade);
      expect(executed).toEqual([]);

      await confirmCall(awaitingC, ToolConfirmationOutcome.Cancel);
      await waitForCallStatus(onToolCallsUpdate, 'call-c', 'cancelled');
      await flushAsyncWork();
      expectNeverLeaves(
        recordedStatuses(onToolCallsUpdate, 'call-a'),
        'scheduled',
      );
      expectNeverLeaves(
        recordedStatuses(onToolCallsUpdate, 'call-b'),
        'scheduled',
      );
      expect(executed).toEqual([]);
    });
  });

  describe('confirmation bus round-trip', () => {
    class CapturingBus {
      readonly handlers = new Map<string, (message: unknown) => void>();
      readonly publish = vi.fn();
      readonly respondToConfirmation = vi.fn();
      readonly requestConfirmation = vi.fn().mockResolvedValue(true);
      readonly removeAllListeners = vi.fn();
      readonly listenerCount = vi.fn().mockReturnValue(0);
      readonly subscribe = vi.fn(
        (type: string, handler: (message: unknown) => void) => {
          this.handlers.set(type, handler);
          return () => {
            this.handlers.delete(type);
          };
        },
      );
    }

    function makeBusBackedScheduler(bus: CapturingBus) {
      const executed: string[] = [];
      const allowed = new Set<string>();
      const tools = [
        gatedTool('busTool', allowed, executed),
        gatedTool('busSibling', allowed, executed),
      ];
      const messageBus = bus as unknown as ReturnType<
        typeof createMockMessageBus
      >;
      const { scheduler, onToolCallsUpdate } = makeScheduler(
        PolicyDecision.ASK_USER,
        makeRegistry(tools),
        messageBus,
      );
      return { scheduler, onToolCallsUpdate, executed, messageBus };
    }

    it('a bus response carrying the request correlationId resolves that call', async () => {
      // @plan PLAN-20260824-ISSUE2021.P03 @requirement REQ-2021.3
      const bus = new CapturingBus();
      const { scheduler, onToolCallsUpdate, executed, messageBus } =
        makeBusBackedScheduler(bus);

      await scheduler.schedule(
        [
          {
            callId: 'call-bus',
            name: 'busTool',
            args: {},
            isClientInitiated: false,
            prompt_id: 'prompt-1',
          },
          {
            callId: 'call-sibling',
            name: 'busSibling',
            args: {},
            isClientInitiated: false,
            prompt_id: 'prompt-1',
          },
        ],
        new AbortController().signal,
      );

      await waitForCallStatus(
        onToolCallsUpdate,
        'call-bus',
        'awaiting_approval',
      );
      await waitForCallStatus(
        onToolCallsUpdate,
        'call-sibling',
        'awaiting_approval',
      );
      const requestFor = (callId: string) =>
        messageBus.publish.mock.calls
          .map(
            ([message]) =>
              message as {
                type?: MessageBusType;
                correlationId?: string;
                toolCall?: { id?: string };
              },
          )
          .find(
            (message) =>
              message.type === MessageBusType.TOOL_CONFIRMATION_REQUEST &&
              message.toolCall?.id === callId,
          );
      const busRequest = requestFor('call-bus');
      const siblingRequest = requestFor('call-sibling');
      const busCorrelationId = busRequest?.correlationId ?? '';
      const siblingCorrelationId = siblingRequest?.correlationId ?? '';
      expect(busCorrelationId).not.toBe('');
      expect(siblingCorrelationId).not.toBe('');
      expect(busCorrelationId).not.toBe(siblingCorrelationId);

      const responseHandler = bus.handlers.get(
        MessageBusType.TOOL_CONFIRMATION_RESPONSE,
      );
      expect(responseHandler).toBeDefined();
      responseHandler?.({
        type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
        correlationId: busCorrelationId,
        outcome: ToolConfirmationOutcome.ProceedOnce,
      } satisfies ToolConfirmationResponse);

      // Only the named call advances; the sibling keeps awaiting, and the
      // batch cannot execute until every call is scheduled.
      await waitForCallStatus(onToolCallsUpdate, 'call-bus', 'scheduled');
      await flushAsyncWork();
      expectNeverLeaves(
        recordedStatuses(onToolCallsUpdate, 'call-sibling'),
        'awaiting_approval',
      );
      expect(executed).toEqual([]);

      responseHandler?.({
        type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
        correlationId: siblingCorrelationId,
        outcome: ToolConfirmationOutcome.ProceedOnce,
      } satisfies ToolConfirmationResponse);

      await waitForCallStatus(onToolCallsUpdate, 'call-bus', 'success');
      await waitForCallStatus(onToolCallsUpdate, 'call-sibling', 'success');
      expect(executed).toEqual(['busTool', 'busSibling']);
    });

    it('a bus response with an unknown correlationId leaves the call awaiting', async () => {
      // @plan PLAN-20260824-ISSUE2021.P03 @requirement REQ-2021.3
      const bus = new CapturingBus();
      const { scheduler, onToolCallsUpdate, executed } =
        makeBusBackedScheduler(bus);

      await scheduler.schedule(
        [
          {
            callId: 'call-unknown',
            name: 'busTool',
            args: {},
            isClientInitiated: false,
            prompt_id: 'prompt-1',
          },
        ],
        new AbortController().signal,
      );

      await waitForCallStatus(
        onToolCallsUpdate,
        'call-unknown',
        'awaiting_approval',
      );
      const responseHandler = bus.handlers.get(
        MessageBusType.TOOL_CONFIRMATION_RESPONSE,
      );
      responseHandler?.({
        type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
        correlationId: 'unknown-corr',
        outcome: ToolConfirmationOutcome.ProceedOnce,
      } satisfies ToolConfirmationResponse);

      await flushAsyncWork();
      expectNeverLeaves(
        recordedStatuses(onToolCallsUpdate, 'call-unknown'),
        'awaiting_approval',
      );
      expect(executed).toEqual([]);
    });
  });
});
