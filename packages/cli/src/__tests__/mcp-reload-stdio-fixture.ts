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

const [pidFile, toolName] = process.argv.slice(2);
if (!pidFile || !toolName)
  throw new Error('Usage: mcp-reload-stdio-fixture <pidFile> <toolName>');
writeFileSync(pidFile, String(process.pid));
const server = new Server(
  { name: 'mcp-reload-fixture', version: '1.0.0' },
  { capabilities: { tools: {} } },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: toolName,
      description: `Reports ${toolName}`,
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  ],
}));
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  if (params.name !== toolName) throw new Error('Unknown tool');
  return { content: [{ type: 'text', text: toolName }] };
});
await server.connect(new StdioServerTransport());
