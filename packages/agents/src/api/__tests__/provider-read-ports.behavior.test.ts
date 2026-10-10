/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { buildAgent } from './helpers/agentHarness.js';

describe('public Agent live provider reads', () => {
  it('reads current active state, model catalogue and changing provider limits without returning runtime services', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const provider = agent.providerManager.getActiveProvider();
      if (!provider) throw new Error('Expected activated fixture provider');
      let limit = 8192;
      provider.getContextLimit = () => limit;
      const reads = {
        hasActiveProvider: () => agent.hasActiveProvider(),
        getProviderContextLimit: () => agent.getProviderContextLimit(),
        listAvailableModels: () => agent.listAvailableModels(),
      };
      expect(reads.hasActiveProvider()).toBe(true);
      expect(reads.getProviderContextLimit()).toBe(8192);
      limit *= 2;
      expect(reads.getProviderContextLimit()).toBe(16384);
      const models = await reads.listAvailableModels();
      expect(models.map(({ id }) => id)).toContain(agent.getModel());
      const result = await agent.chat('Respond with the retained fixture text');
      expect(result.text).toContain('a plain text reply');
    } finally {
      await cleanup();
    }
  });
});
