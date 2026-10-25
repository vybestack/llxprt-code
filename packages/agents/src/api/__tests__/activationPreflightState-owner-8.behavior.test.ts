import { describe, expect, it } from 'bun:test';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { openRouteBPreflight } from './helpers/route-b-preflight.js';

const intent = { provider: 'fake', authMode: 'auto' } as const;

describe('activation bootstrap ownership and queued work', () => {
  useFakeResponsesReplay('plain-text.jsonl');

  it('permits a successful retry after a failed activation', async () => {
    const route = await openRouteBPreflight();
    try {
      await route.prepare();
      const failed = await route.preflight.preflight({
        provider: 'missing-provider',
      });
      expect(failed.authFailed).toBe(true);
      expect(failed.authError).toBeDefined();
      expect(failed.token).toBeUndefined();
      const result = await route.preflight.preflight(intent);
      expect(result.authFailed).toBe(false);
      expect(result.token).toBeDefined();
    } finally {
      await route.disposePreflight();
      await route.close();
    }
  });
});
