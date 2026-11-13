/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4036: a refusal-recovery notice (retry progress, the summary when
 * recovery gives up) is appended to the a2a task as text, like the refusal
 * safety notice. The executor's private turn loop is driven through the public
 * execute() entry point with a recording Task double, and the assertions are
 * on what the task published.
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import type { ExecutionEventBus, RequestContext } from '@a2a-js/sdk/server';
import type { AgentEvent } from '@vybestack/llxprt-code-agents';
import { CoderAgentExecutor } from '../executor.js';
import type { Task } from '../task.js';

const NOTICE_MESSAGE =
  'Model m refused the request; retrying in 15 s (retry 1 of 2).';
const NOTICE: AgentEvent = {
  type: 'notice',
  source: 'refusal-recovery',
  message: NOTICE_MESSAGE,
};

function createScriptedTask(events: readonly AgentEvent[]): {
  task: Task;
  publishedText: string[];
} {
  const publishedText: string[] = [];
  const task = {
    id: 'notice-task',
    contextId: 'notice-context',
    taskState: 'working',
    eventBus: undefined,
    async *acceptUserMessage(): AsyncGenerator<AgentEvent, void, unknown> {
      for (const event of events) yield event;
    },
    async sendTextContent(text: string): Promise<void> {
      publishedText.push(text);
    },
    async sendThought(): Promise<void> {},
    async handleModelInfo(): Promise<void> {},
    setTaskStateAndPublishUpdate(): void {},
    cancelPendingTools(): void {},
  } as unknown as Task;
  return { task, publishedText };
}

const eventBus = {
  publish: () => {},
  on: () => {},
  off: () => {},
  once: () => {},
  removeAllListeners: () => {},
  finished: () => {},
} as unknown as ExecutionEventBus;

const requestContext = {
  userMessage: {
    role: 'user',
    parts: [{ kind: 'text', text: 'go' }],
    messageId: 'm-1',
    kind: 'message',
    contextId: 'notice-context',
    taskId: 'notice-task',
  },
} as unknown as RequestContext;

async function publishedFor(events: readonly AgentEvent[]): Promise<string[]> {
  const executor = new CoderAgentExecutor();
  const { task, publishedText } = createScriptedTask(events);
  const internals = executor as unknown as {
    tasks: Map<
      string,
      { task: Task; agentSettings: unknown; toSDKTask: () => unknown }
    >;
  };
  internals.tasks.set('notice-task', {
    task,
    agentSettings: {},
    toSDKTask: () => task,
  });
  await executor.execute(requestContext, eventBus);
  return publishedText;
}

describe('a2a executor refusal-recovery notices (issue #4036)', () => {
  let published: string[];

  beforeEach(() => {
    published = [];
  });

  it('appends the notice to the task as text', async () => {
    published = await publishedFor([
      NOTICE,
      { type: 'text', text: 'the answer' },
      { type: 'done', reason: 'stop' },
    ]);

    expect(published).toStrictEqual([
      `\n\n[recovery notice] ${NOTICE_MESSAGE}`,
      'the answer',
    ]);
  });

  it('publishes the notice but not the refused attempt text', async () => {
    published = await publishedFor([
      { type: 'text', text: 'I cannot help with that.' },
      { type: 'retry' },
      NOTICE,
      { type: 'text', text: 'the answer' },
      { type: 'done', reason: 'stop' },
    ]);

    expect(published.join('')).not.toContain('I cannot help');
    expect(published.join('')).toContain('retrying in 15 s');
  });

  it('ignores a notice that has no source', async () => {
    published = await publishedFor([
      { type: 'notice', message: 'MCP server x discovery failed' },
      { type: 'done', reason: 'stop' },
    ]);

    expect(published).toStrictEqual([]);
  });
});
