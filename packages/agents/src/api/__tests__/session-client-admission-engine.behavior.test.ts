/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { openRouteAAgent } from './helpers/route-a-agent.js';

describe('Explicit session client lifetime', () => {
  useFakeResponsesReplay('multi-turn-text.jsonl');

  it('owns a model replacement and keeps the session history', async () => {
    const route = await openRouteAAgent();
    const { agent } = route;
    try {
      await agent.setHistory([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'retained across replacement' }],
        },
      ]);
      await agent.setModel('replacement-model');
      expect(agent.getModel()).toBe('replacement-model');
      expect(
        (await agent.getHistory()).filter((item) => item.speaker === 'human'),
      ).toHaveLength(1);
      await agent.dispose();
    } finally {
      await route.close();
    }
  }, 30000);
});
