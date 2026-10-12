import { createProviderConfigFixture } from '../runtime/__tests__/provider-config-fixture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { SettingsService, Storage } from '@vybestack/llxprt-code-settings';
import { MockFileSystem } from './IFileSystem.js';
import { createProviderManager } from './providerManagerInstance.js';

function createOwner(provider: string) {
  const settingsService = new SettingsService();
  const { config: config } = createProviderConfigFixture({
    sessionId: 'shared-provider-label',
    cwd: process.cwd(),
    targetDir: process.cwd(),
    debugMode: false,
    model: 'test-model',
    settingsService,
  });
  const fileSystem = new MockFileSystem();
  fileSystem.setMockFile(
    Storage.getGlobalSettingsPath(),
    JSON.stringify({ defaultProvider: provider }),
  );
  return { config, fileSystem, settingsService };
}

describe('provider manager filesystem ownership', () => {
  it('keeps settings isolated across same-label owners when one owner is disposed', async () => {
    const first = createOwner('openai');
    const second = createOwner('anthropic');
    try {
      const a = createProviderManager(
        {
          runtimeId: 'shared-provider-label',
          settingsService: first.settingsService,
        },
        { config: first.config, fileSystem: first.fileSystem },
      );
      const b = createProviderManager(
        {
          runtimeId: 'shared-provider-label',
          settingsService: second.settingsService,
        },
        { config: second.config, fileSystem: second.fileSystem },
      );
      expect(a.manager.getActiveProviderName()).toBe('openai');
      expect(b.manager.getActiveProviderName()).toBe('anthropic');
      await first.config.dispose();
      expect(b.manager.getActiveProviderName()).toBe('anthropic');
    } finally {
      await first.config.dispose();
      await second.config.dispose();
    }
  });
});
