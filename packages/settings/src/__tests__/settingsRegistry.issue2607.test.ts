/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @issue #2607 - The first-response watchdog configuration
 * (stream-first-response-timeout-ms / streamFirstResponseTimeoutMs) must be a
 * first-class CLI setting just like stream-idle-timeout-ms, so /set, --set,
 * profile save/load, validation, completion, and help all recognize it, and it
 * is NEVER leaked into modelParams (API request bodies).
 *
 * These tests mirror settingsRegistry.issue2182.test.ts to pin the settings
 * surface for the first-response watchdog.
 */

import { describe, it, expect } from 'bun:test';
import {
  resolveAlias,
  getSettingSpec,
  separateSettings,
} from '../settings/settingsRegistry.js';
import { migrateLegacySettingKeys } from '../settings/legacyKeyMigration.js';

describe('issue #2607: first-response watchdog (canonical key + load-time migration)', () => {
  it('canonical stream-first-response-timeout-ms resolves exactly', () => {
    expect(resolveAlias('stream-first-response-timeout-ms')).toBe(
      'stream-first-response-timeout-ms',
    );
  });

  it('legacy streamFirstResponseTimeoutMs is migrated at load, not resolved', () => {
    expect(resolveAlias('streamFirstResponseTimeoutMs')).toBe(
      'streamFirstResponseTimeoutMs',
    );
    const migrated = migrateLegacySettingKeys({
      streamFirstResponseTimeoutMs: 300_000,
    });
    expect(migrated['stream-first-response-timeout-ms']).toBe(300_000);
    expect('streamFirstResponseTimeoutMs' in migrated).toBe(false);
  });

  it('finds the cli-behavior spec for the canonical key', () => {
    const spec = getSettingSpec('stream-first-response-timeout-ms');
    expect(spec?.key).toBe('stream-first-response-timeout-ms');
    expect(spec?.category).toBe('cli-behavior');
  });

  it('classifies the canonical key into cliSettings (not modelParams) for every provider', () => {
    for (const provider of ['anthropic', 'codex', 'openai', 'gemini']) {
      const result = separateSettings(
        { 'stream-first-response-timeout-ms': 300_000 },
        provider,
      );
      expect(result.cliSettings['stream-first-response-timeout-ms']).toBe(
        300_000,
      );
      expect(
        result.modelParams['stream-first-response-timeout-ms'],
      ).toBeUndefined();
    }
  });

  it('a migrated legacy value behaves identically to the canonical key', () => {
    const canonical = separateSettings(
      { 'stream-first-response-timeout-ms': 300_000 },
      'anthropic',
    );
    const migrated = separateSettings(
      migrateLegacySettingKeys({ streamFirstResponseTimeoutMs: 300_000 }),
      'anthropic',
    );
    expect(migrated.cliSettings['stream-first-response-timeout-ms']).toBe(
      canonical.cliSettings['stream-first-response-timeout-ms'],
    );
  });

  it('the setting spec is persistToProfile and type number', () => {
    const spec = getSettingSpec('stream-first-response-timeout-ms');
    expect(spec?.persistToProfile).toBe(true);
    expect(spec?.type).toBe('number');
  });

  it('validates a finite number successfully', () => {
    const spec = getSettingSpec('stream-first-response-timeout-ms');
    expect(spec?.validate?.(300_000)).toStrictEqual({
      success: true,
      value: 300_000,
    });
  });

  it('rejects a non-number value with a helpful message', () => {
    const spec = getSettingSpec('stream-first-response-timeout-ms');
    const result = spec?.validate?.('not-a-number');
    expect(result?.success).toBe(false);
    expect(typeof result?.message).toBe('string');
  });

  it('accepts 0 (disabled) and negative values as valid', () => {
    const spec = getSettingSpec('stream-first-response-timeout-ms');
    expect(spec).toBeDefined();
    expect(spec!.validate!(0).success).toBe(true);
    expect(spec!.validate!(-1).success).toBe(true);
  });
});
