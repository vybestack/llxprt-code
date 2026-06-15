/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LoadedSettingsOAuthAdapter } from './oauth-settings-adapter.js';
import { LoadedSettings } from '../config/settings.js';
import type { Settings } from '../config/settings.js';

function createLoadedSettings(userOverrides: Partial<Settings> = {}): {
  settings: LoadedSettings;
  userSettings: Settings;
} {
  const empty = {} as Settings;
  const userSettings = { ...userOverrides } as Settings;
  const settings = new LoadedSettings(
    { path: '', settings: empty },
    { path: '', settings: empty },
    { path: '', settings: userSettings },
    { path: '', settings: empty },
    true,
  );
  return { settings, userSettings };
}

describe('LoadedSettingsOAuthAdapter', () => {
  let adapter: LoadedSettingsOAuthAdapter;
  let settings: LoadedSettings;

  beforeEach(() => {
    vi.stubEnv('HOME', '/tmp/test-home');
    const result = createLoadedSettings({
      oauthEnabledProviders: { anthropic: true, gemini: false },
      providerApiKeys: { openai: 'sk-test-key' },
      providerKeyfiles: { vertexai: '/path/to/key.json' },
      providerBaseUrls: { openai: 'https://custom.api.test' },
    });
    settings = result.settings;
    adapter = new LoadedSettingsOAuthAdapter(settings);
  });

  describe('isOAuthEnabled', () => {
    it('returns true for providers explicitly enabled', () => {
      expect(adapter.isOAuthEnabled('anthropic')).toBe(true);
    });

    it('returns false for providers explicitly disabled', () => {
      expect(adapter.isOAuthEnabled('gemini')).toBe(false);
    });

    it('returns false for providers with no entry', () => {
      expect(adapter.isOAuthEnabled('qwen')).toBe(false);
    });
  });

  describe('getProviderApiKey', () => {
    it('returns the API key for a configured provider', () => {
      expect(adapter.getProviderApiKey('openai')).toBe('sk-test-key');
    });

    it('returns undefined for an unconfigured provider', () => {
      expect(adapter.getProviderApiKey('anthropic')).toBeUndefined();
    });
  });

  describe('getProviderKeyfile', () => {
    it('returns the keyfile path for a configured provider', () => {
      expect(adapter.getProviderKeyfile('vertexai')).toBe('/path/to/key.json');
    });

    it('returns undefined for an unconfigured provider', () => {
      expect(adapter.getProviderKeyfile('openai')).toBeUndefined();
    });
  });

  describe('getProviderBaseUrl', () => {
    it('returns the base URL for a configured provider', () => {
      expect(adapter.getProviderBaseUrl('openai')).toBe(
        'https://custom.api.test',
      );
    });

    it('returns undefined for an unconfigured provider', () => {
      expect(adapter.getProviderBaseUrl('anthropic')).toBeUndefined();
    });
  });

  describe('getOAuthEnabledProviders', () => {
    it('returns the full map of enabled providers', () => {
      expect(adapter.getOAuthEnabledProviders()).toStrictEqual({
        anthropic: true,
        gemini: false,
      });
    });

    it('returns empty object when no providers configured', () => {
      const { settings: emptySettings } = createLoadedSettings();
      const emptyAdapter = new LoadedSettingsOAuthAdapter(emptySettings);
      expect(emptyAdapter.getOAuthEnabledProviders()).toStrictEqual({});
    });
  });

  describe('setOAuthEnabled', () => {
    it('writes the new enablement state via setValue', () => {
      const setValueSpy = vi.spyOn(settings, 'setValue');
      adapter.setOAuthEnabled('qwen', true);

      expect(setValueSpy).toHaveBeenCalledWith(
        'User',
        'oauthEnabledProviders',
        { anthropic: true, gemini: false, qwen: true },
      );
    });

    it('preserves existing providers when adding a new one', () => {
      adapter.setOAuthEnabled('qwen', true);
      expect(adapter.getOAuthEnabledProviders()).toStrictEqual({
        anthropic: true,
        gemini: false,
        qwen: true,
      });
    });

    it('updates an existing provider state', () => {
      adapter.setOAuthEnabled('gemini', true);
      expect(adapter.isOAuthEnabled('gemini')).toBe(true);
    });
  });
});
