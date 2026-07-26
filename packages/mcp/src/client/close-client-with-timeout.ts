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
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      client.close(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new Error(
                `Timed out closing MCP client '${serverName}' after ${MCP_CLIENT_CLOSE_TIMEOUT_MS}ms`,
              ),
            ),
          MCP_CLIENT_CLOSE_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}
