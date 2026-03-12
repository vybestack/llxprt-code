/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MessageBus } from '@vybestack/llxprt-code-core';
import {
  createProviderManager,
  getOAuthManager,
  getProviderManager,
  resetProviderManager,
} from './providerManagerInstance.js';
import {
  activateIsolatedRuntimeContext,
  createIsolatedRuntimeContext,
  registerCliProviderInfrastructure,
} from '../runtime/runtimeSettings.js';

describe('getProviderManager runtime OAuth MessageBus composition', () => {
  beforeEach(() => {
    resetProviderManager();
  });

  afterEach(() => {
    resetProviderManager();
  });

  /**
   * @plan PLAN-20260309-MESSAGEBUS-DI-REMEDIATION.P07
   * @requirement REQ-D01-003.3
   * @requirement REQ-D01-004.3
   * @pseudocode lines 83-91
   */
  it('preserves the session MessageBus when the provider-manager singleton is registered from the explicit composition root', async () => {
    const runtimeHandle = createIsolatedRuntimeContext({
      runtimeId: 'provider-manager-runtime-seam',
      workspaceDir: process.cwd(),
      model: 'provider-manager-runtime-model',
      metadata: { source: 'phase-07-provider-test' },
      prepare: async () => {},
    });

    await activateIsolatedRuntimeContext(runtimeHandle, {
      runtimeId: runtimeHandle.runtimeId,
      metadata: { source: 'phase-07-provider-test' },
    });

    const sessionMessageBus = new MessageBus(
      runtimeHandle.config.getPolicyEngine(),
      runtimeHandle.config.getDebugMode(),
    );

    const { manager: explicitManager, oauthManager: explicitOAuthManager } =
      createProviderManager(
        {
          settingsService: runtimeHandle.config.getSettingsService(),
          config: runtimeHandle.config,
          runtimeId: runtimeHandle.runtimeId,
          metadata: { source: 'phase-07-provider-test' },
        },
        {
          config: runtimeHandle.config,
          runtimeMessageBus: sessionMessageBus,
        },
      );
    registerCliProviderInfrastructure(explicitManager, explicitOAuthManager, {
      messageBus: sessionMessageBus,
    });

    const manager = getProviderManager(runtimeHandle.config);
    const oauthManager = getOAuthManager();

    expect(oauthManager).not.toBeNull();

    const registeredProviders = manager.listProviders().sort();
    const supportedOAuthProviders = oauthManager!
      .getSupportedProviders()
      .sort();

    expect(registeredProviders).toEqual(
      expect.arrayContaining(['anthropic', 'codex', 'gemini', 'openai']),
    );
    expect(supportedOAuthProviders).toEqual(
      expect.arrayContaining(['anthropic', 'codex', 'gemini', 'qwen']),
    );
    expect(
      (oauthManager as unknown as { runtimeMessageBus?: MessageBus })
        .runtimeMessageBus,
    ).toBe(sessionMessageBus);

    await runtimeHandle.cleanup();
  });
});
