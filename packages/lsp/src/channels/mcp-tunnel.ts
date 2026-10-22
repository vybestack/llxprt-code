/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { PassThrough, Writable, type Readable } from 'node:stream';

import type { MessageConnection } from 'vscode-jsonrpc/node.js';

/**
 * The navigation MCP channel is carried as JSON-RPC notifications on the same
 * stdio connection as every other service message. Extra inherited
 * descriptors (3/4) are not usable from a Bun child on Windows
 * (oven-sh/bun#11044), so the channel must not depend on them.
 */
export const MCP_TUNNEL_TO_SERVICE = 'mcp/toService';
export const MCP_TUNNEL_FROM_SERVICE = 'mcp/fromService';

export interface McpTunnelChunk {
  data: string;
}

export interface McpTunnel {
  /** Bytes the client sent to the MCP server. */
  readonly input: Readable;
  /** Bytes the MCP server sends to the client. */
  readonly output: Writable;
}

export function createMcpTunnel(connection: MessageConnection): McpTunnel {
  const input = new PassThrough();
  connection.onNotification(MCP_TUNNEL_TO_SERVICE, (chunk: McpTunnelChunk) => {
    input.write(chunk.data);
  });

  const output = new Writable({
    decodeStrings: false,
    write(chunk: string | Buffer, _encoding, callback) {
      const data = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      connection
        .sendNotification(MCP_TUNNEL_FROM_SERVICE, { data })
        .then(() => callback(), callback);
    },
  });

  return { input, output };
}
