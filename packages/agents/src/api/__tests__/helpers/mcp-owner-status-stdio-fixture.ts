/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { writeFileSync } from 'node:fs';

const pidFile = process.argv[2];
if (!pidFile) throw new Error('Missing server PID file');
writeFileSync(pidFile, String(process.pid));
const server = new Server(
  { name: 'owner-status-fixture', version: '1.0.0' },
  { capabilities: { resources: {} } },
);
let reads = 0;
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [{ uri: 'fixture:///counter', name: 'counter' }],
}));
server.setRequestHandler(ReadResourceRequestSchema, async ({ params }) => {
  if (params.uri !== 'fixture:///counter') throw new Error('Unknown resource');
  reads += 1;
  return { contents: [{ uri: params.uri, text: String(reads) }] };
});
await server.connect(new StdioServerTransport());
