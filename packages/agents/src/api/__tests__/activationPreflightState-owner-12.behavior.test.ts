/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { fromConfig } from '../fromConfig.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

const intent = { provider: 'fake', authMode: 'auto' } as const;

describe('preflight adoption boundaries', () => {
  useFakeResponsesReplay('plain-text.jsonl');
  const credentials = useOwnedCredentials();

  it('rejects malformed adoption options that omit Config', async () => {
    await expect(
      fromConfig(
        undefined as never,
        new SettingsService(),
        { activation: intent },
        credentials().authority,
      ),
    ).rejects.toThrow('requires an existing Config');
  });
});
