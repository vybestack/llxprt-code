import { describe, expect, it } from 'bun:test';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { openRouteBPreflight } from './helpers/route-b-preflight.js';
import type { ProviderActivationIntent } from '../config-types.js';

describe('executeProviderActivation surfaces switchError (#2374 finding 6)', () => {
  useFakeResponsesReplay('plain-text.jsonl');

  const builtCredentials = useOwnedCredentials();

  it('executor with unknown provider in authMode none returns switchError', async () => {
    const route = await openRouteBPreflight({
      authority: builtCredentials().authority,
    });
    try {
      await route.prepare();
      const initial = await route.preflight.preflight({
        provider: 'fake',
        model: 'fake-model',
      });
      if (initial.authFailed) throw initial.authError;
      const intent: ProviderActivationIntent = {
        provider: 'nonexistent-provider-xyz',
        authMode: 'none',
      };
      const result = await route.preflight.preflight(intent);
      expect(result.switchError).toBeDefined();
      expect(typeof result.switchError).toBe('string');
    } finally {
      await route.close();
    }
  });
});
