import { collectResumeRows } from '../../__tests__/resumeRows.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { useOwnedCredentials } from '../../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import {
  createGenerationProvider,
  type GenerationProvider,
} from '../../../../agents/src/api/__tests__/helpers/generation-provider.js';
import {
  ownerTextGenerator,
  withGenerationClientOwner,
  type GenerationClientOwnerOptions,
} from '../../../../agents/src/api/__tests__/helpers/generation-client-owner.js';
import { useRecordingPrompts } from '../../../../agents/src/api/__tests__/helpers/recording-prompts.js';
import { generateAutoPrompt } from './autoPromptGenerator.js';

describe('detached auto prompt client', () => {
  useRecordingPrompts();
  const credentials = useOwnedCredentials();
  const geminiOptions = (
    hooks: Pick<GenerationClientOwnerOptions, 'prepareTokenizer'> = {},
  ): {
    options: GenerationClientOwnerOptions;
    provider: GenerationProvider;
  } => {
    const provider = createGenerationProvider({ alias: 'gemini' });
    return {
      provider,
      options: { authority: credentials().authority, provider, ...hooks },
    };
  };

  it('initializes an owner-tracked client without adding to primary history', async () => {
    const { options, provider } = geminiOptions();
    const cleanup = await withGenerationClientOwner(
      options,
      async ({ owner, clients }) => {
        const primary = clients[1];
        const media = primary.mediaStore;
        expect(media).toBeDefined();
        await primary.startChat();
        const text = await generateAutoPrompt(
          'detached prompt',
          ownerTextGenerator(owner),
        );
        expect(text).toBe('turn one reply');
        const client = clients[2];
        expect(client).not.toBe(primary);
        expect(client.mediaStore).toBe(media);
        expect(await collectResumeRows(primary.streamHistory())).toHaveLength(
          0,
        );
        expect(client.initialized).toBe(1);
        expect(client.disposed).toBe(1);
        expect(provider.requests).toHaveLength(1);
        await primary.addHistory({
          speaker: 'human',
          blocks: [{ type: 'text', text: 'still usable' }],
        });
        expect(await collectResumeRows(primary.streamHistory())).toMatchObject([
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
    const { options, provider } = geminiOptions({
      prepareTokenizer: async () => {
        throw new Error('Content generator configuration is unavailable');
      },
    });
    const cleanup = await withGenerationClientOwner(
      options,
      async ({ owner, clients }) => {
        const primary = clients[1];
        await primary.startChat();
        await expect(
          generateAutoPrompt(
            'missing configuration',
            ownerTextGenerator(owner),
          ),
        ).rejects.toThrow('Content generator configuration is unavailable');
        expect(clients).toHaveLength(2);
        expect(provider.requests).toHaveLength(0);
        await primary.addHistory({
          speaker: 'human',
          blocks: [{ type: 'text', text: 'still usable' }],
        });
        expect(await collectResumeRows(primary.streamHistory())).toHaveLength(
          1,
        );
        expect(primary.disposed).toBe(0);
      },
    );
    expect(cleanup).toStrictEqual([]);
  });
});
