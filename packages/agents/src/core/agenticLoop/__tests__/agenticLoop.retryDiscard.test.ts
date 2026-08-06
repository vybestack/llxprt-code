/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3048 (REQ-3048-006): tool-call requests collected during an abandoned
 * model attempt must be discarded by AgenticLoop when a Retry event arrives,
 * while the successful attempt's own tool calls must still be scheduled. The
 * turn is NOT terminal on Retry, so `shouldScheduleTools` stays true.
 *
 * The loop, CoreToolScheduler, MockTool and confirmation bus are REAL. The only
 * double is the agentClient.sendMessageStream scripted event source
 * (infrastructure boundary). Assertions are on observable output: the
 * `tools_complete` completed calls' callIds, the presence/absence of
 * `tools_complete`, and the ordering of yielded stream events.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '../../../testApi.js';
import { AgenticLoop } from '../AgenticLoop.js';
import { MockTool } from '@vybestack/llxprt-code-core/test-utils/mock-tool.js';
import { clearAllSchedulers } from '@vybestack/llxprt-code-core/config/schedulerSingleton.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import {
  AgentEventType,
  createScriptedAgentClient,
  createTestConfig,
  createToolRegistryForTest,
  createAllowPolicyEngine,
  collectEvents,
  isToolsComplete,
  isStream,
  toolCallRequestEvent,
  contentEvent,
  finishedEvent,
  type AgenticLoopEvent,
  type ServerAgentStreamEvent,
} from './agenticLoop-test-helpers.js';

function retryEvent(): ServerAgentStreamEvent {
  return { type: AgentEventType.Retry };
}

describe('AgenticLoop discards abandoned tool-call requests on Retry (issue 3048)', () => {
  beforeEach(() => {
    clearAllSchedulers();
  });
  afterEach(() => {
    clearAllSchedulers();
  });

  function buildLoop(scripts: ServerAgentStreamEvent[][]) {
    const tool = new MockTool({ name: 'echo' });
    const toolRegistry = createToolRegistryForTest([tool]);
    const messageBus = new MessageBus(createAllowPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAllowPolicyEngine(),
      interactive: false,
      approvalMode: ApprovalMode.YOLO,
    });
    const scripted = createScriptedAgentClient(scripts);
    const loop = new AgenticLoop({
      agentClient: scripted.client,
      config,
      messageBus,
    });
    return { loop, ...scripted };
  }

  /** CallIds of completed tool calls, in order, from the tools_complete event. */
  function completedCallIds(events: readonly AgenticLoopEvent[]): string[] {
    const complete = events.find(isToolsComplete);
    if (!complete) return [];
    return complete.completed.map((call) => call.request.callId);
  }

  /**
   * @plan PLAN-20260806-ISSUE3048.P05
   * @requirement REQ-3048-006
   * @scenario schedules only the successful attempt's tool calls
   */
  it("schedules only the successful attempt's tool calls", async () => {
    const { loop } = buildLoop([
      [
        toolCallRequestEvent('echo', 'abandoned'),
        retryEvent(),
        toolCallRequestEvent('echo', 'kept'),
        finishedEvent(),
      ],
      // Continuation turn after the tool result so the loop terminates cleanly.
      [contentEvent('all done'), finishedEvent()],
    ]);

    const events = await collectEvents(
      loop,
      'go',
      new AbortController().signal,
    );

    expect(completedCallIds(events)).toEqual(['kept']);
  });

  /**
   * @plan PLAN-20260806-ISSUE3048.P05
   * @requirement REQ-3048-006
   * @scenario never schedules when the only tool calls belonged to an abandoned attempt
   */
  it('never schedules when the only tool calls belonged to an abandoned attempt', async () => {
    const { loop } = buildLoop([
      [
        toolCallRequestEvent('echo', 'abandoned'),
        retryEvent(),
        finishedEvent(),
      ],
    ]);

    const events = await collectEvents(
      loop,
      'go',
      new AbortController().signal,
    );

    expect(events.some(isToolsComplete)).toBe(false);
  });

  /**
   * @plan PLAN-20260806-ISSUE3048.P05
   * @requirement REQ-3048-006
   * @scenario forwards the Retry event to consumers before discarding
   */
  it('forwards the Retry event to consumers before discarding', async () => {
    const { loop } = buildLoop([
      [
        toolCallRequestEvent('echo', 'abandoned'),
        retryEvent(),
        toolCallRequestEvent('echo', 'kept'),
        finishedEvent(),
      ],
      [contentEvent('all done'), finishedEvent()],
    ]);

    const events = await collectEvents(
      loop,
      'go',
      new AbortController().signal,
    );

    const streamEvents = events.filter(isStream);
    const retryIndex = streamEvents.findIndex(
      (e) => e.event.type === AgentEventType.Retry,
    );
    const keptIndex = streamEvents.findIndex(
      (e) =>
        e.event.type === AgentEventType.ToolCallRequest &&
        e.event.value.callId === 'kept',
    );
    expect(retryIndex).toBeGreaterThanOrEqual(0);
    expect(keptIndex).toBeGreaterThanOrEqual(0);
    expect(retryIndex).toBeLessThan(keptIndex);
  });

  /**
   * @plan PLAN-20260806-ISSUE3048.P05
   * @requirement REQ-3048-006
   * @scenario keeps the turn alive across a Retry (shouldScheduleTools stays true)
   */
  it('keeps the turn alive across a Retry', async () => {
    const { loop } = buildLoop([
      [
        toolCallRequestEvent('echo', 'abandoned'),
        retryEvent(),
        toolCallRequestEvent('echo', 'kept'),
        finishedEvent(),
      ],
      [contentEvent('all done'), finishedEvent()],
    ]);

    const events = await collectEvents(
      loop,
      'go',
      new AbortController().signal,
    );

    // A tools_complete event proves the turn was NOT treated as terminal and
    // the successful attempt's tool call was actually scheduled and run.
    expect(events.some(isToolsComplete)).toBe(true);
  });

  /**
   * Fence: the existing terminal-Error discard behaviour is unchanged.
   */
  it('still drops tool calls and stops on a terminal Error event', async () => {
    const { loop } = buildLoop([
      [
        toolCallRequestEvent('echo', 'doomed'),
        {
          type: AgentEventType.Error,
          value: { error: { message: 'provider failed' } },
        },
      ],
    ]);

    const events = await collectEvents(
      loop,
      'go',
      new AbortController().signal,
    );

    expect(events.some(isToolsComplete)).toBe(false);
  });
});
