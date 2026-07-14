/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Finding 3 (#2378): End-to-end identity test for the Config-associated
 * runtime-bundle seam.
 *
 * The exact assembled OAuthManager (from assembleCliProviderRuntime) must be
 * adoptable alongside the Config's runtime bus and provider manager — not via
 * ambient lookup, but through an explicit Config-associated seam.
 *
 * This test verifies:
 * 1. assembleCliProviderRuntime produces an OAuthManager
 * 2. Setting it on the Config via setRuntimeOAuthManager makes it retrievable
 * 3. The Config's getRuntimeOAuthManager returns the EXACT same instance
 * 4. The Config's runtime bus, provider manager, and OAuthManager all share the
 *    same bus identity (end-to-end provenance)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MessageBus, Config as ConfigClass } from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { assembleCliProviderRuntime } from './assembleCliProviderRuntime.js';
import {
  resetCliProviderInfrastructure,
  resetCliRuntimeRegistryForTesting,
  resetDefaultCliRuntimeIdForTesting,
} from './runtimeSettings.js';

describe('Config-associated runtime OAuthManager seam (Finding 3, #2378)', () => {
  beforeEach(() => {
    resetCliProviderInfrastructure();
    resetCliRuntimeRegistryForTesting();
    resetDefaultCliRuntimeIdForTesting();
  });

  afterEach(() => {
    resetCliProviderInfrastructure();
    resetCliRuntimeRegistryForTesting();
    resetDefaultCliRuntimeIdForTesting();
  });

  it('assembleCliProviderRuntime produces an OAuthManager that can be adopted via the Config seam', () => {
    const settingsService = new SettingsService();
    const config = new ConfigClass({
      targetDir: process.cwd(),
      cwd: process.cwd(),
      sessionId: 'identity-test',
      debugMode: false,
      model: 'test-model',
      settingsService,
    });

    const assembled = assembleCliProviderRuntime({
      settingsService,
      config,
      runtimeId: 'identity-test-runtime',
      metadata: { source: 'identity-test' },
    });

    // Associate the assembled runtime bundle with the Config.
    config.setProviderManager(assembled.providerManager);
    config.setRuntimeMessageBus(assembled.runtimeMessageBus);
    config.setRuntimeOAuthManager(assembled.oauthManager);

    // The Config seam returns the EXACT same OAuthManager instance.
    expect(config.getRuntimeOAuthManager()).toBe(assembled.oauthManager);

    // The Config seam returns the EXACT same provider manager instance.
    expect(config.getProviderManager()).toBe(assembled.providerManager);

    // The Config seam returns the EXACT same message bus instance.
    expect(config.getRuntimeMessageBus()).toBe(assembled.runtimeMessageBus);
  });

  it('the adopted OAuthManager shares the same bus identity as the Config runtime bus', () => {
    const settingsService = new SettingsService();
    const config = new ConfigClass({
      targetDir: process.cwd(),
      cwd: process.cwd(),
      sessionId: 'identity-bus-test',
      debugMode: false,
      model: 'test-model',
      settingsService,
    });

    const assembled = assembleCliProviderRuntime({
      settingsService,
      config,
      runtimeId: 'identity-bus-test-runtime',
      metadata: { source: 'identity-bus-test' },
    });

    config.setRuntimeMessageBus(assembled.runtimeMessageBus);
    config.setRuntimeOAuthManager(assembled.oauthManager);

    // The OAuthManager's bus is the SAME instance as the Config's runtime bus.
    const oauthBus = (
      assembled.oauthManager as unknown as { runtimeMessageBus?: MessageBus }
    ).runtimeMessageBus;
    expect(oauthBus).toBe(config.getRuntimeMessageBus());
  });

  it('getRuntimeOAuthManager returns undefined when no runtime bundle has been attached', () => {
    const settingsService = new SettingsService();
    const config = new ConfigClass({
      targetDir: process.cwd(),
      cwd: process.cwd(),
      sessionId: 'identity-undefined-test',
      debugMode: false,
      model: 'test-model',
      settingsService,
    });

    // A fresh Config with no runtime bundle attached has no OAuthManager.
    expect(config.getRuntimeOAuthManager()).toBeUndefined();
  });

  it('setRuntimeOAuthManager(undefined) clears the association', () => {
    const settingsService = new SettingsService();
    const config = new ConfigClass({
      targetDir: process.cwd(),
      cwd: process.cwd(),
      sessionId: 'identity-clear-test',
      debugMode: false,
      model: 'test-model',
      settingsService,
    });

    const assembled = assembleCliProviderRuntime({
      settingsService,
      config,
      runtimeId: 'identity-clear-test-runtime',
      metadata: { source: 'identity-clear-test' },
    });

    config.setRuntimeOAuthManager(assembled.oauthManager);
    expect(config.getRuntimeOAuthManager()).toBe(assembled.oauthManager);

    config.setRuntimeOAuthManager(undefined);
    expect(config.getRuntimeOAuthManager()).toBeUndefined();
  });
});
