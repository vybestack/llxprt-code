/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3048 (REQ-3048-006): the a2a executor must discard tool-call requests
 * collected during an abandoned model attempt when a Retry event arrives,
 * while the successful attempt's own tool calls must still be scheduled. The
 * existing informational logging of Retry through task.acceptAgentMessage is
 * unchanged.
 *
 * The executor's private #processAgentTurnLoop is driven through the public
 * execute() entry point by pre-seeding the executor's task cache with a
 * recording Task double. Assertions are on the recorded scheduleToolCalls
 * argument arrays and on the acceptAgentMessage event stream — observable
 * outputs, not collaborator call counts.
 */

import { describe, it, expect, beforeEach, vi } from 'bun:test';
import { CoderAgentExecutor } from './executor.js';
import type { Task } from './task.js';
import type { ExecutionEventBus, RequestContext } from '@a2a-js/sdk/server';
import {
  AgentEventType,
  type ServerAgentStreamEvent,
  type ToolCallRequestInfo,
  type CompletedToolCall,
} from '@vybestack/llxprt-code-core';

function toolCallRequest(callId: string): ServerAgentStreamEvent {
  const value: ToolCallRequestInfo = {
    callId,
    name: 'noop',
    args: {},
    isClientInitiated: false,
    prompt_id: 'p',
    agentId: 'default_agent',
  };
  return { type: AgentEventType.ToolCallRequest, value };
}

function retryEvent(): ServerAgentStreamEvent {
  return { type: AgentEventType.Retry };
}

function contentEvent(text: string): ServerAgentStreamEvent {
  return { type: AgentEventType.Content, value: text };
}

function finishedEvent(): ServerAgentStreamEvent {
  return { type: AgentEventType.Finished, value: { reason: 'stop' } };
}

interface ScriptedTaskOptions {
  firstTurnEvents: ServerAgentStreamEvent[];
}

function createScriptedTask(options: ScriptedTaskOptions): {
  task: Task;
  scheduledRequests: ToolCallRequestInfo[][];
  acceptedEvents: ServerAgentStreamEvent[];
} {
  const scheduledRequests: ToolCallRequestInfo[][] = [];
  const acceptedEvents: ServerAgentStreamEvent[] = [];
  const firstTurnEvents = [...options.firstTurnEvents];
  const completedTools: CompletedToolCall[] = [];

  const task = {
    id: 'retry-discard-task',
    contextId: 'retry-discard-context',
    taskState: 'working',
    eventBus: undefined,
    async *acceptUserMessage(
      _requestContext: RequestContext,
      _signal: AbortSignal,
    ): AsyncGenerator<ServerAgentStreamEvent> {
      for (const event of firstTurnEvents) {
        yield event;
      }
    },
    async acceptAgentMessage(event: ServerAgentStreamEvent): Promise<void> {
      acceptedEvents.push(event);
    },
    async scheduleToolCalls(
      requests: ToolCallRequestInfo[],
      _signal: AbortSignal,
    ): Promise<void> {
      scheduledRequests.push([...requests]);
    },
    async waitForPendingTools(): Promise<void> {},
    getAndClearCompletedTools(): CompletedToolCall[] {
      return completedTools.splice(0, completedTools.length);
    },
    setTaskStateAndPublishUpdate(): void {},
    cancelPendingTools(): void {},
  } as unknown as Task;

  return { task, scheduledRequests, acceptedEvents };
}

function createRecordingEventBus(): ExecutionEventBus {
  return {
    publish: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
    removeAllListeners: vi.fn(),
    finished: vi.fn(),
  } as unknown as ExecutionEventBus;
}

function createRequestContext(): RequestContext {
  return {
    userMessage: {
      role: 'user',
      parts: [{ kind: 'text', text: 'go' }],
      messageId: 'm-1',
      kind: 'message',
      contextId: 'retry-discard-context',
      taskId: 'retry-discard-task',
    },
  } as unknown as RequestContext;
}

interface ExecutorInternals {
  tasks: Map<
    string,
    { task: Task; agentSettings: unknown; toSDKTask: () => unknown }
  >;
}

/**
 * Pre-seeds the executor's in-memory task cache so the public execute() path
 * resolves the scripted Task double without hitting the store / createTask
 * wiring. The executor then runs the real #processAgentTurnLoop against it.
 */
function seedExecutor(executor: CoderAgentExecutor, task: Task): void {
  const internals = executor as unknown as ExecutorInternals;
  internals.tasks.set('retry-discard-task', {
    task,
    agentSettings: {},
    toSDKTask: () => task,
  });
}

describe('a2a executor discards abandoned tool-call requests on Retry (issue 3048)', () => {
  let executor: CoderAgentExecutor;
  let eventBus: ExecutionEventBus;

  beforeEach(() => {
    executor = new CoderAgentExecutor();
    eventBus = createRecordingEventBus();
  });

  /**
   * @plan PLAN-20260806-ISSUE3048.P05
   * @requirement REQ-3048-006
   * @scenario schedules only the successful attempt's tool calls
   */
  it("schedules only the successful attempt's tool calls", async () => {
    const { task, scheduledRequests } = createScriptedTask({
      firstTurnEvents: [
        toolCallRequest('abandoned'),
        retryEvent(),
        toolCallRequest('kept'),
        finishedEvent(),
      ],
    });
    seedExecutor(executor, task);

    await executor.execute(createRequestContext(), eventBus);

    expect(scheduledRequests).toHaveLength(1);
    expect(scheduledRequests[0].map((r) => r.callId)).toEqual(['kept']);
  });

  /**
   * @plan PLAN-20260806-ISSUE3048.P05
   * @requirement REQ-3048-006
   * @scenario never schedules when the only tool calls belonged to an abandoned attempt
   */
  it('never schedules when the only tool calls belonged to an abandoned attempt', async () => {
    const { task, scheduledRequests } = createScriptedTask({
      firstTurnEvents: [
        toolCallRequest('abandoned'),
        retryEvent(),
        finishedEvent(),
      ],
    });
    seedExecutor(executor, task);

    await executor.execute(createRequestContext(), eventBus);

    expect(scheduledRequests).toHaveLength(0);
  });

  /**
   * @requirement REQ-3048-006
   * @scenario abandoned model output and tools are discarded together
   */
  it('accepts and schedules only the replacement attempt state', async () => {
    const { task, acceptedEvents, scheduledRequests } = createScriptedTask({
      firstTurnEvents: [
        contentEvent('abandoned'),
        toolCallRequest('abandoned'),
        retryEvent(),
        contentEvent('replacement'),
        toolCallRequest('kept'),
        finishedEvent(),
      ],
    });
    seedExecutor(executor, task);

    await executor.execute(createRequestContext(), eventBus);

    expect(
      acceptedEvents
        .filter((event) => event.type === AgentEventType.Content)
        .map((event) => event.value),
    ).toEqual(['replacement']);
    expect(
      acceptedEvents.some((event) => event.type === AgentEventType.Retry),
    ).toBe(true);
    expect(scheduledRequests).toHaveLength(1);
    expect(scheduledRequests[0].map((request) => request.callId)).toEqual([
      'kept',
    ]);
  });

  /**
   * @plan PLAN-20260806-ISSUE3048.P05
   * @requirement REQ-3048-006
   * @scenario still logs the Retry event through acceptAgentMessage (informational classification unchanged)
   */
  it('still logs the Retry event through acceptAgentMessage', async () => {
    const { task, acceptedEvents } = createScriptedTask({
      firstTurnEvents: [
        toolCallRequest('abandoned'),
        retryEvent(),
        toolCallRequest('kept'),
        finishedEvent(),
      ],
    });
    seedExecutor(executor, task);

    await executor.execute(createRequestContext(), eventBus);

    expect(acceptedEvents.some((e) => e.type === AgentEventType.Retry)).toBe(
      true,
    );
  });
});
