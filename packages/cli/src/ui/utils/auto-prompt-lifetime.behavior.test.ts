/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { withGenerationOwner } from '../../../../agents/src/api/__tests__/helpers/generation-owner-fixture.js';
import { useRecordingPrompts } from '../../../../agents/src/api/__tests__/helpers/recording-owner-lifetime-fixture.js';
import { generateAutoPrompt } from './autoPromptGenerator.js';

describe('detached auto prompt client', () => {
  useRecordingPrompts();

  it('initializes an owner-tracked client without adding to primary history', async () => {
    const cleanup = await withGenerationOwner(
      async (owner, clients, provider) => {
        const primary = clients[1];
        const media = primary.mediaStore;
        expect(media).toBeDefined();
        await primary.startChat();
        const text = await generateAutoPrompt(
          'detached prompt',
          (input, options) => owner.generate(input, options),
        );
        expect(text).toBe('turn one reply');
        const client = clients[2];
        expect(client).not.toBe(primary);
        expect(client.mediaStore).toBe(media);
        expect(primary.getHistoryService()?.getRawHistory()).toHaveLength(0);
        expect(client.initialized).toBe(1);
        expect(client.disposed).toBe(1);
        expect(provider.requests).toHaveLength(1);
        await primary.addHistory({
          speaker: 'human',
          blocks: [{ type: 'text', text: 'still usable' }],
        });
        expect(await primary.getHistory()).toMatchObject([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'still usable' }],
          },
        ]);
        await owner.dispose();
        expect(client.disposed).toBe(1);
      },
    );
    expect(cleanup).toStrictEqual([]);
  });

  it('rejects missing content generator configuration without constructing an implicit client', async () => {
    const cleanup = await withGenerationOwner(
      async (owner, clients, provider) => {
        const primary = clients[1];
        await primary.startChat();
        await expect(
          generateAutoPrompt('missing configuration', (input, options) =>
            owner.generate(input, options),
          ),
        ).rejects.toThrow('Content generator configuration is unavailable');
        expect(clients).toHaveLength(2);
        expect(provider.requests).toHaveLength(0);
        await primary.addHistory({
          speaker: 'human',
          blocks: [{ type: 'text', text: 'still usable' }],
        });
        expect(primary.getHistoryService()?.getRawHistory()).toHaveLength(1);
        expect(primary.disposed).toBe(0);
      },
      'gemini',
      undefined,
      async () => {
        throw new Error('Content generator configuration is unavailable');
      },
    );
    expect(cleanup).toStrictEqual([]);
  });
});
