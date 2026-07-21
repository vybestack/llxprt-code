/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_STREAM_FIRST_RESPONSE_TIMEOUT_MS,
  LLXPRT_STREAM_FIRST_RESPONSE_TIMEOUT_MS_ENV,
  LLXPRT_STREAM_IDLE_TIMEOUT_MS_ENV,
  resolveStreamFirstResponseTimeoutMs,
  resolveStreamFirstResponseTimeoutMsSource,
  resolveStreamIdleTimeoutMs,
} from '@vybestack/llxprt-code-core';
import type { Settings } from './settings.js';
import {
  applyGlobalAndProfileEphemeralSettings,
  applyStreamFirstResponseTimeoutSettings,
  applyStreamIdleTimeoutSettings,
  type StreamTimeoutSettingsInput,
} from './postConfigRuntime.js';

interface CapturingConfig {
  readonly getEphemeralSetting: (key: string) => unknown;
  readonly setEphemeralSetting: (key: string, value: unknown) => void;
}

function createCapturingConfig(): CapturingConfig {
  const values: Record<string, unknown> = {};
  return {
    getEphemeralSetting: (key: string): unknown => values[key],
    setEphemeralSetting: (key: string, value: unknown): void => {
      values[key] = value;
    },
  };
}

describe('applyStreamIdleTimeoutSettings', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env[LLXPRT_STREAM_IDLE_TIMEOUT_MS_ENV];
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('wires streamIdleTimeoutMs settings into runtime timeout resolution', () => {
    const config = createCapturingConfig();
    const settings: Settings = { streamIdleTimeoutMs: 120_000 };

    applyStreamIdleTimeoutSettings(config, settings);

    expect(config.getEphemeralSetting('streamIdleTimeoutMs')).toBe(120_000);
    expect(resolveStreamIdleTimeoutMs(config)).toBe(120_000);
  });

  it('preserves hyphenated stream-idle-timeout-ms priority over streamIdleTimeoutMs', () => {
    const config = createCapturingConfig();
    const settings: StreamTimeoutSettingsInput = {
      streamIdleTimeoutMs: 120_000,
      'stream-idle-timeout-ms': 60_000,
    };

    applyStreamIdleTimeoutSettings(config, settings);

    expect(config.getEphemeralSetting('stream-idle-timeout-ms')).toBe(60_000);
    expect(resolveStreamIdleTimeoutMs(config)).toBe(60_000);
  });

  it('keeps the environment variable as the highest priority after settings are wired', () => {
    process.env[LLXPRT_STREAM_IDLE_TIMEOUT_MS_ENV] = '240000';
    const config = createCapturingConfig();
    const settings: Settings = { streamIdleTimeoutMs: 120_000 };

    applyStreamIdleTimeoutSettings(config, settings);

    expect(resolveStreamIdleTimeoutMs(config)).toBe(240_000);
  });

  it('preserves zero and negative settings as watchdog disable values', () => {
    const zeroConfig = createCapturingConfig();
    applyStreamIdleTimeoutSettings(zeroConfig, { streamIdleTimeoutMs: 0 });

    const negativeConfig = createCapturingConfig();
    applyStreamIdleTimeoutSettings(negativeConfig, { streamIdleTimeoutMs: -1 });

    expect(zeroConfig.getEphemeralSetting('streamIdleTimeoutMs')).toBe(0);
    expect(negativeConfig.getEphemeralSetting('streamIdleTimeoutMs')).toBe(-1);
    expect(resolveStreamIdleTimeoutMs(zeroConfig)).toBe(0);
    expect(resolveStreamIdleTimeoutMs(negativeConfig)).toBe(0);
  });

  it('preserves numeric string settings and falls through on invalid settings', () => {
    const stringConfig = createCapturingConfig();
    applyStreamIdleTimeoutSettings(stringConfig, {
      streamIdleTimeoutMs: '120000',
    } as unknown as StreamTimeoutSettingsInput);

    const invalidConfig = createCapturingConfig();
    applyStreamIdleTimeoutSettings(invalidConfig, {
      streamIdleTimeoutMs: 'abc',
    } as unknown as StreamTimeoutSettingsInput);

    const nanConfig = createCapturingConfig();
    applyStreamIdleTimeoutSettings(nanConfig, {
      streamIdleTimeoutMs: Number.NaN,
    });

    expect(resolveStreamIdleTimeoutMs(stringConfig)).toBe(120_000);
    expect(resolveStreamIdleTimeoutMs(invalidConfig)).toBe(0);
    expect(resolveStreamIdleTimeoutMs(nanConfig)).toBe(0);
  });
});

describe('applyStreamFirstResponseTimeoutSettings @issue:2607', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env[LLXPRT_STREAM_FIRST_RESPONSE_TIMEOUT_MS_ENV];
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('wires streamFirstResponseTimeoutMs settings into runtime timeout resolution', () => {
    const config = createCapturingConfig();
    const settings: Settings = { streamFirstResponseTimeoutMs: 200_000 };

    applyStreamFirstResponseTimeoutSettings(config, settings);

    expect(config.getEphemeralSetting('streamFirstResponseTimeoutMs')).toBe(
      200_000,
    );
    expect(resolveStreamFirstResponseTimeoutMs(config)).toBe(200_000);
  });

  it('preserves hyphenated stream-first-response-timeout-ms priority over camelCase', () => {
    const config = createCapturingConfig();
    const settings: StreamTimeoutSettingsInput = {
      streamFirstResponseTimeoutMs: 200_000,
      'stream-first-response-timeout-ms': 100_000,
    };

    applyStreamFirstResponseTimeoutSettings(config, settings);

    expect(config.getEphemeralSetting('stream-first-response-timeout-ms')).toBe(
      100_000,
    );
    expect(resolveStreamFirstResponseTimeoutMs(config)).toBe(100_000);
  });

  it('keeps the environment variable as the highest priority after settings are wired', () => {
    process.env[LLXPRT_STREAM_FIRST_RESPONSE_TIMEOUT_MS_ENV] = '420000';
    const config = createCapturingConfig();
    const settings: Settings = { streamFirstResponseTimeoutMs: 200_000 };

    applyStreamFirstResponseTimeoutSettings(config, settings);

    expect(resolveStreamFirstResponseTimeoutMs(config)).toBe(420_000);
  });

  it('preserves zero and negative settings as watchdog disable values', () => {
    const zeroConfig = createCapturingConfig();
    applyStreamFirstResponseTimeoutSettings(zeroConfig, {
      streamFirstResponseTimeoutMs: 0,
    });

    const negativeConfig = createCapturingConfig();
    applyStreamFirstResponseTimeoutSettings(negativeConfig, {
      streamFirstResponseTimeoutMs: -1,
    });

    expect(resolveStreamFirstResponseTimeoutMs(zeroConfig)).toBe(0);
    expect(resolveStreamFirstResponseTimeoutMs(negativeConfig)).toBe(0);
  });
});

describe('applyGlobalAndProfileEphemeralSettings', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env[LLXPRT_STREAM_IDLE_TIMEOUT_MS_ENV];
    delete process.env[LLXPRT_STREAM_FIRST_RESPONSE_TIMEOUT_MS_ENV];
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('applies stream idle timeout from profile ephemerals when profile settings are active', () => {
    const config = createCapturingConfig();

    applyGlobalAndProfileEphemeralSettings({
      config,
      bootstrapArgs: { profileJson: null },
      argv: { provider: undefined },
      settings: {},
      profileSettingsWithTools: { streamIdleTimeoutMs: 120_000 },
      profileLoadResult: { profileToLoad: 'work' },
    });

    expect(resolveStreamIdleTimeoutMs(config)).toBe(120_000);
  });

  it('applies profile ephemerals when profileJson is provided without profileToLoad', () => {
    const config = createCapturingConfig();

    applyGlobalAndProfileEphemeralSettings({
      config,
      bootstrapArgs: { profileJson: '{"provider":"openai"}' },
      argv: { provider: undefined },
      settings: {},
      profileSettingsWithTools: { streamIdleTimeoutMs: 120_000 },
      profileLoadResult: { profileToLoad: undefined },
    });

    expect(resolveStreamIdleTimeoutMs(config)).toBe(120_000);
  });

  it('skips stream idle timeout profile ephemerals when provider is explicit', () => {
    const config = createCapturingConfig();

    applyGlobalAndProfileEphemeralSettings({
      config,
      bootstrapArgs: { profileJson: null },
      argv: { provider: 'openai' },
      settings: {},
      profileSettingsWithTools: { streamIdleTimeoutMs: 120_000 },
      profileLoadResult: { profileToLoad: 'work' },
    });

    expect(config.getEphemeralSetting('streamIdleTimeoutMs')).toBeUndefined();
    expect(
      config.getEphemeralSetting('stream-idle-timeout-ms'),
    ).toBeUndefined();
    expect(resolveStreamIdleTimeoutMs(config)).toBe(0);
  });

  it('skips profile ephemerals when no profile is active', () => {
    const config = createCapturingConfig();

    applyGlobalAndProfileEphemeralSettings({
      config,
      bootstrapArgs: { profileJson: null },
      argv: { provider: undefined },
      settings: { streamIdleTimeoutMs: 90_000 },
      profileSettingsWithTools: {
        streamIdleTimeoutMs: 120_000,
        'auth-key': 'secret',
      } as Settings & Record<string, unknown>,
      profileLoadResult: { profileToLoad: undefined },
    });

    expect(config.getEphemeralSetting('streamIdleTimeoutMs')).toBe(90_000);
    expect(config.getEphemeralSetting('auth-key')).toBeUndefined();
    expect(resolveStreamIdleTimeoutMs(config)).toBe(90_000);
  });

  it('skips profile ephemerals when profileToLoad is an empty string', () => {
    const config = createCapturingConfig();

    applyGlobalAndProfileEphemeralSettings({
      config,
      bootstrapArgs: { profileJson: null },
      argv: { provider: undefined },
      settings: { streamIdleTimeoutMs: 90_000 },
      profileSettingsWithTools: {
        streamIdleTimeoutMs: 120_000,
        'auth-key': 'secret',
      } as Settings & Record<string, unknown>,
      profileLoadResult: { profileToLoad: '' },
    });

    expect(config.getEphemeralSetting('streamIdleTimeoutMs')).toBe(90_000);
    expect(config.getEphemeralSetting('auth-key')).toBeUndefined();
    expect(resolveStreamIdleTimeoutMs(config)).toBe(90_000);
  });

  it('applies non-timeout ephemeral keys from profile settings', () => {
    const config = createCapturingConfig();

    applyGlobalAndProfileEphemeralSettings({
      config,
      bootstrapArgs: { profileJson: null },
      argv: { provider: undefined },
      settings: {},
      profileSettingsWithTools: {
        'auth-key': 'secret',
        'context-limit': 100,
        'socket-timeout': 30_000,
      } as Settings & Record<string, unknown>,
      profileLoadResult: { profileToLoad: 'work' },
    });

    expect(config.getEphemeralSetting('auth-key')).toBe('secret');
    expect(config.getEphemeralSetting('socket-timeout')).toBe(30_000);
    expect(config.getEphemeralSetting('context-limit')).toBe(100);
  });

  it('applies global stream idle timeout when provider is explicit', () => {
    const config = createCapturingConfig();

    applyGlobalAndProfileEphemeralSettings({
      config,
      bootstrapArgs: { profileJson: null },
      argv: { provider: 'openai' },
      settings: { streamIdleTimeoutMs: 90_000 },
      profileSettingsWithTools: { streamIdleTimeoutMs: 120_000 },
      profileLoadResult: { profileToLoad: 'work' },
    });

    expect(config.getEphemeralSetting('streamIdleTimeoutMs')).toBe(90_000);
    expect(resolveStreamIdleTimeoutMs(config)).toBe(90_000);
  });

  it('profile stream idle timeout overrides global when profile is active', () => {
    const config = createCapturingConfig();

    applyGlobalAndProfileEphemeralSettings({
      config,
      bootstrapArgs: { profileJson: null },
      argv: { provider: undefined },
      settings: { streamIdleTimeoutMs: 90_000 },
      profileSettingsWithTools: { streamIdleTimeoutMs: 120_000 },
      profileLoadResult: { profileToLoad: 'work' },
    });

    expect(resolveStreamIdleTimeoutMs(config)).toBe(120_000);
  });

  it('applies stream first-response timeout from profile ephemerals when profile settings are active @issue:2607', () => {
    const config = createCapturingConfig();

    applyGlobalAndProfileEphemeralSettings({
      config,
      bootstrapArgs: { profileJson: null },
      argv: { provider: undefined },
      settings: {},
      profileSettingsWithTools: { streamFirstResponseTimeoutMs: 200_000 },
      profileLoadResult: { profileToLoad: 'work' },
    });

    expect(resolveStreamFirstResponseTimeoutMs(config)).toBe(200_000);
  });

  it('skips stream first-response timeout profile ephemerals when provider is explicit @issue:2607', () => {
    const config = createCapturingConfig();

    applyGlobalAndProfileEphemeralSettings({
      config,
      bootstrapArgs: { profileJson: null },
      argv: { provider: 'openai' },
      settings: { streamFirstResponseTimeoutMs: 180_000 },
      profileSettingsWithTools: { streamFirstResponseTimeoutMs: 200_000 },
      profileLoadResult: { profileToLoad: 'work' },
    });

    expect(resolveStreamFirstResponseTimeoutMs(config)).toBe(180_000);
  });

  it('profile stream first-response timeout overrides global when profile is active @issue:2607', () => {
    const config = createCapturingConfig();

    applyGlobalAndProfileEphemeralSettings({
      config,
      bootstrapArgs: { profileJson: null },
      argv: { provider: undefined },
      settings: { streamFirstResponseTimeoutMs: 180_000 },
      profileSettingsWithTools: { streamFirstResponseTimeoutMs: 200_000 },
      profileLoadResult: { profileToLoad: 'work' },
    });

    expect(resolveStreamFirstResponseTimeoutMs(config)).toBe(200_000);
  });

  it('zero disables the first-response watchdog via profile @issue:2607', () => {
    const config = createCapturingConfig();

    applyGlobalAndProfileEphemeralSettings({
      config,
      bootstrapArgs: { profileJson: null },
      argv: { provider: undefined },
      settings: {},
      profileSettingsWithTools: { streamFirstResponseTimeoutMs: 0 },
      profileLoadResult: { profileToLoad: 'work' },
    });

    expect(resolveStreamFirstResponseTimeoutMs(config)).toBe(0);
  });
});

describe('applyStreamFirstResponseTimeoutSettings — default-source provenance (issue #2607 finding 4)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env[LLXPRT_STREAM_FIRST_RESPONSE_TIMEOUT_MS_ENV];
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('reports the built-in fallback as the default when no setting is present', () => {
    const config = createCapturingConfig();

    applyStreamFirstResponseTimeoutSettings(config, {});

    expect(
      config.getEphemeralSetting('streamFirstResponseTimeoutMs'),
    ).toBeUndefined();
    expect(resolveStreamFirstResponseTimeoutMs(config)).toBe(
      DEFAULT_STREAM_FIRST_RESPONSE_TIMEOUT_MS,
    );
    expect(resolveStreamFirstResponseTimeoutMsSource(config).source).toBe(
      'default',
    );
  });

  it('preserves an explicit value equal to the built-in fallback', () => {
    const config = createCapturingConfig();

    applyStreamFirstResponseTimeoutSettings(config, {
      streamFirstResponseTimeoutMs: DEFAULT_STREAM_FIRST_RESPONSE_TIMEOUT_MS,
    });

    expect(config.getEphemeralSetting('streamFirstResponseTimeoutMs')).toBe(
      DEFAULT_STREAM_FIRST_RESPONSE_TIMEOUT_MS,
    );
    expect(resolveStreamFirstResponseTimeoutMsSource(config).source).toBe(
      'streamFirstResponseTimeoutMs',
    );
  });

  it('writes an explicit non-default value as an ephemeral (source=setting key)', () => {
    const config = createCapturingConfig();
    applyStreamFirstResponseTimeoutSettings(config, {
      streamFirstResponseTimeoutMs: 200_000,
    });

    expect(config.getEphemeralSetting('streamFirstResponseTimeoutMs')).toBe(
      200_000,
    );
    expect(resolveStreamFirstResponseTimeoutMs(config)).toBe(200_000);
    expect(resolveStreamFirstResponseTimeoutMsSource(config).source).toBe(
      'streamFirstResponseTimeoutMs',
    );
  });

  it('writes 0 (disable) as an explicit ephemeral even though it is not the built-in default', () => {
    const config = createCapturingConfig();
    applyStreamFirstResponseTimeoutSettings(config, {
      streamFirstResponseTimeoutMs: 0,
    });

    expect(config.getEphemeralSetting('streamFirstResponseTimeoutMs')).toBe(0);
    expect(resolveStreamFirstResponseTimeoutMs(config)).toBe(0);
    expect(resolveStreamFirstResponseTimeoutMsSource(config).source).toBe(
      'streamFirstResponseTimeoutMs',
    );
  });

  it('writes the hyphenated canonical key when it is NOT the built-in default', () => {
    const config = createCapturingConfig();
    applyStreamFirstResponseTimeoutSettings(config, {
      'stream-first-response-timeout-ms': 120_000,
    });

    expect(config.getEphemeralSetting('stream-first-response-timeout-ms')).toBe(
      120_000,
    );
    expect(resolveStreamFirstResponseTimeoutMs(config)).toBe(120_000);
    expect(resolveStreamFirstResponseTimeoutMsSource(config).source).toBe(
      'stream-first-response-timeout-ms',
    );
  });

  it('preserves an explicit canonical value equal to the built-in fallback', () => {
    const config = createCapturingConfig();
    applyStreamFirstResponseTimeoutSettings(config, {
      'stream-first-response-timeout-ms':
        DEFAULT_STREAM_FIRST_RESPONSE_TIMEOUT_MS,
    });

    expect(config.getEphemeralSetting('stream-first-response-timeout-ms')).toBe(
      DEFAULT_STREAM_FIRST_RESPONSE_TIMEOUT_MS,
    );
    expect(resolveStreamFirstResponseTimeoutMsSource(config).source).toBe(
      'stream-first-response-timeout-ms',
    );
  });
});
