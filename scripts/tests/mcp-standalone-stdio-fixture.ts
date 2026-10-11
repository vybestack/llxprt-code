/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { appendFileSync, writeFileSync } from 'node:fs';

const evidence = process.argv[2];
if (!evidence) throw new Error('Missing stdio evidence directory');
writeFileSync(`${evidence}/server.pid`, String(process.pid));
process.on('exit', (code) => {
  writeFileSync(`${evidence}/server.exit`, String(code));
});
const record = (method: string): void => {
  appendFileSync(`${evidence}/requests`, `${method}\n`);
};
const server = new Server(
  { name: 'standalone-fixture', version: '1.0.0' },
  {
    capabilities: { tools: {}, prompts: {}, resources: {} },
    instructions: 'Use arithmetic locally.',
  },
);
server.setRequestHandler(ListToolsRequestSchema, async () => {
  record('tools/list');
  return {
    tools: [
      {
        name: 'sum',
        description: 'Add two numbers',
        inputSchema: {
          type: 'object',
          properties: { a: { type: 'number' }, b: { type: 'number' } },
          required: ['a', 'b'],
        },
      },
    ],
  };
});
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  record('tools/call');
  const { a, b } = params.arguments ?? {};
  if (params.name !== 'sum' || typeof a !== 'number' || typeof b !== 'number')
    throw new Error('Invalid sum request');
  return { content: [{ type: 'text', text: String(a + b) }] };
});
server.setRequestHandler(ListPromptsRequestSchema, async () => {
  record('prompts/list');
  return {
    prompts: [
      { name: 'explain', arguments: [{ name: 'value', required: true }] },
    ],
  };
});
server.setRequestHandler(GetPromptRequestSchema, async ({ params }) => {
  record('prompts/get');
  if (params.name !== 'explain') throw new Error('Unknown prompt');
  return {
    messages: [
      {
        role: 'user',
        content: { type: 'text', text: `Explain ${params.arguments?.value}` },
      },
    ],
  };
});
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  record('resources/list');
  return { resources: [{ uri: 'fixture:///arithmetic', name: 'arithmetic' }] };
});
server.setRequestHandler(ReadResourceRequestSchema, async ({ params }) => {
  record('resources/read');
  if (params.uri !== 'fixture:///arithmetic')
    throw new Error('Unknown resource');
  return {
    contents: [{ uri: params.uri, text: 'Addition combines quantities.' }],
  };
});
await server.connect(new StdioServerTransport());
