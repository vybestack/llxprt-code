/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { PassThrough } from 'node:stream';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from 'vscode-jsonrpc/node.js';

import {
  createMcpChannel,
  type McpOrchestrator,
} from '../src/channels/mcp-channel.js';
import {
  createMcpTunnel,
  MCP_TUNNEL_FROM_SERVICE,
  MCP_TUNNEL_TO_SERVICE,
  type McpTunnelChunk,
} from '../src/channels/mcp-tunnel.js';

const orchestrator: McpOrchestrator = {
  gotoDefinition: async () => [],
  findReferences: async () => [],
  hover: async (filePath) => `hover for ${filePath}`,
  documentSymbols: async () => [],
  workspaceSymbols: async (query) => [
    {
      name: query,
      kind: 12,
      location: {
        uri: 'file:///workspace/src/a.ts',
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
      },
    },
  ],
  getAllDiagnostics: async () => ({}),
};

/** The wire contract: newline-delimited MCP messages inside notifications. */
class NotificationTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  private buffer = '';

  constructor(private readonly connection: MessageConnection) {}

  async start(): Promise<void> {
    this.connection.onNotification(
      MCP_TUNNEL_FROM_SERVICE,
      (chunk: McpTunnelChunk) => {
        this.buffer += chunk.data;
        for (
          let newline = this.buffer.indexOf('\n');
          newline !== -1;
          newline = this.buffer.indexOf('\n')
        ) {
          const line = this.buffer.slice(0, newline);
          this.buffer = this.buffer.slice(newline + 1);
          this.onmessage?.(JSON.parse(line) as JSONRPCMessage);
        }
      },
    );
  }

  async send(message: JSONRPCMessage): Promise<void> {
    await this.connection.sendNotification(MCP_TUNNEL_TO_SERVICE, {
      data: `${JSON.stringify(message)}\n`,
    });
  }

  async close(): Promise<void> {
    this.onclose?.();
  }
}

describe('MCP tunnel over the service JSON-RPC connection', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      await cleanup();
    }
  });

  async function connectClient(): Promise<Client> {
    const toService = new PassThrough();
    const fromService = new PassThrough();
    const service = createMessageConnection(
      new StreamMessageReader(toService),
      new StreamMessageWriter(fromService),
    );
    const peer = createMessageConnection(
      new StreamMessageReader(fromService),
      new StreamMessageWriter(toService),
    );
    const tunnel = createMcpTunnel(service);
    service.listen();
    peer.listen();
    const server = await createMcpChannel(
      orchestrator,
      '/workspace',
      tunnel.input,
      tunnel.output,
    );
    const client = new Client({ name: 'tunnel-test', version: '0.1.0' });
    await client.connect(new NotificationTransport(peer));
    cleanups.push(async () => {
      await client.close();
      await server.close();
      service.dispose();
      peer.dispose();
    });
    return client;
  }

  it('answers MCP initialize and tool listing without extra descriptors', async () => {
    const client = await connectClient();

    const tools = await client.listTools();

    expect(tools.tools.map((tool) => tool.name)).toContain('lsp_hover');
  });

  it('round-trips tool calls including multi-byte text', async () => {
    const client = await connectClient();

    const result = await client.callTool({
      name: 'lsp_workspace_symbols',
      arguments: { query: 'シンボル🙂' },
    });

    expect(JSON.stringify(result)).toContain('シンボル🙂');
  });
});
