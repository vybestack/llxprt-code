/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 * @plan PLAN-20260126-SETTINGS-SEPARATION Phase 09-12
 *
 * Provider integration tests for settings separation.
 * Verifies that ProviderManager and RuntimeInvocationContext properly separate
 * model parameters, CLI settings, and custom headers.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ProviderManager } from '../ProviderManager.js';
import { SettingsService } from '../../settings/SettingsService.js';
import { Config } from '../../config/config.js';

describe('ProviderManager Settings Separation', () => {
  let providerManager: ProviderManager;
  let settingsService: SettingsService;
  let config: Config;

  beforeEach(() => {
    settingsService = new SettingsService();
    config = new Config({
      targetDir: process.cwd(),
      settingsService,
    });
    providerManager = new ProviderManager({ settingsService, config });
  });

  const getSnapshot = (provider: string) =>
    (
      providerManager as unknown as {
        buildEphemeralsSnapshot: (
          settings: SettingsService,
          provider: string,
        ) => Record<string, unknown>;
      }
    ).buildEphemeralsSnapshot(settingsService, provider);

  it('context created by ProviderManager has modelParams with temperature when set', () => {
    settingsService.set('temperature', 0.7);
    expect(getSnapshot('openai')).toHaveProperty('temperature', 0.7);
  });

  it('context created by ProviderManager has cliSettings with shell-replacement when set', () => {
    settingsService.set('shell-replacement', 'none');
    expect(getSnapshot('openai')).toHaveProperty('shell-replacement', 'none');
  });

  it('context with custom-headers has them accessible', () => {
    settingsService.set('custom-headers', { 'X-Custom': 'test-value' });
    expect(getSnapshot('openai')).toHaveProperty('custom-headers');
  });

  it('context with max-tokens alias accessible via normalized key', () => {
    settingsService.set('max-tokens', 1000);
    expect(getSnapshot('openai')).toHaveProperty('max-tokens', 1000);
  });

  it('snapshot includes provider-scoped temperature override', () => {
    settingsService.set('temperature', 0.5);
    settingsService.setProviderSetting('openai', 'temperature', 0.9);
    expect(
      (getSnapshot('openai').openai as Record<string, unknown>)?.temperature,
    ).toBe(0.9);
  });

  it('snapshot includes global temperature when no provider override', () => {
    settingsService.set('temperature', 0.5);
    expect(getSnapshot('openai').temperature).toBe(0.5);
  });

  it('snapshot does NOT include apiKey in root level', () => {
    settingsService.set('apiKey', 'sk-test-12345');
    expect(getSnapshot('openai').apiKey).toBeUndefined();
  });

  it('snapshot does NOT include api-key alias in root level', () => {
    settingsService.set('api-key', 'sk-test-12345');
    expect(getSnapshot('openai')['api-key']).toBeUndefined();
  });

  it('snapshot does NOT include baseUrl in root level', () => {
    settingsService.set('baseUrl', 'https://api.example.com');
    expect(getSnapshot('openai').baseUrl).toBeUndefined();
  });

  it('snapshot does NOT include model in root level', () => {
    settingsService.set('model', 'gpt-4');
    expect(getSnapshot('openai').model).toBeUndefined();
  });
});
