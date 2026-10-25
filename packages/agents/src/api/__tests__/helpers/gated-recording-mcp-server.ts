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

const argument = (index: number): string | undefined => process.argv[index];
const effectsFile = argument(2);
const toolName = argument(3);
const releaseFile = argument(4);
if (!effectsFile || !toolName)
  throw new Error('Usage: <effects file> <tool name> [release file]');

const record = (entry: Record<string, unknown>): void =>
  appendFileSync(effectsFile, `${JSON.stringify(entry)}\n`);

const server = new Server(
  { name: 'gated-recording-fixture', version: '1.0.0' },
  { capabilities: { tools: {} } },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: toolName,
      description: 'Record the call and optionally wait for a release file',
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
  return { content: [{ type: 'text', text: 'recorded' }] };
});
await server.connect(new StdioServerTransport());
