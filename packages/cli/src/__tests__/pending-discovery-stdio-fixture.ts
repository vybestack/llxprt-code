/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';

const gate = process.argv[2];
if (!gate) throw new Error('Missing discovery gate path');
const server = new Server(
  { name: 'pending-discovery', version: '1.0.0' },
  { capabilities: { tools: {} } },
);
server.setRequestHandler(ListToolsRequestSchema, async () => {
  if (existsSync(`${gate}.block`)) {
    await writeFile(`${gate}.entered`, 'entered');
    while (!existsSync(`${gate}.released`)) await setTimeout(10);
  }
  return {
    tools: [
      {
        name: 'pending_probe',
        description: 'Discovery probe',
        inputSchema: { type: 'object', properties: {} },
      },
    ],
  };
});
await server.connect(new StdioServerTransport());
