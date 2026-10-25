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

describe('activation bootstrap receipts', () => {
  useFakeResponsesReplay('plain-text.jsonl');
  const credentials = useOwnedCredentials();

  it('invalidates a receipt at retry start', async () => {
    const route = await openRouteBPreflight({
      authority: credentials().authority,
    });
    try {
      await route.prepare();
      const first = await route.preflight.preflight(intent);
      if (!first.token) throw new Error('Missing receipt');
      const retry = route.preflight.preflight({ provider: 'not-registered' });
      await expect(
        AgentProfilePreflight.createForegroundAgent(
          route.preflight,
          first.token,
          intent,
          {},
        ),
      ).rejects.toThrow('Activation preflight');
      expect((await retry).token).toBeUndefined();
    } finally {
      await route.close();
    }
  });
});
