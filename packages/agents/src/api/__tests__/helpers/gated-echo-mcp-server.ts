/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { appendFileSync, existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const positional = process.argv.slice(2);
const argument = (index: number): string | undefined => positional[index];
const effectsFile = argument(0);
const toolName = argument(1);
const outputPrefix = argument(2);
const releaseFile = argument(3);
if (!effectsFile || !toolName || !outputPrefix)
  throw new Error(
    'Usage: <effects file> <tool name> <output prefix> [release file]',
  );

const record = (entry: Record<string, unknown>): void =>
  appendFileSync(effectsFile, `${JSON.stringify(entry)}\n`);

const server = new Server(
  { name: 'gated-echo-fixture', version: '1.0.0' },
  { capabilities: { tools: {} } },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: toolName,
      description: 'Record the call, wait for a release file, echo the call',
      inputSchema: { type: 'object', additionalProperties: true },
    },
  ],
}));
server.setRequestHandler(CallToolRequestSchema, async ({ params }, extra) => {
  if (params.name !== toolName) throw new Error('Unknown tool');
  record({ event: 'entered', arguments: params.arguments });
  while (releaseFile !== undefined && !existsSync(releaseFile)) {
    extra.signal.throwIfAborted();
    await sleep(10);
  }
  record({ event: 'finished' });
  return {
    content: [
      {
        type: 'text',
        text: `${outputPrefix}:${String(params.arguments?.invocation)}`,
      },
    ],
  };
});
await server.connect(new StdioServerTransport());
