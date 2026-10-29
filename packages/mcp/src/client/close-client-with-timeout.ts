/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

export const MCP_CLIENT_CLOSE_TIMEOUT_MS = 10_000;

export async function closeClientWithTimeout({
  client,
  serverName,
  retirement,
  timeoutMs = MCP_CLIENT_CLOSE_TIMEOUT_MS,
}: {
  readonly client: Pick<Client, 'close'>;
  readonly serverName: string;
  readonly retirement: Pick<AbortController, 'abort'>;
  readonly timeoutMs?: number;
}): Promise<void> {
  const deadline = new AbortController();
  const timeout = setTimeout(() => {
    const expired = new Error(
      `Timed out closing MCP client '${serverName}' after ${timeoutMs}ms`,
    );
    deadline.abort(expired);
    retirement.abort(expired);
  }, timeoutMs);
  try {
    await client.close();
    deadline.signal.throwIfAborted();
  } finally {
    clearTimeout(timeout);
  }
}
