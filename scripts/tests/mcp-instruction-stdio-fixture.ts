/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListPromptsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const instructionPath = process.argv[2];
if (!instructionPath) throw new Error('Missing instruction file');
const server = new Server(
  { name: 'same-instruction-server', version: '1' },
  {
    capabilities: { tools: {}, resources: {}, prompts: {} },
    instructions: readFileSync(instructionPath, 'utf8'),
  },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'instruction_probe',
      description: 'Instruction fixture probe',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
}));
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [],
}));
server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: [],
}));
await server.connect(new StdioServerTransport());
