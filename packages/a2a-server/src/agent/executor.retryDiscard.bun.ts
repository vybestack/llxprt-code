/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3048 (REQ-3048-006): when the provider retries an attempt, the
 * a2a executor must discard buffered partial output published before the
 * retry, while content from the replacement attempt still publishes. Under
 * the public Agent facade the Agent owns tool scheduling, so the executor's
 * retry responsibility is publication only: whatever was buffered for the
 * abandoned attempt never reaches the task, and commit points after the
 * retry publish normally.
 *
 * The executor's private #processAgentTurnLoop is driven through the public
 * execute() entry point by pre-seeding the executor's task cache with a
 * recording Task double. Assertions are on recorded sendTextContent /
 * setTaskStateAndPublishUpdate calls — observable publications, not
 * collaborator call counts.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { CoderAgentExecutor } from './executor.js';
import type { Task } from './task.js';
import type { ExecutionEventBus, RequestContext } from '@a2a-js/sdk/server';
import type { AgentEvent, AgentDoneEvent } from '@vybestack/llxprt-code-agents';

function textEvent(text: string): AgentEvent {
  return { type: 'text', text };
}

const retryEvent: AgentEvent = { type: 'retry' };

function toolCallEvent(callId: string): AgentEvent {
  return {
    type: 'tool-call',
    call: { id: callId, name: 'noop', args: {} },
  };
}

function doneEvent(): AgentDoneEvent {
  return { type: 'done', reason: 'stop' };
}

interface ScriptedTaskOptions {
  firstTurnEvents: AgentEvent[];
}

function createScriptedTask(options: ScriptedTaskOptions): {
  task: Task;
  publishedText: string[];
  publishedStates: string[];
} {
  const publishedText: string[] = [];
  const publishedStates: string[] = [];
  const firstTurnEvents = [...options.firstTurnEvents];

  const task = {
    id: 'retry-discard-task',
    contextId: 'retry-discard-context',
    taskState: 'working',
    eventBus: undefined,
    async *acceptUserMessage(
      _requestContext: RequestContext,
      _signal: AbortSignal,
    ): AsyncGenerator<AgentEvent, void, unknown> {
      for (const event of firstTurnEvents) {
        yield event;
      }
    },
    async sendTextContent(text: string): Promise<void> {
      publishedText.push(text);
    },
    async sendThought(): Promise<void> {},
    async handleModelInfo(): Promise<void> {},
    setTaskStateAndPublishUpdate(state: string): void {
      publishedStates.push(state);
    },
    cancelPendingTools(): void {},
  } as unknown as Task;

  return { task, publishedText, publishedStates };
}

function createRecordingEventBus(): ExecutionEventBus {
  return {
    publish: () => {},
    on: () => {},
    off: () => {},
    once: () => {},
    removeAllListeners: () => {},
    finished: () => {},
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

describe('a2a executor discards abandoned output publications on Retry (issue 3048)', () => {
  let executor: CoderAgentExecutor;
  let eventBus: ExecutionEventBus;

  beforeEach(() => {
    executor = new CoderAgentExecutor();
    eventBus = createRecordingEventBus();
  });

  /**
   * @plan PLAN-20260806-ISSUE3048.P05
   * @requirement REQ-3048-006
   * @scenario publishes only the replacement attempt's content
   */
  it('publishes only the replacement attempt content', async () => {
    const { task, publishedText } = createScriptedTask({
      firstTurnEvents: [
        textEvent('abandoned-1'),
        textEvent('abandoned-2'),
        retryEvent,
        textEvent('kept'),
        doneEvent(),
      ],
    });
    seedExecutor(executor, task);

    await executor.execute(createRequestContext(), eventBus);

    expect(publishedText).toEqual(['kept']);
  });

  /**
   * @plan PLAN-20260806-ISSUE3048.P05
   * @requirement REQ-3048-006
   * @scenario never publishes when the only content belonged to an abandoned attempt
   */
  it('never publishes when the only content belonged to an abandoned attempt', async () => {
    const { task, publishedText } = createScriptedTask({
      firstTurnEvents: [textEvent('abandoned'), retryEvent, doneEvent()],
    });
    seedExecutor(executor, task);

    await executor.execute(createRequestContext(), eventBus);

    expect(publishedText).toEqual([]);
  });

  /**
   * @plan PLAN-20260806-ISSUE3048.P05
   * @requirement REQ-3048-006
   * @scenario a commit point before the retry stays published; only the
   * post-retry attempt's later content is discarded then republished
   */
  it('keeps content committed before the retry and discards only the abandoned tail', async () => {
    const { task, publishedText } = createScriptedTask({
      firstTurnEvents: [
        textEvent('committed-at-tool-call'),
        toolCallEvent('kept'),
        textEvent('abandoned'),
        retryEvent,
        textEvent('kept-after-retry'),
        doneEvent(),
      ],
    });
    seedExecutor(executor, task);

    await executor.execute(createRequestContext(), eventBus);

    expect(publishedText).toEqual([
      'committed-at-tool-call',
      'kept-after-retry',
    ]);
  });

  /**
   * @plan PLAN-20260806-ISSUE3048.P05
   * @requirement REQ-3048-006
   * @scenario a retried turn still finishes to input-required
   */
  it('still finishes the turn to input-required after a retry', async () => {
    const { task, publishedStates } = createScriptedTask({
      firstTurnEvents: [textEvent('abandoned'), retryEvent, doneEvent()],
    });
    seedExecutor(executor, task);

    await executor.execute(createRequestContext(), eventBus);

    expect(publishedStates).toContain('input-required');
    expect(publishedStates[publishedStates.length - 1]).toBe('input-required');
  });
});
