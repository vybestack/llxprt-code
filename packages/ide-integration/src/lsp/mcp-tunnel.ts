/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { PassThrough, Writable, type Readable } from 'node:stream';
import type { MessageConnection } from 'vscode-jsonrpc/node.js';

/**
 * Client side of the navigation MCP channel. Bytes travel as JSON-RPC
 * notifications on the LSP service's stdio connection; the method names must
 * match packages/lsp/src/channels/mcp-tunnel.ts. Extra inherited descriptors
 * are not usable between Bun processes on Windows (oven-sh/bun#11044).
 */
const TO_SERVICE = 'mcp/toService';
const FROM_SERVICE = 'mcp/fromService';

interface McpTunnelChunk {
  data: string;
}

export interface McpClientTunnel {
  readonly readable: Readable;
  readonly writable: Writable;
  /** Ends the readable side so the MCP transport observes the close. */
  close(): void;
}

export function createMcpClientTunnel(
  connection: MessageConnection,
): McpClientTunnel {
  const readable = new PassThrough();
  connection.onNotification(FROM_SERVICE, (chunk: McpTunnelChunk) => {
    readable.write(chunk.data);
  });

  const writable = new Writable({
    decodeStrings: false,
    write(chunk: string | Buffer, _encoding, callback) {
      const data = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      connection
        .sendNotification(TO_SERVICE, { data })
        .then(() => callback(), callback);
    },
  });

  return { readable, writable, close: () => readable.end() };
}
