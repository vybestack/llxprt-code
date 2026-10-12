/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { buildAgent, drain } from './helpers/agentHarness.js';

describe('agent session metrics', () => {
  it('publishes prompt metrics, unsubscribes, and resets through the session port', async () => {
    const root = await buildAgent('multi-turn-text.jsonl');
    try {
      const counts: number[] = [];
      const unsubscribe = root.agent.metrics.subscribe((update) => {
        counts.push(update.lastPromptTokenCount);
      });
      root.agent.metrics.setLastPromptTokenCount(41);
      expect(counts).toStrictEqual([41]);
      unsubscribe();
      root.agent.metrics.reset();
      expect(root.agent.metrics.getLastPromptTokenCount()).toBe(0);
      expect(counts).toStrictEqual([41]);
      await drain(root.agent.stream('hello'));
      expect(root.agent.getStats().turnCount).toBeGreaterThan(0);
    } finally {
      await root.cleanup();
    }
  });
});
