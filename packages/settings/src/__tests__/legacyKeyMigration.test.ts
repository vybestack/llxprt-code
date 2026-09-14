/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @issue #2533 Phase C1
 *
 * Legacy setting-key spellings are rewritten once at load by
 * migrateLegacySettingKeys. These tests pin the behavior: legacy keys are
 * rewritten to canonical and deleted, canonical values win collisions, the
 * nested tools shape is handled, and a second run is a no-op.
 */

import { describe, it, expect } from 'bun:test';
import {
  LEGACY_SETTING_KEY_MIGRATIONS,
  migrateLegacySettingKeys,
} from '../settings/legacyKeyMigration.js';

describe('migrateLegacySettingKeys', () => {
  it('rewrites legacy spellings to canonical keys', () => {
    const migrated = migrateLegacySettingKeys({
      'max-tokens': 1024,
      'response-format': { type: 'json_object' },
      'tool-choice': 'auto',
      apiKey: 'sk-legacy',
      apiKeyfile: '/tmp/key',
      'tool-format': 'anthropic',
      'tool-format-override': 'openai',
      'User-Agent': 'agent/1.0',
      'max-output-tokens': 512,
      'max-output': 256,
      streamIdleTimeoutMs: 60_000,
      streamFirstResponseTimeoutMs: 300_000,
    });

    expect(migrated['max_tokens']).toBe(1024);
    expect(migrated['response_format']).toStrictEqual({
      type: 'json_object',
    });
    expect(migrated['tool_choice']).toBe('auto');
    expect(migrated['auth-key']).toBe('sk-legacy');
    expect(migrated['auth-keyfile']).toBe('/tmp/key');
    expect(migrated['toolFormat']).toBe('anthropic');
    expect(migrated['toolFormatOverride']).toBe('openai');
    expect(migrated['user-agent']).toBe('agent/1.0');
    expect(migrated['max_output_tokens']).toBe(512);
    expect(migrated['maxOutputTokens']).toBe(256);
    expect(migrated['stream-idle-timeout-ms']).toBe(60_000);
    expect(migrated['stream-first-response-timeout-ms']).toBe(300_000);

    for (const legacyKey of LEGACY_SETTING_KEY_MIGRATIONS.keys()) {
      expect(migrated[legacyKey]).toBeUndefined();
    }
  });

  it('deletes the legacy key even when the canonical key wins', () => {
    const migrated = migrateLegacySettingKeys({
      'max-tokens': 1024,
      max_tokens: 4096,
    });
    // Canonical wins; the legacy spelling is removed either way.
    expect(migrated['max_tokens']).toBe(4096);
    expect('max-tokens' in migrated).toBe(false);
  });

  it('applies the legacy value only when the canonical key is absent', () => {
    const migrated = migrateLegacySettingKeys({ 'max-tokens': 1024 });
    expect(migrated['max_tokens']).toBe(1024);
    expect('max-tokens' in migrated).toBe(false);
  });

  it('rewrites a flat disabled-tools key into an existing nested tools container', () => {
    const migrated = migrateLegacySettingKeys({
      tools: { allowed: ['read_file'] },
      'disabled-tools': ['shell'],
    });
    expect(migrated['tools']).toStrictEqual({
      allowed: ['read_file'],
      disabled: ['shell'],
    });
    expect('disabled-tools' in migrated).toBe(false);
  });

  it('writes a flat dotted tools.disabled key when no tools container exists', () => {
    const migrated = migrateLegacySettingKeys({
      'disabled-tools': ['shell'],
    });
    expect(migrated['tools.disabled']).toStrictEqual(['shell']);
    expect('disabled-tools' in migrated).toBe(false);
  });

  it('keeps a nested tools.disabled value over a legacy disabled-tools value', () => {
    const migrated = migrateLegacySettingKeys({
      tools: { disabled: ['webproxy'] },
      'disabled-tools': ['shell'],
    });
    expect(migrated['tools']).toStrictEqual({ disabled: ['webproxy'] });
    expect('disabled-tools' in migrated).toBe(false);
  });

  it('migrates tools_allowed to tools.allowed', () => {
    const migrated = migrateLegacySettingKeys({
      tools_allowed: ['read_file', 'write_file'],
    });
    expect(migrated['tools.allowed']).toStrictEqual([
      'read_file',
      'write_file',
    ]);
    expect('tools_allowed' in migrated).toBe(false);
  });

  it('migrates legacy baseUrl spellings in a provider block to the canonical base-url key', () => {
    // The settingsLoader applies this migration to each provider block in
    // settings.json; the canonical provider-block key is the registered
    // 'base-url' (registry-entries-1.ts), not the IProvider field 'baseURL'.
    const providerBlock = {
      baseUrl: 'https://a.example/v1',
      baseurl: 'https://b.example/v1',
      base_url: 'https://c.example/v1',
      BaseUrl: 'https://d.example/v1',
      BaseURL: 'https://e.example/v1',
    };
    const migrated = migrateLegacySettingKeys(providerBlock);
    // The map iteration order applies the first legacy spelling; all legacy
    // keys are deleted and only the canonical key remains.
    expect(migrated['base-url']).toBe('https://a.example/v1');
    expect(migrated['baseUrl']).toBeUndefined();
    expect(migrated['baseurl']).toBeUndefined();
    expect(migrated['base_url']).toBeUndefined();
    expect(migrated['BaseUrl']).toBeUndefined();
    expect(migrated['BaseURL']).toBeUndefined();
  });

  it('keeps a canonical base-url value over a legacy baseUrl value in a provider block', () => {
    const migrated = migrateLegacySettingKeys({
      'base-url': 'https://canonical.example/v1',
      baseUrl: 'https://legacy.example/v1',
    });
    expect(migrated['base-url']).toBe('https://canonical.example/v1');
    expect('baseUrl' in migrated).toBe(false);
  });

  it('is idempotent: a second run changes nothing', () => {
    const once = migrateLegacySettingKeys({
      'max-tokens': 1024,
      'disabled-tools': ['shell'],
      tools: { allowed: ['read_file'] },
    });
    const twice = migrateLegacySettingKeys(once);
    expect(twice).toStrictEqual(once);
    expect(twice).toBe(once);
  });

  it('returns the input reference untouched when nothing needs migrating', () => {
    const canonical = { max_tokens: 1024, 'tools.disabled': ['shell'] };
    expect(migrateLegacySettingKeys(canonical)).toBe(canonical);
  });

  it('does not mutate nested containers owned by the caller', () => {
    const tools = { allowed: ['read_file'] };
    const raw = { tools, 'disabled-tools': ['shell'] };
    const migrated = migrateLegacySettingKeys(raw);
    expect(migrated['tools']).not.toBe(tools);
    expect(tools).toStrictEqual({ allowed: ['read_file'] });
    expect(raw['disabled-tools']).toStrictEqual(['shell']);
  });
});
