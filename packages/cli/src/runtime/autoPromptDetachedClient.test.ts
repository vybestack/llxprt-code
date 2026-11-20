/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { useOwnedCredentials } from '../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import { createGenerationProvider } from '../../../agents/src/api/__tests__/helpers/generation-provider.js';
import {
  generationRecording,
  withGenerationClientOwner,
} from '../../../agents/src/api/__tests__/helpers/generation-client-owner.js';

describe('detached auto prompt generation ownership', () => {
  const credentials = useOwnedCredentials();

  it('initializes an owner-tracked client without adding to primary history', async () => {
    const released = await withGenerationClientOwner(
      {
        authority: credentials().authority,
        provider: createGenerationProvider({ alias: 'gemini' }),
      },
      async ({ owner, clients }) => {
        const primary = clients[1];
        await primary.startChat();
        const output = await owner.clients.generateText(
          'detached prompt',
          undefined,
          generationRecording,
        );
        expect(output).toBe('turn one reply');
        const detached = clients[2];
        expect(detached).not.toBe(primary);
        expect(detached.mediaStore).toBe(primary.mediaStore);
        expect(detached.initialized).toBe(1);
        expect(detached.disposed).toBe(1);
        expect(primary.disposed).toBe(0);
        expect(await Array.fromAsync(primary.streamHistory())).toHaveLength(0);
      },
    );
    expect(released).toStrictEqual([]);
  });

  it('rejects failed generation preparation without constructing an implicit client or retiring the primary', async () => {
    const released = await withGenerationClientOwner(
      {
        authority: credentials().authority,
        provider: createGenerationProvider({ alias: 'gemini' }),
        prepareTokenizer: async () => {
          throw new Error('generation preparation unavailable');
        },
      },
      async ({ owner, clients }) => {
        const primary = clients[1];
        await primary.startChat();
        const before = clients.length;
        await expect(
          owner.clients.generateText(
            'detached prompt',
            undefined,
            generationRecording,
          ),
        ).rejects.toThrow('generation preparation unavailable');
        expect(clients).toHaveLength(before);
        expect(primary.disposed).toBe(0);
        await primary.addHistory({
          speaker: 'human',
          blocks: [{ type: 'text', text: 'still usable' }],
        });
        expect(await Array.fromAsync(primary.streamHistory())).toHaveLength(1);
      },
    );
    expect(released).toStrictEqual([]);
  });
});
