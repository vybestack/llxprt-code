import type { RuntimeProviderManager } from '@vybestack/llxprt-code-core';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'bun:test';
import type { Settings } from './settings.js';
import { loadCliConfig } from './config.js';
import { parseArguments } from './cliArgParser.js';
import { ExtensionEnablementManager } from './extensions/extensionEnablement.js';
import { ExtensionStorage } from './extension.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';

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

    const config = await loadCliConfig(
      {},
      [],
      new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
        argv.extensions,
      ),
      'test-session',
      argv,
    );

    expect(config.getProvider()).toBe('kimi');
    expect(config.getModel()).toBe('kimi-for-coding');
  });
  it('keeps two same-label CLI Configs and selected models independent', async () => {
    process.argv = ['node', 'script.js', '--provider', 'kimi'];
    const argv = await parseArguments({} as Settings);
    const extensions = new ExtensionEnablementManager(
      ExtensionStorage.getUserExtensionsDir(),
      argv.extensions,
    );
    const firstSettings = new SettingsService();
    const secondSettings = new SettingsService();
    const firstOwner = new SessionSettingsOwner(firstSettings);
    const secondOwner = new SessionSettingsOwner(secondSettings);
    let firstFiles: object | undefined;
    let secondFiles: object | undefined;
    let firstManager: RuntimeProviderManager | undefined;
    let secondManager: RuntimeProviderManager | undefined;
    const first = await loadCliConfig(
      {},
      [],
      extensions,
      'first-session',
      argv,
      process.cwd(),
      {
        settingsService: firstSettings,
        sessionSettingsOwner: firstOwner,
        onProviderFilesReady: (files) => {
          firstFiles = files;
        },
        onProviderManagerReady: (manager) => {
          firstManager = manager;
        },
      },
    );
    const second = await loadCliConfig(
      {},
      [],
      extensions,
      'second-session',
      argv,
      process.cwd(),
      {
        settingsService: secondSettings,
        sessionSettingsOwner: secondOwner,
        onProviderFilesReady: (files) => {
          secondFiles = files;
        },
        onProviderManagerReady: (manager) => {
          secondManager = manager;
        },
      },
    );
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
      await firstOwner.dispose();
      await secondOwner.dispose();
      await first.dispose();
      await second.dispose();
    }
  });
});
