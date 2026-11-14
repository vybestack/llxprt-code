/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { openRouteAAgent } from './helpers/route-a-agent.js';

describe('Explicit session client lifetime', () => {
  const credentials = useOwnedCredentials();
  useFakeResponsesReplay('multi-turn-text.jsonl');
  it('initializes workspace and MCP infrastructure without a client factory', async () => {
    const route = await openRouteAAgent({
      authority: credentials().authority,
      intent: {},
    });
    try {
      await route.agent.setHistory([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'workspace before chat' }],
        },
      ]);
      expect(
        (await route.agent.session.getHistory()).filter(
          (item) => item.speaker === 'human',
        ),
      ).toHaveLength(1);
    } finally {
      await route.close();
    }
  }, 30000);
});
