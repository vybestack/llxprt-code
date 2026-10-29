/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { openRouteBPreflight } from './helpers/route-b-preflight.js';
import { AgentProfilePreflight } from '../profile-preflight.js';

const intent = { provider: 'fake', authMode: 'auto' } as const;

describe('activation bootstrap receipts', () => {
  useFakeResponsesReplay('plain-text.jsonl');

  for (const mismatch of ['copy', 'foreign', 'intent'] as const) {
    it(`rejects ${mismatch} before adoption`, async () => {
      const route = await openRouteBPreflight({
        config: { interactive: true },
      });
      try {
        await route.prepare();
        const result = await route.preflight.preflight(intent);
        if (!result.token) throw new Error('Missing receipt');
        const presentedTokens = {
          copy: { ...result.token },
          foreign: {},
          intent: result.token,
        };
        const activation =
          mismatch === 'intent' ? { ...intent, model: 'other' } : intent;
        await expect(
          AgentProfilePreflight.createForegroundAgent(
            route.preflight,
            presentedTokens[mismatch],
            activation,
            {},
          ),
        ).rejects.toThrow('Activation preflight');
      } finally {
        await route.close();
      }
    });
  }
});
