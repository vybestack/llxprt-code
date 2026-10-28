/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Agent } from '../../agent.js';

const DISCOVERY_TIMEOUT_MS = 30_000;

/**
 * `createAgent` and `fromConfig` return before the agent's own MCP discovery
 * has finished. Resolves once the agent reports `ready`, through the public
 * status subscription.
 */
export function awaitMcpDiscoveryReady(agent: Agent): Promise<void> {
  if (agent.mcp.discoveryState() === 'ready') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error('MCP discovery did not become ready'));
    }, DISCOVERY_TIMEOUT_MS);
    const unsubscribe = agent.mcp.subscribeStatus(() => {
      if (agent.mcp.discoveryState() !== 'ready') return;
      clearTimeout(timer);
      unsubscribe();
      resolve();
    });
  });
}
