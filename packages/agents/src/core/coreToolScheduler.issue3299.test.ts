/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression suite for issue #3299.
 *
 * AC2: a policy-bus tool that initially requires confirmation is confirmed on
 * its first call. The call's onConfirm receives ProceedAlways and publishes
 * UPDATE_POLICY through a real CoreMessageBusAdapter; the real
 * createPolicyUpdater subscriber (the same wiring the foreground startup
 * installs; that subscription itself is proven by the CLI bootstrap test)
 * converts it into an ALLOW rule on the real PolicyEngine, so a later
 * matching call on the same scheduler succeeds without awaiting_approval.
 * An unrelated tool stays gated and ProceedOnce stays call-local.
 *
 * AC4-AC6: cancelling the last awaiting call in a mixed batch re-drives
 * the scheduler gate so approved `scheduled` siblings execute, gating holds
 * while a sibling still awaits, and each completed batch fires exactly once.
 */

import { describe, it, expect, afterEach } from 'bun:test';
import type { ToolCall, CompletedToolCall } from './coreToolScheduler.js';
import { CoreToolScheduler } from './coreToolScheduler.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import { PolicyDecision } from '@vybestack/llxprt-code-core';
import {
  MessageBus,
  PolicyEngine,
  createPolicyUpdater,
} from '@vybestack/llxprt-code-core';
import { CoreMessageBusAdapter } from '@vybestack/llxprt-code-core/tools-adapters/CoreMessageBusAdapter.js';
import {
  MessageBusType,
  type ToolConfirmationRequest,
  type ToolConfirmationResponse,
} from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import type { ToolCallConfirmationDetails } from '@vybestack/llxprt-code-tools';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools/types/tool-confirmation-types.js';
import { MockTool } from '@vybestack/llxprt-code-core/test-utils/mock-tool.js';
import { waitFor } from '@vybestack/llxprt-code-test-utils';

// ── Fixtures ───────────────────────────────────────────────────────────────

const schedulersToDispose: CoreToolScheduler[] = [];

afterEach(() => {
  for (const scheduler of schedulersToDispose) {
    scheduler.dispose();
  }
  schedulersToDispose.length = 0;
});

/**
 * Policy-gated tool: the engine is the only source of truth. While it says
 * ASK_USER the tool asks; the user's ProceedAlways routes through the real
 * adapter so the live createPolicyUpdater subscriber makes the engine ALLOW.
 */
function makeGatedTool(
  command: string,
  engine: PolicyEngine,
  adapter: CoreMessageBusAdapter,
  recordExecution: (toolName: string) => void,
): MockTool {
  return new MockTool({
    name: command,
    shouldConfirmExecute: async (
      params: { command?: unknown },
      _signal: AbortSignal,
    ): Promise<ToolCallConfirmationDetails | false> => {
      if (
        engine.evaluate(command, {
          command: String(params.command ?? command),
        }) === PolicyDecision.ALLOW
      ) {
        return false;
      }
      return {
        type: 'exec',
        title: `Confirm ${command}`,
        command: String(params.command ?? command),
        rootCommand: command,
        rootCommands: [command],
        onConfirm: async (outcome: ToolConfirmationOutcome) => {
          if (outcome === ToolConfirmationOutcome.ProceedAlways) {
            const policyUpdate: {
              toolName: string;
              commandPrefix: string[];
            } = {
              toolName: command,
              commandPrefix: [command],
            };
            await adapter.publishPolicyUpdate(outcome, policyUpdate);
          }
        },
      };
    },
    execute: async () => {
      recordExecution(command);
      return {
        llmContent: `${command} ran`,
        returnDisplay: `${command} ran`,
      };
    },
  });
}

interface Harness {
  scheduler: CoreToolScheduler;
  engine: PolicyEngine;
  bus: MessageBus;
  updates: ToolCall[][];
  completions: CompletedToolCall[][];
  executionsByTool: Readonly<Map<string, number>>;
}

function makeHarness(commands: string[]): Harness {
  const engine = new PolicyEngine({});
  const bus = new MessageBus(engine);
  const adapter = new CoreMessageBusAdapter(bus);
  createPolicyUpdater(engine, bus);
  const executionsByTool = new Map<string, number>();
  const tools = commands.map((command) =>
    makeGatedTool(command, engine, adapter, (toolName) => {
      executionsByTool.set(toolName, (executionsByTool.get(toolName) ?? 0) + 1);
    }),
  );
  const registry = makeRegistry(tools);
  const updates: ToolCall[][] = [];
  const completions: CompletedToolCall[][] = [];
  const scheduler = new CoreToolScheduler({
    config: makeConfig(engine, registry, bus),
    messageBus: bus,
    toolRegistry: registry,
    onAllToolCallsComplete: async (calls: CompletedToolCall[]) => {
      completions.push(calls);
    },
    onToolCallsUpdate: (calls: ToolCall[]) => {
      updates.push(calls);
    },
    getPreferredEditor: () => 'vscode',
    onEditorClose: () => {},
  });
  schedulersToDispose.push(scheduler);
  return { scheduler, engine, bus, updates, completions, executionsByTool };
}

/**
 * Builds one fresh ToolRegistry and one fresh set of tool instances per
 * scheduler harness. The SAME registry instance is passed to both Config and the
 * scheduler so the scheduler executes the exact tools the policy decision applies to.
 */
function makeRegistry(tools: MockTool[]): ToolRegistry {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  return {
    getTool: (name: string) => byName.get(name),
    getFunctionDeclarations: () => [],
    tools: new Map(),
    discovery: {},
    registerTool: () => {},
    getToolByName: (name: string) => byName.get(name),
    getToolByDisplayName: (name: string) => byName.get(name),
    getTools: () => [],
    discoverTools: async () => {},
    getAllTools: () => tools,
    getToolsByServer: () => [],
  } as unknown as ToolRegistry;
}

function makeConfig(
  engine: PolicyEngine,
  registry: ToolRegistry,
  bus: MessageBus,
): Config {
  return {
    getSessionId: () => 'test-session-id',
    getUsageStatisticsEnabled: () => true,
    getDebugMode: () => false,
    isInteractive: () => true,
    getApprovalMode: () => ApprovalMode.DEFAULT,
    getEphemeralSettings: () => ({}),
    getAllowedTools: () => [],
    getContentGeneratorConfig: () => ({ model: 'test-model' }),
    getToolRegistry: () => registry,
    getMessageBus: () => bus,
    getEnableHooks: () => false,
    getPolicyEngine: () => engine,
    getModel: () => 'gemini-2.5-pro',
  } as unknown as Config;
}

async function waitForStatus<Status extends ToolCall['status']>(
  updates: ToolCall[][],
  callId: string,
  status: Status,
): Promise<Extract<ToolCall, { status: Status }>> {
  let call: ToolCall | undefined;
  await waitFor(() => {
    call = latestOf(updates, callId);
    if (call === undefined) {
      throw new Error(`No emitted snapshot found for ${callId}`);
    }
    if (!hasStatus(call, status)) {
      throw new Error(
        `Call ${callId} latest status ${call.status} is not ${status}`,
      );
    }
  });
  if (call === undefined || !hasStatus(call, status)) {
    throw new Error(`No ${status} snapshot found for ${callId}`);
  }
  return call;
}

function hasStatus<Status extends ToolCall['status']>(
  call: ToolCall,
  status: Status,
): call is Extract<ToolCall, { status: Status }> {
  return call.status === status;
}

/**
 * Returns the state of `callId` in the LATEST emitted snapshot that
 * contains it. Unlike a scan that matches any historical snapshot, a
 * `scheduled` state observed before execution cannot satisfy a post-execution
 * check.
 */
function latestOf(updates: ToolCall[][], callId: string): ToolCall | undefined {
  for (let index = updates.length - 1; index >= 0; index -= 1) {
    const call = updates[index].find(
      (candidate) => candidate.request.callId === callId,
    );
    if (call !== undefined) {
      return call;
    }
  }
  return undefined;
}

/**
 * Asserts the call is currently in `scheduled` (the latest emitted snapshot)
 * and has never reached `executing`, `success`, or `error` in any snapshot.
 */
function expectWaitingScheduled(updates: ToolCall[][], callId: string): void {
  const latest = latestOf(updates, callId);
  if (latest === undefined) {
    throw new Error(`No emitted snapshot found for ${callId}`);
  }
  expect(latest.status).toBe('scheduled');
  expect(
    updates.some((snapshot) =>
      snapshot.some(
        (call) =>
          call.request.callId === callId &&
          (call.status === 'executing' ||
            call.status === 'success' ||
            call.status === 'error'),
      ),
    ),
  ).toBe(false);
}

const terminalStatuses: ReadonlyArray<ToolCall['status']> = [
  'success',
  'error',
  'cancelled',
];

async function confirmCall(
  call: ToolCall,
  outcome: ToolConfirmationOutcome,
): Promise<void> {
  if (call.status !== 'awaiting_approval') {
    throw new Error(`expected awaiting_approval call, got ${call.status}`);
  }
  const details = call.confirmationDetails;
  if (!('onConfirm' in details)) {
    throw new Error('confirmationDetails carries no onConfirm callback');
  }
  await details.onConfirm(outcome);
}

// ── AC2: "allow for this session" applies to a later matching call ──

describe('issue #3299: ProceedAlways applies to a later matching call (AC2)', () => {
  it('confirms the first policy-bus call, then a later matching call succeeds without confirmation while an unrelated tool stays gated', async () => {
    const { scheduler, engine, updates, completions, executionsByTool } =
      makeHarness(['approvalTool', 'otherTool']);

    await scheduler.schedule(
      [requestFor('first', 'approvalTool')],
      new AbortController().signal,
    );
    const firstCall = await waitForStatus(
      updates,
      'first',
      'awaiting_approval',
    );
    await confirmCall(firstCall, ToolConfirmationOutcome.ProceedAlways);
    await waitForStatus(updates, 'first', 'success');
    await waitFor(() => {
      expect(completions).toHaveLength(1);
    });

    expect(engine.evaluate('approvalTool', { command: 'approvalTool' })).toBe(
      PolicyDecision.ALLOW,
    );

    await scheduler.schedule(
      [requestFor('later', 'approvalTool')],
      new AbortController().signal,
    );
    await waitForStatus(updates, 'later', 'success');
    await waitFor(() => {
      expect(completions).toHaveLength(2);
    });
    const laterBatch = completions[1];
    expect(
      laterBatch.find((call) => call.request.callId === 'later')?.status,
    ).toBe('success');
    expect(laterBatch).toHaveLength(1);
    expect(laterBatch[0]?.status).toBe('success');

    await scheduler.schedule(
      [requestFor('other', 'otherTool')],
      new AbortController().signal,
    );
    const otherCall = await waitForStatus(
      updates,
      'other',
      'awaiting_approval',
    );
    await confirmCall(otherCall, ToolConfirmationOutcome.ProceedAlways);
    await waitForStatus(updates, 'other', 'success');
    await waitFor(() => {
      expect(completions).toHaveLength(3);
    });
    expect(executionsByTool.get('approvalTool')).toBe(2);
    expect(executionsByTool.get('otherTool')).toBe(1);
  });

  it('ProceedOnce stays call-local: a later matching call is confirmed again', async () => {
    const { scheduler, updates, completions, executionsByTool } = makeHarness([
      'onceTool',
    ]);

    await scheduler.schedule(
      [requestFor('first', 'onceTool')],
      new AbortController().signal,
    );
    const firstCall = await waitForStatus(
      updates,
      'first',
      'awaiting_approval',
    );
    await confirmCall(firstCall, ToolConfirmationOutcome.ProceedOnce);
    await waitForStatus(updates, 'first', 'success');

    await scheduler.schedule(
      [requestFor('later', 'onceTool')],
      new AbortController().signal,
    );
    const laterCall = await waitForStatus(
      updates,
      'later',
      'awaiting_approval',
    );
    await confirmCall(laterCall, ToolConfirmationOutcome.ProceedOnce);
    await waitForStatus(updates, 'later', 'success');
    await waitFor(() => {
      expect(completions).toHaveLength(2);
    });
    expect(executionsByTool.get('onceTool')).toBe(2);
  });
});

// ── AC4: cancelling the last awaiting call releases approved siblings ──

describe('issue #3299: cancelling the last awaiting call releases approved siblings (AC4)', () => {
  it('a ProceedOnce-approved sibling executes once the last awaiting sibling is cancelled', async () => {
    const { scheduler, updates, completions, executionsByTool } = makeHarness([
      'sharedTool',
    ]);

    await scheduler.schedule(
      [requestFor('call-a', 'sharedTool'), requestFor('call-b', 'sharedTool')],
      new AbortController().signal,
    );
    const awaitingA = await waitForStatus(
      updates,
      'call-a',
      'awaiting_approval',
    );
    await waitForStatus(updates, 'call-b', 'awaiting_approval');

    await confirmCall(awaitingA, ToolConfirmationOutcome.ProceedOnce);
    await waitForStatus(updates, 'call-a', 'scheduled');
    await waitFor(() => {
      expect(executionsByTool.get('sharedTool')).toBe(undefined);
    });

    const awaitingB = await waitForStatus(
      updates,
      'call-b',
      'awaiting_approval',
    );
    await confirmCall(awaitingB, ToolConfirmationOutcome.Cancel);
    await waitForStatus(updates, 'call-b', 'cancelled');
    await waitForStatus(updates, 'call-a', 'success');

    await waitFor(() => {
      expect(completions).toHaveLength(1);
    });
    const completedCalls = completions[0];
    expect(completedCalls).toHaveLength(2);
    for (const call of completedCalls) {
      expect(terminalStatuses).toContain(call.status);
    }
    expect(executionsByTool.get('sharedTool')).toBe(1);
  });

  it('a response for serialized confirmation details cancels the final waiter and releases a scheduled sibling', async () => {
    const { scheduler, bus, updates, completions, executionsByTool } =
      makeHarness(['approvedTool', 'serializedTool']);
    let serializedCorrelationId: string | undefined;
    bus.subscribe<ToolConfirmationRequest>(
      MessageBusType.TOOL_CONFIRMATION_REQUEST,
      (request) => {
        if (request.toolCall.name === 'serializedTool') {
          serializedCorrelationId = request.correlationId;
        }
      },
    );

    await scheduler.schedule(
      [
        requestFor('approved', 'approvedTool'),
        requestFor('serialized', 'serializedTool'),
      ],
      new AbortController().signal,
    );
    const approved = await waitForStatus(
      updates,
      'approved',
      'awaiting_approval',
    );
    const serialized = await waitForStatus(
      updates,
      'serialized',
      'awaiting_approval',
    );
    // The MessageBus branch accepts details that crossed a serialization
    // boundary and no longer carry the in-process callback.
    if (!Reflect.deleteProperty(serialized.confirmationDetails, 'onConfirm')) {
      throw new Error('could not serialize confirmation details');
    }
    await confirmCall(approved, ToolConfirmationOutcome.ProceedOnce);
    await waitForStatus(updates, 'approved', 'scheduled');
    expect(executionsByTool.get('approvedTool')).toBeUndefined();

    await waitFor(() => {
      expect(serializedCorrelationId).toBeDefined();
    });
    if (serializedCorrelationId === undefined) {
      throw new Error('serialized confirmation request was not published');
    }
    bus.publish({
      type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
      correlationId: serializedCorrelationId,
      outcome: ToolConfirmationOutcome.Cancel,
    } satisfies ToolConfirmationResponse);

    await waitForStatus(updates, 'serialized', 'cancelled');
    await waitForStatus(updates, 'approved', 'success');
    await waitFor(() => {
      expect(completions).toHaveLength(1);
    });
    expect(completions[0]).toHaveLength(2);
    expect(executionsByTool.get('approvedTool')).toBe(1);
    expect(executionsByTool.get('serializedTool')).toBeUndefined();
  });
});

// ── AC5: gating is preserved while any sibling still awaits ───────────

describe('issue #3299: gating is preserved while a sibling still awaits (AC5)', () => {
  it('a ProceedOnce-approved sibling stays scheduled until the last awaiting call is cancelled', async () => {
    const { scheduler, updates, completions, executionsByTool } = makeHarness([
      'sharedTool',
    ]);

    await scheduler.schedule(
      [
        requestFor('call-a', 'sharedTool'),
        requestFor('call-b', 'sharedTool'),
        requestFor('call-c', 'sharedTool'),
      ],
      new AbortController().signal,
    );
    const awaitingA = await waitForStatus(
      updates,
      'call-a',
      'awaiting_approval',
    );
    await waitForStatus(updates, 'call-b', 'awaiting_approval');
    await waitForStatus(updates, 'call-c', 'awaiting_approval');

    await confirmCall(awaitingA, ToolConfirmationOutcome.ProceedOnce);
    await waitForStatus(updates, 'call-a', 'scheduled');
    await waitForStatus(updates, 'call-b', 'awaiting_approval');
    await waitForStatus(updates, 'call-c', 'awaiting_approval');
    expectWaitingScheduled(updates, 'call-a');
    await waitFor(() => {
      expect(executionsByTool.get('sharedTool')).toBe(undefined);
    });

    const awaitingB = await waitForStatus(
      updates,
      'call-b',
      'awaiting_approval',
    );
    await confirmCall(awaitingB, ToolConfirmationOutcome.Cancel);
    await waitForStatus(updates, 'call-b', 'cancelled');
    await waitForStatus(updates, 'call-c', 'awaiting_approval');
    expectWaitingScheduled(updates, 'call-a');
    expect(completions).toHaveLength(0);

    const awaitingC = await waitForStatus(
      updates,
      'call-c',
      'awaiting_approval',
    );
    await confirmCall(awaitingC, ToolConfirmationOutcome.Cancel);
    await waitForStatus(updates, 'call-a', 'success');
    await waitForStatus(updates, 'call-c', 'cancelled');
    await waitFor(() => {
      expect(completions).toHaveLength(1);
    });
    const completedCalls = completions[0];
    expect(completedCalls).toHaveLength(3);
    for (const call of completedCalls) {
      expect(terminalStatuses).toContain(call.status);
    }
    expect(executionsByTool.get('sharedTool')).toBe(1);
  });
});

// ── AC6: ProceedAlways cascade completes after incompatible cancel ───

describe('issue #3299: ProceedAlways cascade completes after incompatible sibling is cancelled (AC6)', () => {
  it('two compatible siblings scheduled by the ProceedAlways cascade execute once the incompatible awaiting call is cancelled', async () => {
    const { scheduler, updates, completions, executionsByTool } = makeHarness([
      'sharedTool',
      'blockedTool',
    ]);

    await scheduler.schedule(
      [
        requestFor('shared-a', 'sharedTool'),
        requestFor('shared-b', 'sharedTool'),
        requestFor('blocked', 'blockedTool'),
      ],
      new AbortController().signal,
    );
    const awaitingSharedA = await waitForStatus(
      updates,
      'shared-a',
      'awaiting_approval',
    );
    await waitForStatus(updates, 'shared-b', 'awaiting_approval');
    await waitForStatus(updates, 'blocked', 'awaiting_approval');

    await confirmCall(awaitingSharedA, ToolConfirmationOutcome.ProceedAlways);
    await waitForStatus(updates, 'shared-a', 'scheduled');
    await waitForStatus(updates, 'shared-b', 'scheduled');
    expectWaitingScheduled(updates, 'shared-a');
    expectWaitingScheduled(updates, 'shared-b');
    await waitFor(() => {
      expect(executionsByTool.get('sharedTool')).toBe(undefined);
    });
    expect(executionsByTool.get('blockedTool')).toBe(undefined);

    const awaitingBlocked = await waitForStatus(
      updates,
      'blocked',
      'awaiting_approval',
    );
    await confirmCall(awaitingBlocked, ToolConfirmationOutcome.Cancel);
    await waitForStatus(updates, 'shared-a', 'success');
    await waitForStatus(updates, 'shared-b', 'success');
    await waitForStatus(updates, 'blocked', 'cancelled');

    await waitFor(() => {
      expect(completions).toHaveLength(1);
    });
    const completedCalls = completions[0];
    expect(completedCalls).toHaveLength(3);
    expect(
      completedCalls.filter((call) => call.status === 'success'),
    ).toHaveLength(2);
    expect(
      completedCalls.filter((call) => call.status === 'cancelled'),
    ).toHaveLength(1);
    for (const call of completedCalls) {
      expect(terminalStatuses).toContain(call.status);
    }
    expect(executionsByTool.get('sharedTool')).toBe(2);
  });
});

function requestFor(
  callId: string,
  name: string,
): {
  callId: string;
  name: string;
  args: { command: string };
  isClientInitiated: boolean;
  prompt_id: string;
} {
  return {
    callId,
    name,
    args: { command: name },
    isClientInitiated: false,
    prompt_id: 'issue3299',
  };
}
