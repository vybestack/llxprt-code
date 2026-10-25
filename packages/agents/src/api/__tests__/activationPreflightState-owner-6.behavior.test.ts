import { describe, expect, it } from 'bun:test';
import { AgentProfilePreflight } from '../profile-preflight.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { openRouteBPreflight } from './helpers/route-b-preflight.js';

const intent = { provider: 'fake', authMode: 'auto' } as const;

describe('activation bootstrap ownership and queued work', () => {
  useFakeResponsesReplay('plain-text.jsonl');

  it('rejects a token from another operation', async () => {
    const built = await openRouteBPreflight();
    const other = await openRouteBPreflight();
    try {
      await built.prepare();
      await other.prepare();
      const result = await other.preflight.preflight(intent);
      await built.preflight.preflight(intent);
      if (!result.token) throw new Error('Missing receipt');
      await expect(
        AgentProfilePreflight.createForegroundAgent(
          built.preflight,
          result.token,
          intent,
          {},
        ),
      ).rejects.toThrow('Activation preflight token');
    } finally {
      await other.disposePreflight();
      await built.disposePreflight();
      await other.close();
      await built.close();
    }
  });
});
