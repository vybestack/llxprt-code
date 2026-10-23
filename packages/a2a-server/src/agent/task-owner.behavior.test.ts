/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import type { Agent, AgentEvent } from '@vybestack/llxprt-code-agents';
import { useCommandOwners } from '../../../cli/src/__tests__/command-owner-fixture.js';
import { Task } from './task.js';
import { RequestContext } from '@a2a-js/sdk/server';

function ownedTask(agent: Agent): Task {
  return new Task(
    'task-owner',
    'context-owner',
    (input, options) => agent.stream(input, options),
    (text) => agent.injectSteer(text),
    () => agent.getModel(),
    () => agent.getProvider(),
    () => agent.listTools(),
    () => agent.mcp.listServers(),
    (id, decision, payload, requiresConfirmation) =>
      agent.tools.respondToConfirmation(
        id,
        decision,
        payload,
        requiresConfirmation,
      ),
    () => agent.dispose(),
  );
}

async function collect(task: Task): Promise<readonly AgentEvent[]> {
  const events: AgentEvent[] = [];
  const request = new RequestContext(
    {
      kind: 'message',
      role: 'user',
      messageId: crypto.randomUUID(),
      parts: [{ kind: 'text', text: 'task-owned request' }],
    },
    task.id,
    task.contextId,
  );
  for await (const event of task.acceptUserMessage(
    request,
    new AbortController().signal,
  ))
    events.push(event);
  return events;
}

describe('task session operation ownership', () => {
  const makeOwner = useCommandOwners();
  it('streams with bound operations and leaves a sibling task alive after retirement', async () => {
    const owner = await makeOwner('task-session-owner');
    const sibling = await makeOwner('task-session-sibling');
    const task = ownedTask(owner);
    const siblingTask = ownedTask(sibling);
    expect((await collect(task)).map((event) => event.type)).toContain('done');
    expect(JSON.stringify(await owner.getHistory())).toContain(
      'task-owned request',
    );
    expect(await sibling.getHistory()).toHaveLength(0);
    await task.dispose();
    expect((await collect(siblingTask)).map((event) => event.type)).toContain(
      'done',
    );
    expect(JSON.stringify(await sibling.getHistory())).toContain(
      'task-owned request',
    );
  });
});
