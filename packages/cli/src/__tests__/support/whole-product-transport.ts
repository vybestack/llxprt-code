/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { mixedText } from '../../../../agents/src/core/__tests__/support/journal-retained-growth-text.js';

const requestSchema = z.object({
  messages: z.array(z.object({ role: z.string(), content: z.unknown() })),
});

export function heapText(turn: number, payloadBytes = 65_536): string {
  return `W24 turn ${turn}\n${mixedText(turn, payloadBytes)}`;
}

function response(root: string, turn: number, tool: boolean): string {
  const delta = tool
    ? {
        role: 'assistant',
        tool_calls: [
          {
            index: 0,
            id: `receipt-${turn}`,
            type: 'function',
            function: {
              name: 'write_file',
              arguments: JSON.stringify({
                file_path: join(root, 'heap-receipt.txt'),
                content: `turn ${turn}\n`,
              }),
            },
          },
        ],
      }
    : {
        role: 'assistant',
        content:
          '<state_snapshot>Continue the W24 receipt workload.</state_snapshot>',
      };
  return (
    [
      { choices: [{ index: 0, delta, finish_reason: null }] },
      {
        choices: [
          { index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' },
        ],
      },
    ]
      .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
      .join('') + 'data: [DONE]\n\n'
  );
}

export function startWholeProductTransport(): {
  readonly url: string;
  readonly server: Bun.Server<undefined>;
  bind(root: string): void;
  receipt(): { requests: number; toolRounds: number; inputHash: string };
} {
  let root = '';
  let requests = 0;
  let toolRounds = 0;
  const digest = createHash('sha256');
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request): Promise<Response> {
      const parsed = requestSchema.parse(await request.json());
      requests++;
      let index = parsed.messages.length - 1;
      while (index >= 0 && parsed.messages[index]?.role !== 'user') index--;
      const latest = index < 0 ? undefined : parsed.messages[index];
      const text = typeof latest?.content === 'string' ? latest.content : '';
      const turn = Number(/^W24 turn (\d+)/.exec(text)?.[1] ?? -1);
      const tool =
        turn >= 0 && turn % 10 === 4 && parsed.messages.at(-1)?.role !== 'tool';
      if (tool) toolRounds++;
      digest.update(`${turn}:${parsed.messages.length}:${tool}\n`);
      return new Response(response(root, turn, tool), {
        headers: { 'content-type': 'text/event-stream' },
      });
    },
  });
  return {
    server,
    url: `http://127.0.0.1:${server.port}/v1`,
    bind: (directory): void => {
      root = directory;
    },
    receipt: () => ({
      requests,
      toolRounds,
      inputHash: digest.copy().digest('hex'),
    }),
  };
}
