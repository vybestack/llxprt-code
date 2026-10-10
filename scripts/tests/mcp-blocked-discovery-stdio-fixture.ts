/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { writeFileSync } from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const marker = process.argv[2];
if (!marker) throw new Error('Missing discovery marker');
const server = new Server(
  { name: 'blocked-discovery', version: '1' },
  { capabilities: { tools: {} }, instructions: 'Blocked owner instructions.' },
);
server.setRequestHandler(ListToolsRequestSchema, async () => {
  writeFileSync(marker, String(process.pid));
  return new Promise<never>(() => {});
});
await server.connect(new StdioServerTransport());
