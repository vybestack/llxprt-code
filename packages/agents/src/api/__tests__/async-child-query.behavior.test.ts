/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { withDisposalJoinFixture } from './helpers/async-child-disposal-join-fixture.js';

function response(query: boolean): Response {
  const delta = query
    ? {
        role: 'assistant',
        tool_calls: [
          {
            index: 0,
            id: 'child-query',
            type: 'function',
            function: { name: 'check_async_tasks', arguments: '{}' },
          },
        ],
      }
    : { role: 'assistant', content: 'Query complete.' };
  return new Response(
    [
      {
        id: 'child-query-response',
        object: 'chat.completion.chunk',
        model: 'child-model',
        choices: [{ index: 0, delta, finish_reason: null }],
      },
      {
        id: 'child-query-response',
        object: 'chat.completion.chunk',
        choices: [
          { index: 0, delta: {}, finish_reason: query ? 'tool_calls' : 'stop' },
        ],
      },
    ]
      .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
      .join('') + 'data: [DONE]\n\n',
    { headers: { 'Content-Type': 'text/event-stream' } },
  );
}

describe('public async child query ownership', () => {
  it('runs a child-issued query against its owner without exposing a borrowed-Config sibling', async () => {
    await withDisposalJoinFixture(async (fixture) => {
      const sibling = await fixture.adoptSibling();
      const siblingTool = sibling.tools.get('task');
      const task = fixture.agent.tools.get('task');
      if (!siblingTool || !task) throw new Error('Missing task');
      expect(
        (
          await siblingTool.buildAndExecute(
            {
              subagent_name: 'sibling-child',
              goal_prompt: 'Wait.',
              async: true,
            },
            new AbortController().signal,
          )
        ).error,
      ).toBeUndefined();
      await fixture.siblingWork.entered.promise;
      const siblingId = sibling.tasks.list()[0].id;
      const original = globalThis.fetch;
      const toolResults: string[] = [];
      let requests = 0;
      globalThis.fetch = async (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        if (!url.endsWith('/child/chat/completions'))
          return original(input, init);
        const body = z
          .object({
            messages: z.array(
              z.object({ role: z.string(), content: z.unknown().optional() }),
            ),
          })
          .parse(await new Request(input, init).json());
        for (const message of body.messages) {
          if (message.role === 'tool')
            toolResults.push(JSON.stringify(message.content));
        }
        requests += 1;
        return response(requests === 1);
      };
      try {
        expect(
          (
            await task.buildAndExecute(
              {
                subagent_name: 'disposal-child',
                goal_prompt: 'List background tasks.',
                async: true,
              },
              new AbortController().signal,
            )
          ).error,
        ).toBeUndefined();
        const childId = fixture.agent.tasks.list()[0].id;
        expect(await fixture.childStatus).toBe('completed');
        expect(requests).toBe(2);
        expect(toolResults).toHaveLength(1);
        expect(toolResults[0]).toContain(childId);
        expect(toolResults[0]).not.toContain(siblingId);
        expect(fixture.siblingWork.signal()?.aborted).toBe(false);
      } finally {
        globalThis.fetch = original;
        fixture.siblingWork.releaseWork();
        await sibling.dispose();
      }
    });
  }, 30000);
});
