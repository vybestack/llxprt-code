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
import { appendFileSync, writeFileSync } from 'node:fs';

const [pidFile, marker] = process.argv.slice(2);
if (!pidFile || !marker) throw new Error('Missing fixture paths');
writeFileSync(pidFile, String(process.pid));
writeFileSync(marker, '');
const server = new Server(
  { name: 'scheduler-approval-fixture', version: '1.0.0' },
  { capabilities: { tools: {} } },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'increment',
      description: 'Record a harmless invocation',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  ],
}));
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  if (params.name !== 'increment') throw new Error('Unknown tool');
  appendFileSync(marker, 'invoked\n');
  return { content: [{ type: 'text', text: 'Invocation recorded.' }] };
});
await server.connect(new StdioServerTransport());
