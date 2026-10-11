/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  RootsListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { appendFile } from 'node:fs/promises';

const evidence = process.argv[2];
if (!evidence) throw new Error('Missing roots evidence file');
const server = new Server(
  { name: 'roots-evidence', version: '1.0.0' },
  { capabilities: { tools: {} } },
);
const capture = async (): Promise<void> => {
  const result = await server.listRoots();
  await appendFile(evidence, `${JSON.stringify(result.roots)}\n`);
};
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'roots_probe',
      description: 'Expose workspace roots notifications',
      inputSchema: { type: 'object' },
    },
  ],
}));
server.setNotificationHandler(RootsListChangedNotificationSchema, capture);
server.oninitialized = () => {
  void capture();
};
await server.connect(new StdioServerTransport());

const keepAlive = setInterval(() => {}, 1000);
server.onclose = () => clearInterval(keepAlive);
