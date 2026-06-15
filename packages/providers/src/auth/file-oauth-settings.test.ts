/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for FileOAuthSettingsProvider — the file-backed
 * IOAuthSettingsProvider that replaces the CLI-coupled LoadedSettingsOAuthAdapter
 * on the isolated runtime path.
 *
 * These tests use real on-disk settings files (no module mocking) to verify:
 * - reads tolerate JSON-with-comments (strip-json-comments)
 * - the full IOAuthSettingsProvider read surface
 * - setOAuthEnabled persists changes AND preserves existing comments/formatting
 *   (parity with the CLI's comment-json-based saveSettings behavior)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FileOAuthSettingsProvider } from './file-oauth-settings.js';

describe('FileOAuthSettingsProvider', () => {
  let tmpDir: string;
  let settingsPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-oauth-settings-'));
    settingsPath = path.join(tmpDir, 'settings.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('reads', () => {
    it('reads the full IOAuthSettingsProvider surface from disk', () => {
      fs.writeFileSync(
        settingsPath,
        JSON.stringify({
          oauthEnabledProviders: { gemini: true, anthropic: false },
          providerApiKeys: { openai: 'sk-test' },
          providerKeyfiles: { qwen: '/keys/qwen.key' },
          providerBaseUrls: { openai: 'https://api.example.com' },
        }),
        'utf-8',
      );
      const provider = new FileOAuthSettingsProvider(settingsPath);

      expect(provider.isOAuthEnabled('gemini')).toBe(true);
      expect(provider.isOAuthEnabled('anthropic')).toBe(false);
      expect(provider.isOAuthEnabled('unknown')).toBe(false);
      expect(provider.getProviderApiKey('openai')).toBe('sk-test');
      expect(provider.getProviderApiKey('unknown')).toBeUndefined();
      expect(provider.getProviderKeyfile('qwen')).toBe('/keys/qwen.key');
      expect(provider.getProviderBaseUrl('openai')).toBe(
        'https://api.example.com',
      );
      expect(provider.getOAuthEnabledProviders()).toStrictEqual({
        gemini: true,
        anthropic: false,
      });
    });

    it('tolerates JSON with comments when reading', () => {
      fs.writeFileSync(
        settingsPath,
        `{
  // user enabled gemini oauth
  "oauthEnabledProviders": { "gemini": true }
}`,
        'utf-8',
      );
      const provider = new FileOAuthSettingsProvider(settingsPath);

      expect(provider.isOAuthEnabled('gemini')).toBe(true);
    });

    it('returns safe defaults when the file is absent', () => {
      const provider = new FileOAuthSettingsProvider(settingsPath);

      expect(provider.isOAuthEnabled('gemini')).toBe(false);
      expect(provider.getOAuthEnabledProviders()).toStrictEqual({});
      expect(provider.getProviderApiKey('openai')).toBeUndefined();
    });
  });

  describe('setOAuthEnabled', () => {
    it('persists the enabled flag to disk', () => {
      fs.writeFileSync(
        settingsPath,
        JSON.stringify({ oauthEnabledProviders: { gemini: false } }),
        'utf-8',
      );
      const provider = new FileOAuthSettingsProvider(settingsPath);

      provider.setOAuthEnabled('gemini', true);

      const reloaded = new FileOAuthSettingsProvider(settingsPath);
      expect(reloaded.isOAuthEnabled('gemini')).toBe(true);
    });

    it('creates the field when the file has none', () => {
      fs.writeFileSync(
        settingsPath,
        JSON.stringify({ providerApiKeys: { openai: 'sk-test' } }),
        'utf-8',
      );
      const provider = new FileOAuthSettingsProvider(settingsPath);

      provider.setOAuthEnabled('anthropic', true);

      const reloaded = new FileOAuthSettingsProvider(settingsPath);
      expect(reloaded.isOAuthEnabled('anthropic')).toBe(true);
      // unrelated fields are preserved
      expect(reloaded.getProviderApiKey('openai')).toBe('sk-test');
    });

    it('writes a valid file even when none existed', () => {
      const provider = new FileOAuthSettingsProvider(settingsPath);

      provider.setOAuthEnabled('gemini', true);

      expect(fs.existsSync(settingsPath)).toBe(true);
      const reloaded = new FileOAuthSettingsProvider(settingsPath);
      expect(reloaded.isOAuthEnabled('gemini')).toBe(true);
    });

    it('preserves existing comments and unrelated formatting on write', () => {
      const original = `{
  // top-level comment that must survive
  "theme": "dark",
  "oauthEnabledProviders": {
    // inline comment about gemini
    "gemini": false
  }
}`;
      fs.writeFileSync(settingsPath, original, 'utf-8');
      const provider = new FileOAuthSettingsProvider(settingsPath);

      provider.setOAuthEnabled('gemini', true);

      const written = fs.readFileSync(settingsPath, 'utf-8');
      expect(written).toContain('// top-level comment that must survive');
      expect(written).toContain('// inline comment about gemini');
      // unrelated keys preserved
      expect(written).toContain('"theme": "dark"');
      // the change was applied
      const reloaded = new FileOAuthSettingsProvider(settingsPath);
      expect(reloaded.isOAuthEnabled('gemini')).toBe(true);
    });
  });
});
