/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LLXPRT_STREAM_IDLE_TIMEOUT_MS_ENV,
  resolveStreamIdleTimeoutMs,
} from '@vybestack/llxprt-code-core';
import type { Settings } from './settings.js';
import {
  applyProfileEphemeralSettings,
  applyStreamIdleTimeoutSettings,
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
    const settings: Settings & Record<string, unknown> = {
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

    expect(resolveStreamIdleTimeoutMs(zeroConfig)).toBe(0);
    expect(resolveStreamIdleTimeoutMs(negativeConfig)).toBe(0);
  });
});

describe('applyProfileEphemeralSettings', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env[LLXPRT_STREAM_IDLE_TIMEOUT_MS_ENV];
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('applies stream idle timeout from profile ephemerals when profile settings are active', () => {
    const config = createCapturingConfig();

    applyProfileEphemeralSettings({
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

    applyProfileEphemeralSettings({
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

    applyProfileEphemeralSettings({
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

    applyProfileEphemeralSettings({
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

  it('applies non-timeout ephemeral keys from profile settings', () => {
    const config = createCapturingConfig();

    applyProfileEphemeralSettings({
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

    applyProfileEphemeralSettings({
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

    applyProfileEphemeralSettings({
      config,
      bootstrapArgs: { profileJson: null },
      argv: { provider: undefined },
      settings: { streamIdleTimeoutMs: 90_000 },
      profileSettingsWithTools: { streamIdleTimeoutMs: 120_000 },
      profileLoadResult: { profileToLoad: 'work' },
    });

    expect(resolveStreamIdleTimeoutMs(config)).toBe(120_000);
  });
});
