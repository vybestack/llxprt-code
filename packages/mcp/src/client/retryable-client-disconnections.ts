/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { McpClient } from './mcp-client.js';

export class RetryableClientDisconnections {
  private readonly pending = new WeakMap<McpClient, Promise<void>>();
  private readonly failed = new Set<McpClient>();

  retire(client: McpClient): void {
    this.pending.delete(client);
    this.failed.delete(client);
  }

  activate(client: McpClient): void {
    this.retire(client);
  }

  getFailed(): ReadonlySet<McpClient> {
    return new Set(this.failed);
  }

  disconnect(client: McpClient): Promise<void> {
    const pending = this.pending.get(client);
    if (pending !== undefined) return pending;
    const disconnection = Promise.resolve()
      .then(() => client.disconnect())
      .then(
        () => {
          this.failed.delete(client);
        },
        (error: unknown) => {
          this.pending.delete(client);
          this.failed.add(client);
          throw error;
        },
      );
    this.pending.set(client, disconnection);
    return disconnection;
  }
}
