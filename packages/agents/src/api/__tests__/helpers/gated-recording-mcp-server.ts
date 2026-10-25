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

const DISCOVERY_RELEASE_FLAG = '--discovery-release=';
const discoveryReleaseFile = process.argv
  .find((entry) => entry.startsWith(DISCOVERY_RELEASE_FLAG))
  ?.slice(DISCOVERY_RELEASE_FLAG.length);
const positional = process.argv
  .slice(2)
  .filter((entry) => !entry.startsWith('--'));
const argument = (index: number): string | undefined => positional[index];
const effectsFile = argument(0);
const toolName = argument(1);
const releaseFile = argument(2);
if (!effectsFile || !toolName)
  throw new Error(
    'Usage: <effects file> <tool name> [release file] [--discovery-release=<file>]',
  );

const record = (entry: Record<string, unknown>): void =>
  appendFileSync(effectsFile, `${JSON.stringify(entry)}\n`);

const server = new Server(
  { name: 'gated-recording-fixture', version: '1.0.0' },
  { capabilities: { tools: {} } },
);
server.setRequestHandler(ListToolsRequestSchema, async (_request, extra) => {
  if (discoveryReleaseFile !== undefined) {
    record({ event: 'discovery-entered' });
    while (!existsSync(discoveryReleaseFile)) {
      extra.signal.throwIfAborted();
      await sleep(10);
    }
  }
  return {
    tools: [
      {
        name: toolName,
        description: 'Record the call and optionally wait for a release file',
        inputSchema: { type: 'object', additionalProperties: true },
      },
    ],
  };
});
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
