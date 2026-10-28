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
import { readdir } from 'node:fs/promises';

const [listingDirectory, toolName] = process.argv.slice(2);
if (!listingDirectory || !toolName)
  throw new Error('Usage: <listing directory> <tool name>');

const server = new Server(
  { name: 'scripted-headless-listing', version: '1.0.0' },
  { capabilities: { tools: {} } },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: toolName,
      description: 'List fixture files',
      inputSchema: {
        type: 'object',
        properties: { command: { type: 'string', enum: ['ls'] } },
        required: ['command'],
      },
    },
  ],
}));
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  if (params.name !== toolName) throw new Error('Unknown tool');
  if (params.arguments?.command !== 'ls')
    throw new Error('Expected the fixture directory listing command');
  const listing = (await readdir(listingDirectory)).sort().join('\n');
  return { content: [{ type: 'text', text: listing }] };
});
await server.connect(new StdioServerTransport());
