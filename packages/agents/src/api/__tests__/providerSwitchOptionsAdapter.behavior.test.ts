/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { buildAgent } from './helpers/agentHarness.js';

describe('provider switch with the fake-response seam on', () => {
  it('rejects a switch to an unregistered provider and leaves the agent on its provider', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      expect(process.env.LLXPRT_FAKE_RESPONSES).toBeDefined();
      const before = agent.getProvider();

      await expect(agent.setProvider('unregistered-provider')).rejects.toThrow(
        "Provider 'unregistered-provider' not found",
      );

      expect(agent.getProvider()).toBe(before);
    } finally {
      await cleanup();
    }
  });
});
