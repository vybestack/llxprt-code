/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { createProviderConfigFixture } from '../../runtime/__tests__/provider-config-fixture.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { assembleCliProviderRuntime } from '../../runtime/assembleCliProviderRuntime.js';
import {
  createProviderManager,
  NodeFileSystem,
} from '../../composition/index.js';
import { AnthropicProvider } from '../../anthropic/AnthropicProvider.js';

class BoundManagerExposingProvider extends AnthropicProvider {
  get boundOAuthManager(): unknown {
    return (
      this as unknown as { baseProviderConfig: { oauthManager?: unknown } }
    ).baseProviderConfig.oauthManager;
  }
}

describe('issue #2891: provider OAuth identity is owner-bound', () => {
  it('keeps each provider bound to its own Config OAuth manager across sibling startup and cleanup', async () => {
    const makeOwner = (
      sessionId: string,
    ): ReturnType<typeof createProviderConfigFixture> =>
      createProviderConfigFixture({
        sessionId,
        targetDir: process.cwd(),
        cwd: process.cwd(),
        debugMode: false,
        model: 'test-model',
        settingsService: new SettingsService(),
      });
    const firstRoot = makeOwner('oauth-identity-first');
    const secondRoot = makeOwner('oauth-identity-second');
    const first = firstRoot.config;
    const second = secondRoot.config;
    const a = assembleCliProviderRuntime({
      config: first,
      settingsService: firstRoot.settingsService,
      runtimeId: 'oauth-identity-first',
    });
    const boundA = new BoundManagerExposingProvider(
      undefined,
      undefined,
      undefined,
      a.oauthManager,
    );
    try {
      const b = createProviderManager(
        { config: second, settingsService: secondRoot.settingsService },
        { config: second, fileSystem: new NodeFileSystem() },
      );
      const boundB = new BoundManagerExposingProvider(
        undefined,
        undefined,
        undefined,
        b.oauthManager,
      );
      try {
        expect(boundA.boundOAuthManager).toBe(a.oauthManager);
        expect(boundB.boundOAuthManager).toBe(b.oauthManager);
        expect(boundA.boundOAuthManager).not.toBe(boundB.boundOAuthManager);
        expect(boundA.boundOAuthManager).toBe(a.oauthManager);
        expect(a.providerManager.listProviders()).toContain('claudecode');
      } finally {
        await second.dispose();
      }
    } finally {
      a.registration.dispose();
      await first.dispose();
    }
  });
});
