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

import { describe, it, expect } from 'vitest';
import {
  resolveAlias,
  getSettingSpec,
  separateSettings,
} from '../settings/settingsRegistry.js';

describe('issue #2607: streamFirstResponseTimeoutMs camelCase alias', () => {
  it('resolves streamFirstResponseTimeoutMs to the canonical stream-first-response-timeout-ms', () => {
    expect(resolveAlias('streamFirstResponseTimeoutMs')).toBe(
      'stream-first-response-timeout-ms',
    );
  });

  it('finds the cli-behavior spec for streamFirstResponseTimeoutMs via the alias', () => {
    const spec = getSettingSpec('streamFirstResponseTimeoutMs');
    expect(spec?.key).toBe('stream-first-response-timeout-ms');
    expect(spec?.category).toBe('cli-behavior');
  });

  it('classifies streamFirstResponseTimeoutMs into cliSettings (not modelParams) for every provider', () => {
    for (const provider of ['anthropic', 'codex', 'openai', 'gemini']) {
      const result = separateSettings(
        { streamFirstResponseTimeoutMs: 300_000 },
        provider,
      );
      expect(result.cliSettings['stream-first-response-timeout-ms']).toBe(
        300_000,
      );
      expect(
        result.modelParams['streamFirstResponseTimeoutMs'],
      ).toBeUndefined();
      expect(
        result.modelParams['stream-first-response-timeout-ms'],
      ).toBeUndefined();
    }
  });

  it('treats the canonical hyphenated key identically', () => {
    const canonical = separateSettings(
      { 'stream-first-response-timeout-ms': 300_000 },
      'anthropic',
    );
    const camel = separateSettings(
      { streamFirstResponseTimeoutMs: 300_000 },
      'anthropic',
    );
    expect(camel.cliSettings['stream-first-response-timeout-ms']).toBe(
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
