import { createProviderConfigFixture } from './__tests__/provider-config-fixture.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { SettingsService } from '@vybestack/llxprt-code-settings';
import { describe, expect, it } from 'bun:test';
import { MessageBus } from '@vybestack/llxprt-code-core';
import { createIsolatedRuntimeContext } from './index.js';

describe('isolated runtime messageBus ownership', () => {
  it('constructs a private bus when the owner does not supply one', async () => {
    const handle = (() => {
      const {
        config: capturedConfig29,
        settingsService: capturedConfig29SettingsService,
        settingsOwner: capturedConfig29SettingsOwner,
      } = createProviderConfigFixture({
        sessionId: 'message-bus-owner',
        targetDir: process.cwd(),
        cwd: process.cwd(),
        model: 'model',
        debugMode: false,
        settingsService: new SettingsService(),
      });
      return createIsolatedRuntimeContext(
        {
          settingsOwner: capturedConfig29SettingsOwner,
          config: capturedConfig29,
          runtimeId: 'isolated-private-bus',
        },
        capturedConfig29SettingsService,
      );
    })();
    try {
      await handle.activate();
      const bus = (
        handle.oauthManager as unknown as { runtimeMessageBus?: MessageBus }
      ).runtimeMessageBus;
      expect(bus).toBeInstanceOf(MessageBus);
      expect('providerManager' in handle.config).toBe(false);
    } finally {
      await handle.cleanup();
    }
  });

  it('uses the exact MessageBus supplied by the owner', async () => {
    const providedBus = new MessageBus();
    const handle = (() => {
      const {
        config: capturedConfig30,
        settingsService: capturedConfig30SettingsService,
        settingsOwner: capturedConfig30SettingsOwner,
      } = createProviderConfigFixture({
        sessionId: 'message-bus-owner',
        targetDir: process.cwd(),
        cwd: process.cwd(),
        model: 'model',
        debugMode: false,
        settingsService: new SettingsService(),
      });
      return createIsolatedRuntimeContext(
        {
          settingsOwner: capturedConfig30SettingsOwner,
          config: capturedConfig30,
          runtimeId: 'isolated-provided-bus',
          messageBus: providedBus,
        },
        capturedConfig30SettingsService,
      );
    })();
    try {
      await handle.activate();
      expect(
        (
          handle.oauthManager as unknown as {
            runtimeMessageBus?: MessageBus;
          }
        ).runtimeMessageBus,
      ).toBe(providedBus);
    } finally {
      await handle.cleanup();
    }
  });
});
