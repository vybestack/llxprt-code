/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { AgentProfilePreflight } from '../profile-preflight.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { openRouteBPreflight } from './helpers/route-b-preflight.js';

const intent = { provider: 'fake', authMode: 'auto' } as const;

describe('preflight adoption boundaries', () => {
  useFakeResponsesReplay('plain-text.jsonl');
  const credentials = useOwnedCredentials();

  it('accepts equivalent intent snapshots with reordered object keys', async () => {
    const route = await openRouteBPreflight({
      authority: credentials().authority,
    });
    try {
      await route.prepare();
      const activation = {
        ...intent,
        modelParams: { nested: { a: 1, b: 2 }, temperature: 0.3 },
      };
      const result = await route.preflight.preflight(activation);
      if (!result.token) throw new Error('Missing receipt');
      const agent = await AgentProfilePreflight.createForegroundAgent(
        route.preflight,
        result.token,
        {
          authMode: 'auto',
          provider: 'fake',
          modelParams: { temperature: 0.3, nested: { b: 2, a: 1 } },
        },
        {},
      );
      expect(agent.getProvider()).toBe('fake');
      await agent.dispose();
    } finally {
      await route.close();
    }
  });
});
