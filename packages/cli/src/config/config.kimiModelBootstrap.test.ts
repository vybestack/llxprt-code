import { observeActivationPreparation } from '../../../agents/src/api/__tests__/helpers/activation-acquisition-capture.js';

import { afterEach, describe, expect, it, vi } from 'bun:test';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import type { RuntimeProviderManager } from '@vybestack/llxprt-code-core';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Settings } from './settings.js';
import { parseArguments } from './cliArgParser.js';
import { ExtensionEnablementManager } from './extensions/extensionEnablement.js';
import { ExtensionStorage } from './extension.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { loadCliConfigWithPreflight } from '../__tests__/load-cli-config-fixture.js';

const actual = { ...(await import('@vybestack/llxprt-code-core')) };
void vi.mock('@vybestack/llxprt-code-core', () => ({
  ...actual,
  isRipgrepAvailable: vi.fn().mockResolvedValue(true),
}));

// Regression test for start.js model.missing when provider != gemini and no model provided.
// Expected behavior: provider aliases with defaultModel should supply a non-empty model.

describe('loadCliConfig provider alias model bootstrap', () => {
  const originalArgv = process.argv;

  afterEach(() => {
    process.argv = originalArgv;
  });

  it('uses kimi alias defaultModel when --provider kimi is set and no --model is provided', async () => {
    process.argv = ['node', 'script.js', '--provider', 'kimi'];
    const argv = await parseArguments({} as Settings);

    const config = await loadCliConfigWithPreflight({
      settings: {},
      extensions: [],
      extensionEnablementManager: new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
        {
          enabledOverride: argv.extensions,
        },
      ),
      sessionId: 'test-session',
      argv,
      authority: new CredentialAuthority(),
    });

    expect(config.getProvider()).toBe('kimi');
    expect(config.getModel()).toBe('kimi-for-coding');
  });
  it('keeps two same-label CLI Configs and selected models independent', async () => {
    process.argv = ['node', 'script.js', '--provider', 'kimi'];
    const argv = await parseArguments({} as Settings);
    const extensions = new ExtensionEnablementManager(
      ExtensionStorage.getUserExtensionsDir(),
      { enabledOverride: argv.extensions },
    );
    const firstSettings = new SettingsService();
    const secondSettings = new SettingsService();
    const firstOwner = new SessionSettingsOwner(firstSettings);
    const secondOwner = new SessionSettingsOwner(secondSettings);
    let firstFiles: object | undefined;
    let secondFiles: object | undefined;
    let firstManager: RuntimeProviderManager | undefined;
    let secondManager: RuntimeProviderManager | undefined;

    const observation = observeActivationPreparation((operation, state) => {
      if (state.settingsService === firstSettings) {
        firstManager = state.manager;
        firstFiles = state.providerFileLifecycle;
      } else if (state.settingsService === secondSettings) {
        secondManager = state.manager;
        secondFiles = state.providerFileLifecycle;
      }
    });
    const first = await loadCliConfigWithPreflight({
      settings: {},
      extensions: [],
      extensionEnablementManager: extensions,
      sessionId: 'first-session',
      argv,
      cwd: process.cwd(),
      settingsService: firstSettings,
      settingsOwner: firstOwner,
      authority: new CredentialAuthority(),
    });
    const second = await loadCliConfigWithPreflight({
      settings: {},
      extensions: [],
      extensionEnablementManager: extensions,
      sessionId: 'second-session',
      argv,
      cwd: process.cwd(),
      settingsService: secondSettings,
      settingsOwner: secondOwner,
      authority: new CredentialAuthority(),
    });
    try {
      expect(() =>
        firstOwner.assertSettingsIdentity(firstSettings),
      ).not.toThrow();
      expect(() =>
        secondOwner.assertSettingsIdentity(secondSettings),
      ).not.toThrow();
      expect(firstManager).toBeDefined();
      expect(secondManager).toBeDefined();
      expect(firstManager).not.toBe(secondManager);
      expect(firstFiles).toBeDefined();
      expect(secondFiles).toBeDefined();
      expect(firstFiles).not.toBe(secondFiles);
      expect(first.getProvider()).toBe('kimi');
      expect(second.getProvider()).toBe('kimi');
      firstOwner.chooseModel('kimi-first');
      secondOwner.chooseModel('kimi-second');
      expect(firstOwner.readSelectedModel()).toBe('kimi-first');
      expect(secondOwner.readSelectedModel()).toBe('kimi-second');
      await first.dispose();
      expect(secondManager?.getActiveProvider()?.name).toBe('kimi');
      expect(secondOwner.readSelectedModel()).toBe('kimi-second');
    } finally {
      observation.mockRestore();
      await firstOwner.dispose();
      await secondOwner.dispose();
      await first.dispose();
      await second.dispose();
    }
  });
});
