/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4036: the interactive subagent loop treats a refused attempt as the
 * end of the run. The turn consumer reports it from the Finished event, and
 * the iteration skips the attempt's tool calls and the goal check.
 */

import { describe, expect, it } from 'bun:test';
import {
  SubagentTerminateMode,
  type OutputObject,
} from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import { GemmaToolCallParser } from '@vybestack/llxprt-code-core/parsers/TextToolCallParser.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { defaultRunConfig } from './__tests__/subagent-test-helpers.js';
import { runInteractiveIteration } from './subagent-interactive-iteration.js';
import { consumeInteractiveTurnOutput } from './subagent-interactive-output.js';
import type { ExecutionLoopContext } from './subagentExecution.js';
import { AgentEventType, type ServerAgentStreamEvent } from './turn.js';

function createContext(): ExecutionLoopContext {
  const output: OutputObject = {
    terminate_reason: SubagentTerminateMode.ERROR,
    emitted_vars: {},
  };
  return {
    output,
    subagentId: 'interactive-refusal-agent',
    runConfig: defaultRunConfig,
    textToolParser: new GemmaToolCallParser(),
    resolveToolName: (name) => name ?? null,
    logger: new DebugLogger('issue4036-interactive'),
  };
}

async function* events(
  ...items: ServerAgentStreamEvent[]
): AsyncGenerator<ServerAgentStreamEvent> {
  for (const item of items) yield item;
}

const finished = (reason: 'refusal' | 'stop'): ServerAgentStreamEvent => ({
  type: AgentEventType.Finished,
  value: { reason },
});

const NEXT_MESSAGES: IContent[] = [
  { speaker: 'human', blocks: [{ type: 'text', text: 'continue' }] },
];

describe('interactive subagent turn output (issue #4036)', () => {
  it('reports a turn that finished with a refusal', async () => {
    const output = await consumeInteractiveTurnOutput(
      events(finished('refusal')),
      new AbortController().signal,
      createContext(),
    );

    expect(output.refused).toBe(true);
  });

  it('does not report a turn that finished normally', async () => {
    const output = await consumeInteractiveTurnOutput(
      events(finished('stop')),
      new AbortController().signal,
      createContext(),
    );

    expect(output.refused).toBe(false);
  });

  it('forgets a refusal that a retry of the turn replaced', async () => {
    const output = await consumeInteractiveTurnOutput(
      events(
        finished('refusal'),
        { type: AgentEventType.Retry },
        finished('stop'),
      ),
      new AbortController().signal,
      createContext(),
    );

    expect(output.refused).toBe(false);
  });
});

describe('interactive subagent iteration (issue #4036)', () => {
  function iterate(refused: boolean): {
    readonly context: ExecutionLoopContext;
    readonly result: ReturnType<typeof runInteractiveIteration>;
  } {
    const context = createContext();
    const result = runInteractiveIteration(
      0,
      Date.now(),
      context,
      new AbortController().signal,
      {
        runTurn: async () => ({
          responseParts: [],
          textResponse: '',
          currentTurn: 0,
          reportedOutputTokens: undefined,
          outputCharacterCount: 0,
          refused,
        }),
        processTools: async () => null,
        checkGoal: async () => NEXT_MESSAGES,
      },
    );
    return { context, result };
  }

  it('stops without the goal check when the turn was refused', async () => {
    const { result } = iterate(true);

    expect(await result).toStrictEqual({ action: 'stop' });
  });

  it('ends the run with the REFUSAL mode', async () => {
    const { context, result } = iterate(true);
    await result;

    expect(context.output.terminate_reason).toBe(SubagentTerminateMode.REFUSAL);
  });

  it('runs the goal check after a turn that was not refused', async () => {
    const { result } = iterate(false);

    expect(await result).toStrictEqual({
      action: 'continue',
      messages: NEXT_MESSAGES,
      turnCounter: 1,
    });
  });
});
