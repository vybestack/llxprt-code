/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { Storage, SettingsService } from '@vybestack/llxprt-code-settings';
import { MockFileSystem } from './IFileSystem.js';
import { createProviderManager } from '@vybestack/llxprt-code-providers/composition/providerManagerInstance.js';

describe('public provider-manager filesystem injection', () => {
  it('uses the supplied filesystem to select the user-configured provider', () => {
    const fileSystem = new MockFileSystem();
    fileSystem.setMockFile(
      Storage.getGlobalSettingsPath(),
      JSON.stringify({ defaultProvider: 'anthropic' }),
    );

    const { manager } = createProviderManager(
      {
        settingsService: new SettingsService(),
        runtimeId: 'filesystem-injection-test',
        metadata: { stage: 'test' },
      },
      { fileSystem },
    );

    expect(manager.getActiveProvider()?.name).toBe('anthropic');
  });
});
