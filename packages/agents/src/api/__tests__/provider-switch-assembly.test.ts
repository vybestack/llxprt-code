/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { Config } from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { OpenAIProvider } from '@vybestack/llxprt-code-providers';
import { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import { createIsolatedRuntimeContext } from '@vybestack/llxprt-code-providers/runtime.js';
import {
  MemoryTokenStore,
  createTestProvider,
} from './helpers/provider-auth-fixtures.js';
import { assembleProviderSwitch } from '../providerSwitchAssembly.js';

class SubscriptionProvider extends OpenAIProvider {
  override readonly name = 'claudecode';
  override async hasNonOAuthAuthentication(): Promise<boolean> {
    return false;
  }
}

describe('provider switch assembly', () => {
  it('uses the current activation kind and the adopted OAuth owner outside ALS', async () => {
    const settings = new SettingsService();
    const config = new Config({
      sessionId: 'same-label',
      cwd: process.cwd(),
      targetDir: process.cwd(),
      debugMode: false,
      interactive: true,
      model: 'initial',
    });
    const tokens = new MemoryTokenStore();
    const oauth = new OAuthManager(tokens, undefined, { config });
    oauth.registerProvider(createTestProvider('claudecode'));
    const handle = createIsolatedRuntimeContext(
      {
        runtimeId: 'same-label',
        runtimeKind: 'agent',
        config,
        oauthManager: oauth,
      },
      settings,
    );
    handle.providerManager.registerProvider(
      new SubscriptionProvider(undefined),
    );
    handle.providerManager.registerProvider(new OpenAIProvider('key'));
    const switchProvider = assembleProviderSwitch(
      config,
      settings,
      handle.providerManager,
      handle.oauthManager,
      () => handle.readRuntimeKind(),
      async () => {},
      handle.settingsOwner,
    );
    try {
      await switchProvider('claudecode');
      expect(await tokens.listBuckets('claudecode')).toStrictEqual([]);
      await switchProvider('openai');
      await handle.activate({
        runtimeId: 'activated-owner',
        runtimeKind: 'cli-interactive',
      });
      const result = await switchProvider('claudecode');
      expect(result.infoMessages.join(' ')).toContain(
        'authentication completed',
      );
      expect(await tokens.listBuckets('claudecode')).toStrictEqual(['default']);
      expect(handle.oauthManager).toBe(oauth);
      expect(handle.settingsOwner.readSelectedProvider()).toBe('claudecode');
    } finally {
      await handle.cleanup();
      await config.dispose();
    }
  });
});
