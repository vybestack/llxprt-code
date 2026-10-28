/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { applyFacadeAuthBaseUrl } from '../providerMutations.js';
import { buildAgent } from './helpers/agentHarness.js';

describe('auth base URL write failures', () => {
  it('propagates a rejected settings write and leaves the facade base URL unchanged', async () => {
    const settings = new SettingsService();
    const facade: { baseUrl?: string } = {
      baseUrl: 'https://kept.example.com/v1',
    };

    await expect(
      applyFacadeAuthBaseUrl(
        'https://rejected.example.com/v1',
        facade,
        () => {
          throw new Error('settings write rejected');
        },
        settings,
        'openai',
      ),
    ).rejects.toThrow('settings write rejected');

    expect(facade.baseUrl).toBe('https://kept.example.com/v1');
  });

  it('rejects the public setBaseUrl operation when the session write fails', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      auth: { baseUrl: 'https://initial.example.com/v1' },
    });
    try {
      expect(agent.getProviderStatus().baseUrl).toBe(
        'https://initial.example.com/v1',
      );
      await agent.dispose();

      await expect(
        agent.auth.setBaseUrl('https://after-dispose.example.com/v1'),
      ).rejects.toThrow('Session settings owner is closed');

      expect(agent.getProviderStatus().baseUrl).toBe(
        'https://initial.example.com/v1',
      );
    } finally {
      await cleanup();
    }
  });
});
