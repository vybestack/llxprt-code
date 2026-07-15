/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import type { McpClient } from './mcp-client.js';
import { RetryableClientDisconnections } from './retryable-client-disconnections.js';

function createClient(disconnect: () => Promise<void>): McpClient {
  return { disconnect } as McpClient;
}

describe('RetryableClientDisconnections', () => {
  it('deduplicates successful disconnects until the client is retired', async () => {
    const disconnect = vi.fn(async () => undefined);
    const client = createClient(disconnect);
    const disconnections = new RetryableClientDisconnections();

    await disconnections.disconnect(client);
    expect(disconnect).toHaveBeenCalledOnce();
    await disconnections.disconnect(client);
    disconnections.retire(client);
    await disconnections.disconnect(client);

    expect(disconnect).toHaveBeenCalledTimes(2);
  });

  it('forgets a failed retired client after stop has snapshotted failures', async () => {
    const failure = new Error('disconnect failed');
    const client = createClient(vi.fn(async () => Promise.reject(failure)));
    const disconnections = new RetryableClientDisconnections();

    await expect(disconnections.disconnect(client)).rejects.toBe(failure);
    const failuresForRetry = disconnections.getFailed();
    disconnections.retire(client);

    expect(failuresForRetry).toContain(client);
    expect(disconnections.getFailed()).not.toContain(client);
  });
});
