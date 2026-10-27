/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { useRecordingPrompts } from './helpers/recording-prompts.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { createGenerationProvider } from './helpers/generation-provider.js';
import {
  generationRecording,
  withGenerationClientOwner,
} from './helpers/generation-client-owner.js';

/**
 * Temporary-client generation (provider named `gemini`) builds a detached
 * client for each accepted request. The client factory's returned clients are
 * only readable on the owner's factory, so the count is observed on the
 * SessionClientOwner the Agent's generate delegates to.
 */
describe('SessionClientOwner.generateText with empty input', () => {
  useRecordingPrompts();
  const credentials = useOwnedCredentials();

  it('builds no detached client and sends no request for empty input, and builds one for real input', async () => {
    const provider = createGenerationProvider({ alias: 'gemini' });
    const cleanup = await withGenerationClientOwner(
      { authority: credentials().authority, provider },
      async ({ owner, clients }) => {
        const built = clients.length;
        expect(
          await owner.clients.generateText(
            [],
            { writeHistory: true },
            generationRecording,
          ),
        ).toBe('');
        expect(clients).toHaveLength(built);
        expect(provider.requests).toStrictEqual([]);

        expect(
          await owner.clients.generateText(
            'real input',
            undefined,
            generationRecording,
          ),
        ).toBe('turn one reply');
        expect(clients).toHaveLength(built + 1);
        expect(provider.requests).toHaveLength(1);
      },
    );
    expect(cleanup).toStrictEqual([]);
  });
});
