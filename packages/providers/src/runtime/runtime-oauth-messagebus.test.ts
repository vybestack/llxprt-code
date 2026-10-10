import { createProviderConfigFixture } from './__tests__/provider-config-fixture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { MessageBus } from '@vybestack/llxprt-code-core';
import { createIsolatedRuntimeContext } from './index.js';

describe('runtime/provider OAuth MessageBus seam integration', () => {
  it('uses the exact owner-supplied session MessageBus for OAuth', async () => {
    const sessionMessageBus = new MessageBus();
    const runtimeHandle = (() => {
      const {
        config: capturedConfig28,
        settingsService: capturedConfig28SettingsService,
        settingsOwner: capturedConfig28SettingsOwner,
      } = createProviderConfigFixture({
        sessionId: 'runtime-auth-messagebus',
        targetDir: process.cwd(),
        cwd: process.cwd(),
        model: 'runtime-auth-model',
        debugMode: false,
      });
      return createIsolatedRuntimeContext(
        {
          settingsOwner: capturedConfig28SettingsOwner,
          runtimeId: 'runtime-auth-messagebus',
          config: capturedConfig28,
          messageBus: sessionMessageBus,
        },
        capturedConfig28SettingsService,
      );
    })();

    try {
      await runtimeHandle.activate();
      expect(
        (
          runtimeHandle.oauthManager as unknown as {
            runtimeMessageBus?: MessageBus;
          }
        ).runtimeMessageBus,
      ).toBe(sessionMessageBus);
      expect('providerManager' in runtimeHandle.config).toBe(false);
    } finally {
      await runtimeHandle.cleanup();
      await runtimeHandle.config.dispose();
    }
  });
});
