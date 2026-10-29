/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { AgentActivationBootstrap } from '../activationPreflightState.js';
import { AgentProfilePreflight } from '../profile-preflight.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { openRouteBPreflight } from './helpers/route-b-preflight.js';

const intent = { provider: 'fake', authMode: 'auto' } as const;

describe('preflight adoption boundaries', () => {
  useFakeResponsesReplay('plain-text.jsonl');
  const credentials = useOwnedCredentials();

  it('rechecks the actual adopted manager at consumption', async () => {
    const route = await openRouteBPreflight({
      authority: credentials().authority,
    });
    try {
      await route.prepare();
      const result = await route.preflight.preflight(intent);
      if (!result.token) throw new Error('Missing receipt');
      expect('consume' in AgentActivationBootstrap).toBe(false);
      expect('validate' in AgentActivationBootstrap).toBe(false);
      const agent = await AgentProfilePreflight.createForegroundAgent(
        route.preflight,
        result.token,
        intent,
        {},
      );
      expect(agent.getProvider()).toBe('fake');
      await agent.dispose();
    } finally {
      await route.close();
    }
  });
});
