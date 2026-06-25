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
import { applyStreamIdleTimeoutSettings } from './postConfigRuntime.js';

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
