import { CredentialAuthority } from '../auth/proxy/credential-store-factory.js';
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
      new SettingsService(),
      {
        runtimeId: 'filesystem-injection-test',
        metadata: { stage: 'test' },
      },
      undefined,
      new CredentialAuthority(),
      fileSystem,
      undefined,
      undefined,
      undefined,
      undefined,
    );

    expect(manager.getActiveProvider()?.name).toBe('anthropic');
  });
});
