/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { afterEach } from 'bun:test';
import { ProviderManager } from '../ProviderManager.js';
import { OpenAIProvider } from '../openai/OpenAIProvider.js';
import {
  setProviderApiKey,
  setProviderBaseUrl,
} from './providerConfigUtils.js';

describe('providerConfigUtils owner mutations', () => {
  let settings: SettingsService;
  let owner: SessionSettingsOwner;
  let manager: ProviderManager;
  const config = {
    setEphemeralSetting: (key: string, value: unknown): void =>
      owner.writeUserParameter(key, value),
  };
  afterEach(() => owner.dispose());

  beforeEach(() => {
    settings = new SettingsService();
    owner = new SessionSettingsOwner(settings);
    manager = new ProviderManager({ settingsService: settings });
    manager.registerProvider(new OpenAIProvider(undefined));
    manager.setActiveProvider('openai');
  });

  it('sanitizes API keys in both owner stores', async () => {
    const result = await setProviderApiKey(
      '  api-\uFFFDkey  ',
      config,
      settings,
      manager.getActiveProvider(),
    );
    expect(result.success).toBe(true);
    expect(owner.readNamedParameter('auth-key')).toBe('api-key');
    expect(settings.getProviderSettings('openai')['auth-key']).toBe('api-key');
  });

  it('clears inline, file and named key state when removing the key', async () => {
    await setProviderApiKey(
      'old-key',
      config,
      settings,
      manager.getActiveProvider(),
    );
    config.setEphemeralSetting('auth-keyfile', '/old/key');
    config.setEphemeralSetting('auth-key-name', 'old-name');
    const result = await setProviderApiKey(
      'none',
      config,
      settings,
      manager.getActiveProvider(),
    );
    expect(result.success).toBe(true);
    expect(owner.readNamedParameter('auth-key')).toBeUndefined();
    expect(owner.readNamedParameter('auth-keyfile')).toBeUndefined();
    expect(owner.readNamedParameter('auth-key-name')).toBeUndefined();
    expect(settings.getProviderSettings('openai')['auth-key']).toBeUndefined();
  });

  it('reports missing provider ownership without changing either store', async () => {
    await setProviderApiKey(
      'keep-key',
      config,
      settings,
      manager.getActiveProvider(),
    );
    const result = await setProviderApiKey(
      'bad-key',
      {
        ...config,
      },
      settings,
      undefined,
    );
    expect(result.success).toBe(false);
    expect(result.message).toContain('No active provider');
    expect(owner.readNamedParameter('auth-key')).toBe('keep-key');
    expect(settings.getProviderSettings('openai')['auth-key']).toBe('keep-key');
  });

  it('normalizes base URL inputs in both owner stores', async () => {
    const result = await setProviderBaseUrl(
      ' https://example.com ',
      config,
      settings,
    );
    expect(result.success).toBe(true);
    expect(owner.readNamedParameter('base-url')).toBe('https://example.com');
    expect(settings.getProviderSettings('openai')['base-url']).toBe(
      'https://example.com',
    );
  });

  it('clears the base URL when none is requested', async () => {
    await setProviderBaseUrl('https://old.example.com', config, settings);
    await setProviderBaseUrl('none', config, settings);
    expect(owner.readNamedParameter('base-url')).toBeUndefined();
    expect(settings.getProviderSettings('openai')['base-url']).toBeUndefined();
  });

  it('reports missing provider ownership without mutating either base URL', async () => {
    await setProviderBaseUrl('https://keep.example.com', config, settings);
    settings.set('activeProvider', undefined);
    const result = await setProviderBaseUrl('https://bad', config, settings);
    expect(result.success).toBe(false);
    expect(result.message).toContain('No active provider');
    expect(owner.readNamedParameter('base-url')).toBe(
      'https://keep.example.com',
    );
  });
});
