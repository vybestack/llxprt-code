/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createProviderManager } from './providerManagerInstance.js';
import { NodeFileSystem } from './IFileSystem.js';

describe('Composed OAuth session policy', () => {
  it('reads browser policy live from each exact store while sharing static Config', async () => {
    const config = new Config({
      sessionId: 'same-label',
      targetDir: process.cwd(),
      cwd: process.cwd(),
      debugMode: false,
      model: 'test-model',
    });
    const firstStore = new SettingsService();
    const secondStore = new SettingsService();
    firstStore.set('auth.noBrowser', true);
    const options = {
      fileSystem: new NodeFileSystem(),
      activateConfiguredProvider: false,
    };
    const first = createProviderManager(
      { config, settingsService: firstStore, runtimeId: 'same-label' },
      options,
    );
    const second = createProviderManager(
      { config, settingsService: secondStore, runtimeId: 'same-label' },
      options,
    );
    try {
      expect([
        first.oauthManager.isBrowserDisabled(),
        second.oauthManager.isBrowserDisabled(),
      ]).toStrictEqual([true, false]);
      firstStore.set('auth.noBrowser', false);
      secondStore.set('auth.noBrowser', true);
      expect([
        first.oauthManager.isBrowserDisabled(),
        second.oauthManager.isBrowserDisabled(),
      ]).toStrictEqual([false, true]);
    } finally {
      first.manager.dispose();
      second.manager.dispose();
      await config.dispose();
    }
  });
});
