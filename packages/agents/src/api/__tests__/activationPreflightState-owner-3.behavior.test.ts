import { describe, expect, it } from 'bun:test';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { openRouteBPreflight } from './helpers/route-b-preflight.js';

const intent = { provider: 'fake', authMode: 'auto' } as const;

describe('activation bootstrap receipts', () => {
  useFakeResponsesReplay('plain-text.jsonl');

  it('serializes attempts and publishes only the latest receipt', async () => {
    const route = await openRouteBPreflight();
    const settingsOwner = new SessionSettingsOwner(route.settings);
    try {
      await route.prepare({ settingsOwner });
      const first = route.preflight.preflight({
        ...intent,
        model: 'first-model',
      });
      const second = route.preflight.preflight({
        ...intent,
        model: 'second-model',
      });
      expect((await first).token).toBeUndefined();
      const result = await second;
      expect(result.token).toBeDefined();
      expect(settingsOwner.readSelectedModel()).toBe('second-model');
    } finally {
      await route.disposePreflight();
      await route.close();
      await settingsOwner.dispose();
    }
  });
});
