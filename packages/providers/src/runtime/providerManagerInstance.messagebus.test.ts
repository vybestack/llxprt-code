import { createProviderConfigFixture } from './__tests__/provider-config-fixture.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { PolicyEngine } from '@vybestack/llxprt-code-policy';

import { NodeFileSystem } from '../composition/IFileSystem.js';

import { describe, expect, it } from 'bun:test';
import { MessageBus } from '@vybestack/llxprt-code-core';
import { createProviderManager } from '../composition/index.js';
import {
  activateIsolatedRuntimeContext,
  createIsolatedRuntimeContext,
} from './index.js';

describe('provider manager runtime OAuth MessageBus composition', () => {
  /**
   * @plan PLAN-20260309-MESSAGEBUS-DI-REMEDIATION.P07
   * @requirement REQ-D01-003.3
   * @requirement REQ-D01-004.3
   * @pseudocode lines 83-91
   */
  it('preserves the session MessageBus in an explicitly composed provider manager', async () => {
    const runtimeHandle = (() => {
      const {
        config: capturedConfig24,
        settingsService: capturedConfig24SettingsService,
        settingsOwner: capturedConfig24SettingsOwner,
      } = createProviderConfigFixture({
        sessionId: 'provider-manager-runtime-seam',
        targetDir: process.cwd(),
        cwd: process.cwd(),
        model: 'provider-manager-runtime-model',
        debugMode: false,
      });
      return createIsolatedRuntimeContext(
        {
          settingsOwner: capturedConfig24SettingsOwner,
          runtimeId: 'provider-manager-runtime-seam',
          config: capturedConfig24,
          metadata: { source: 'phase-07-provider-test' },
          prepare: async () => {},
        },
        capturedConfig24SettingsService,
      );
    })();

    await activateIsolatedRuntimeContext(runtimeHandle, {
      runtimeId: runtimeHandle.runtimeId,
      metadata: { source: 'phase-07-provider-test' },
    });

    const sessionMessageBus = new MessageBus(
      new PolicyEngine(runtimeHandle.config.getPolicyEngineConfig()),
      runtimeHandle.config.getDebugMode(),
    );

    const { manager: explicitManager, oauthManager: explicitOAuthManager } =
      createProviderManager(
        {
          settingsService: runtimeHandle.settingsService,
          config: runtimeHandle.config,
          runtimeId: runtimeHandle.runtimeId,
          metadata: { source: 'phase-07-provider-test' },
        },
        {
          fileSystem: new NodeFileSystem(),
          config: runtimeHandle.config,
          runtimeMessageBus: sessionMessageBus,
        },
      );
    const manager = explicitManager;
    const oauthManager = explicitOAuthManager;

    const registeredProviders = manager.listProviders().sort();
    const supportedOAuthProviders = oauthManager.getSupportedProviders().sort();

    expect(registeredProviders).toStrictEqual(
      expect.arrayContaining(['anthropic', 'codex', 'openai']),
    );
    expect(supportedOAuthProviders).toStrictEqual(
      expect.arrayContaining(['claudecode', 'codex']),
    );
    expect(supportedOAuthProviders).not.toContain('qwen');
    expect(
      (oauthManager as unknown as { runtimeMessageBus?: MessageBus })
        .runtimeMessageBus,
    ).toBe(sessionMessageBus);

    await runtimeHandle.cleanup();
    await runtimeHandle.config.dispose();
  });
});
