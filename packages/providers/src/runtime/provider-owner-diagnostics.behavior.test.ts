import {
  installOwnedConfig,
  installBorrowedConfigSettings,
} from '../__tests__/helpers/session-settings-owner-fixture.js';
const acquireSettings = installBorrowedConfigSettings();
const acquireConfig = installOwnedConfig();
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { ProviderManager } from '../ProviderManager.js';
import { captureProviderRequestDiagnostics } from '@vybestack/llxprt-code-core/runtime/providerRequestDiagnostics.js';

describe('provider owner diagnostic accounting', () => {
  it('accounts through an explicitly supplied owner without discovering a Config manager', async () => {
    const config = acquireConfig({
      sessionId: 'diagnostic-owner',
      cwd: process.cwd(),
      targetDir: process.cwd(),
      model: 'local-model',
      debugMode: false,
    });
    const configSettingsService = new SettingsService();
    const ownedSettingsOwner = acquireSettings(config, configSettingsService);
    for (const [key, value] of Object.entries(config.getInitialSettings()))
      configSettingsService.set(key, value);
    ownedSettingsOwner.initializeProviderSelection(
      config.getProvider(),
      config.getModel(),
    );
    const settings = new SessionSettingsOwner(configSettingsService);
    settings.bindTelemetry(config);
    const owner = new ProviderManager(
      undefined,
      undefined,
      undefined,
      undefined,
      configSettingsService,
      config,
    );
    const sibling = new ProviderManager(
      undefined,
      undefined,
      undefined,
      undefined,
      configSettingsService,
      config,
    );
    Object.defineProperty(config, 'getProviderManager', {
      configurable: true,
      value: () => {
        throw new Error('No Config manager discovery');
      },
    });
    try {
      const diagnostics = captureProviderRequestDiagnostics(
        config,
        settings,
        (name, usage) => owner.accumulateSessionTokens(name, usage),
      );
      diagnostics.accumulateSessionTokens?.('openai', {
        input: 9,
        output: 4,
        cache: 2,
        thought: 1,
        tool: 0,
      });
      diagnostics.accumulateSessionTokens?.('openai', {
        input: 7,
        output: 1,
        cache: 0,
        thought: 0,
        tool: 0,
      });
      expect(owner.getSessionTokenUsage()).toMatchObject({
        input: 16,
        output: 5,
      });
      expect(sibling.getSessionTokenUsage()).toMatchObject({
        input: 0,
        output: 0,
      });
    } finally {
      await settings.dispose();
      Reflect.deleteProperty(config, 'getProviderManager');
    }
  });
});
