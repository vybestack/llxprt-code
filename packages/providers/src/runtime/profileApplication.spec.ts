/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { describe, expect, it } from 'bun:test';
import {
  Config,
  createProviderRuntimeContext,
} from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { ProviderManager } from '../ProviderManager.js';
import { OpenAIProvider } from '../openai/OpenAIProvider.js';
import { switchActiveProvider } from './providerSwitch.js';
import { switchProviderForProfile } from './profile-application/switchProfileProvider.js';

class LocalConfig extends Config {}

describe('Profile Application timeout preservation (Issue #1049)', () => {
  it('preserves profile timeouts while clearing unrelated provider settings', async () => {
    const settings = new SettingsService();
    const settingsOwner = new SessionSettingsOwner(settings);
    const config = new LocalConfig({
      sessionId: 'profile-timeouts',
      targetDir: process.cwd(),
      cwd: process.cwd(),
      model: 'initial',
      debugMode: false,
    });
    const manager = new ProviderManager(
      createProviderRuntimeContext({ settingsService: settings, config }),
    );
    manager.registerProvider(new OpenAIProvider('test-key'));
    const timeouts = {
      'task-default-timeout-seconds': 120,
      'task-max-timeout-seconds': 300,
      'shell-default-timeout-seconds': 45,
      'shell-max-timeout-seconds': 180,
    };
    try {
      for (const [key, value] of Object.entries(timeouts))
        settingsOwner.writeUserParameter(key, value);
      settingsOwner.writeUserParameter('temperature', 0.6);
      await switchProviderForProfile('openai', (name, options = {}) =>
        switchActiveProvider(
          name,
          options,
          config,
          settings,
          manager,
          null,
          'agent',
          async () => {},
          settingsOwner,
        ),
      );
      expect(settingsOwner.captureNamedParameters()).toMatchObject(timeouts);
      expect(settingsOwner.readNamedParameter('temperature')).toBeUndefined();
      expect(manager.getActiveProviderName()).toBe('openai');
    } finally {
      await settingsOwner.dispose();
      await config.dispose();
    }
  });
});
