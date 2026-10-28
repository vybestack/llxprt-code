/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'bun:test';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { openRouteAAgent } from './helpers/route-a-agent.js';

async function owner() {
  const route = await openRouteAAgent({ config: { sessionId: 'same-label' } });
  await route.agent.chat('start the chat');
  return route;
}

describe('Config workspace disposal', () => {
  useFakeResponsesReplay('plain-text.jsonl');

  it('does not dispose independently owned clients with identical session labels', async () => {
    const first = await owner();
    const sibling = await owner();
    try {
      await first.config.dispose();
      await first.agent.setHistory([
        {
          speaker: 'human',
          blocks: [
            { type: 'text', text: 'caller survives workspace shutdown' },
          ],
        },
      ]);
      expect(await first.agent.getHistory()).toHaveLength(1);
      expect(JSON.stringify(await sibling.agent.getHistory())).not.toContain(
        'caller survives workspace shutdown',
      );
      await first.agent.dispose();
      expect(() => first.agent.getCurrentSequenceModel()).toThrow('disposed');
      await sibling.agent.setHistory([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'sibling still works' }],
        },
      ]);
      expect(await sibling.agent.getHistory()).toHaveLength(1);
    } finally {
      await first.close();
      await sibling.close();
    }
  });
});
