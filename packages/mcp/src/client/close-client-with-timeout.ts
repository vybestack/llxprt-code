/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

const MCP_CLIENT_CLOSE_TIMEOUT_MS = 10_000;

export async function closeClientWithTimeout(
  client: Client,
  serverName: string,
): Promise<void> {
  const deadline = new AbortController();
  const timeout = setTimeout(
    () =>
      deadline.abort(
        new Error(
          `Timed out closing MCP client '${serverName}' after ${MCP_CLIENT_CLOSE_TIMEOUT_MS}ms`,
        ),
      ),
    MCP_CLIENT_CLOSE_TIMEOUT_MS,
  );
  try {
    try {
      await client.close();
    } catch (error) {
      deadline.signal.throwIfAborted();
      throw error;
    }
    deadline.signal.throwIfAborted();
  } finally {
    clearTimeout(timeout);
  }
}
