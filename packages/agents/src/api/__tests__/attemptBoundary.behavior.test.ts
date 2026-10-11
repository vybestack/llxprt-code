/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3840: continuation attempts inside one prompt must be separable by
 * consumers. The orchestrator re-prompts the model while the task list has active items (and
 * after thinking-only turns); every attempt's text used to arrive as one
 * undifferentiated run of `text` events.
 *
 * These tests drive the PUBLIC `agent.stream()` over a real FakeProvider (the
 * LLXPRT_FAKE_RESPONSES production seam) with a real task-list write tool call, so
 * the real MessageStreamOrchestrator retry loop produces the attempts. They
 * assert the consumer-visible `attempt-boundary` signal and that the signal is
 * presentation-only: the conversation history (the source of both the provider
 * request and the session recording) holds each attempt's text verbatim.
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'bun:test';
import { ApprovalMode } from '@vybestack/llxprt-code-agents';
import type { AgentEvent } from '@vybestack/llxprt-code-agents';
import { buildAgentFromContent, drain } from './helpers/agentHarness.js';

type Turn = { readonly chunks: readonly object[] };

function aiTurn(...blocks: readonly object[]): Turn {
  return { chunks: [{ speaker: 'ai', blocks }] };
}

function textTurn(text: string): Turn {
  return aiTurn({ type: 'text', text });
}

function thinkingOnlyTurn(thought: string): Turn {
  return aiTurn({ type: 'thinking', thought });
}

function createActiveTodoTurn(): Turn {
  return aiTurn({
    type: 'tool_call',
    id: 'call-todo-1',
    name: 'todo_write',
    parameters: {
      todos: [
        {
          id: '1',
          content: 'write the quarterly report',
          status: 'pending',
        },
      ],
    },
  });
}

/** A task-list write whose only item is already done, so no continuation follows. */
function completedTodoBlock(): object {
  return {
    type: 'tool_call',
    id: 'call-todo-done',
    name: 'todo_write',
    parameters: {
      todos: [{ id: '1', content: 'write it', status: 'completed' }],
    },
  };
}

function toJsonl(turns: readonly Turn[]): string {
  return turns.map((turn) => JSON.stringify(turn)).join('\n') + '\n';
}

/** Public-event trace used to assert ordering without casts. */
function traceOf(events: readonly AgentEvent[]): string[] {
  const trace: string[] = [];
  for (const event of events) {
    if (event.type === 'text') trace.push(`text:${event.text}`);
    else if (event.type === 'thinking') trace.push('thinking');
    else if (event.type === 'tool-call') trace.push(`tool:${event.call.name}`);
    else if (event.type === 'attempt-boundary') trace.push('boundary');
  }
  return trace;
}

describe('attempt boundaries across continuation attempts (issue #3840)', () => {
  async function run(
    turns: readonly Turn[],
  ): Promise<{ events: AgentEvent[]; aiTexts: string[] }> {
    const { agent, cleanup } = await buildAgentFromContent(toJsonl(turns), {
      approvalMode: ApprovalMode.YOLO,
      // The task-list tool and the continuation reader key the persisted list by
      // session id; without one they read different files and no attempt is
      // ever retried. Storage roots are isolated by the package test preload.
      sessionId: `attempt-boundary-${randomUUID()}`,
    });
    try {
      const events = await drain(agent.stream('do the work'));
      const history = await agent.getHistory();
      const aiTexts = history
        .filter((message) => message.speaker === 'ai')
        .flatMap((message) => message.blocks)
        .flatMap((block) => (block.type === 'text' ? [block.text] : []));
      return { events, aiTexts };
    } finally {
      await cleanup();
    }
  }

  // PLAN #3840 test 7
  it('marks a boundary before each later attempt that follows visible output, without touching the history', async () => {
    const { events, aiTexts } = await run([
      createActiveTodoTurn(),
      textTurn('attempt1'),
      textTurn('attempt2'),
      textTurn('attempt3'),
    ]);

    expect(traceOf(events)).toStrictEqual([
      'tool:todo_write',
      'text:attempt1',
      'boundary',
      'text:attempt2',
      'boundary',
      'text:attempt3',
    ]);
    // History feeds both the provider request and the session recording.
    expect(aiTexts).toStrictEqual(['attempt1', 'attempt2', 'attempt3']);
  });

  // PLAN #3840 test 9 (orchestrator side): single attempt is unchanged
  it('emits no boundary for a single-attempt run', async () => {
    const { events, aiTexts } = await run([textTurn('only answer')]);

    expect(traceOf(events)).toStrictEqual(['text:only answer']);
    expect(aiTexts).toStrictEqual(['only answer']);
  });

  // PLAN #3840 test 10 (orchestrator side): the orchestrator marks every later
  // attempt after an attempt that produced any output, thinking included.
  // Deciding whether a separator is needed (nothing shown yet, already at a
  // paragraph break) is the consumer's job.
  it('marks a boundary before visible text that follows a thinking-only attempt', async () => {
    const { events } = await run([
      thinkingOnlyTurn('pondering'),
      textTurn('first visible answer'),
    ]);

    expect(traceOf(events)).toStrictEqual([
      'thinking',
      'boundary',
      'text:first visible answer',
    ]);
  });

  it('places a boundary before the thinking of a later thinking-only attempt and before the text after it', async () => {
    const { events } = await run([
      createActiveTodoTurn(),
      textTurn('attempt1'),
      thinkingOnlyTurn('pondering'),
      textTurn('attempt3'),
    ]);

    expect(traceOf(events)).toStrictEqual([
      'tool:todo_write',
      'text:attempt1',
      'boundary',
      'thinking',
      'boundary',
      'text:attempt3',
    ]);
  });

  it('marks every consecutive thinking-only attempt after visible output', async () => {
    const { events } = await run([
      createActiveTodoTurn(),
      textTurn('attempt1'),
      thinkingOnlyTurn('pondering'),
      thinkingOnlyTurn('still pondering'),
    ]);

    expect(traceOf(events)).toStrictEqual([
      'tool:todo_write',
      'text:attempt1',
      'boundary',
      'thinking',
      'boundary',
      'thinking',
    ]);
  });

  // (a) a later attempt that only thinks and calls a tool still starts a new
  // paragraph: the boundary precedes its Thought, not just its Content.
  it('marks the boundary before the Thought of a later attempt that has no Content', async () => {
    const { events } = await run([
      createActiveTodoTurn(),
      textTurn('attempt1'),
      aiTurn(
        { type: 'thinking', thought: 'second thoughts' },
        {
          type: 'tool_call',
          id: 'call-todo-2',
          name: 'todo_write',
          parameters: {
            todos: [{ id: '1', content: 'write it', status: 'completed' }],
          },
        },
      ),
      textTurn('all done'),
    ]);

    expect(traceOf(events).slice(0, 5)).toStrictEqual([
      'tool:todo_write',
      'text:attempt1',
      'boundary',
      'thinking',
      'tool:todo_write',
    ]);
  });

  // (c) the exact -p reproduction: a task-list write, then `READY` while the
  // list is active, then a continuation attempt that thinks and calls the
  // pause tool with no Content.
  it('separates the READY attempt from a continuation attempt that only thinks and pauses', async () => {
    const { events } = await run([
      createActiveTodoTurn(),
      textTurn('READY'),
      aiTurn(
        { type: 'thinking', thought: 'Awaiting report data' },
        {
          type: 'tool_call',
          id: 'call-pause-1',
          name: 'todo_pause',
          parameters: { reason: 'Awaiting report data' },
        },
      ),
      textTurn('paused'),
    ]);

    const trace = traceOf(events);
    expect(trace.slice(0, 5)).toStrictEqual([
      'tool:todo_write',
      'text:READY',
      'boundary',
      'thinking',
      'tool:todo_pause',
    ]);
  });

  // (d) an ordinary prompt: tool call, tool response, final answer. The
  // tool-response follow-up is a separate sendMessageStream call, so nothing
  // is separated.
  it('adds no boundary to a tool call followed by a final answer', async () => {
    const { events } = await run([
      aiTurn({ type: 'thinking', thought: 'planning' }, completedTodoBlock()),
      textTurn('final answer'),
    ]);

    expect(traceOf(events)).toStrictEqual([
      'thinking',
      'tool:todo_write',
      'text:final answer',
    ]);
  });
});
