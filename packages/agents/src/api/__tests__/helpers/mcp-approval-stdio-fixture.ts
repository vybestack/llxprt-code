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
import { writeFileSync } from 'node:fs';

const pidFile = process.argv[2];
if (!pidFile) throw new Error('Missing server PID file');
writeFileSync(pidFile, String(process.pid));
const server = new Server(
  { name: 'approval-isolation-fixture', version: '1.0.0' },
  { capabilities: { tools: {} } },
);
let calls = 0;
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: ['increment', 'other'].map((name) => ({
    name,
    description: 'Increment the process-local counter',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  })),
}));
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  if (!['increment', 'other'].includes(params.name))
    throw new Error('Unknown tool');
  calls += 1;
  return { content: [{ type: 'text', text: String(calls) }] };
});
await server.connect(new StdioServerTransport());
