import { describe, expect, it } from 'bun:test';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { openRouteBPreflight } from './helpers/route-b-preflight.js';

const intent = { provider: 'fake', authMode: 'auto' } as const;

describe('activation bootstrap receipts', () => {
  useFakeResponsesReplay('plain-text.jsonl');

  it('captures intent before caller mutation and invalidates pending work on disposal', async () => {
    const route = await openRouteBPreflight();
    const settingsOwner = new SessionSettingsOwner(route.settings);
    try {
      await route.prepare({ settingsOwner });
      const mutable = { ...intent, model: 'captured-model' };
      const pending = route.preflight.preflight(mutable);
      mutable.model = 'mutated-model';
      const result = await pending;
      expect(settingsOwner.readSelectedModel()).toBe('captured-model');
      expect(result.token).toBeDefined();
      const disposed = route.preflight.preflight(intent);
      await route.disposePreflight();
      expect((await disposed).token).toBeUndefined();
    } finally {
      await route.close();
      await settingsOwner.dispose();
    }
  });
});
