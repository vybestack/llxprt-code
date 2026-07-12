/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { makeFakeConfig } from '@vybestack/llxprt-code-core/test-utils/config.js';
import { resolveStreamIdleTimeoutMs } from '@vybestack/llxprt-code-core/utils/streamIdleTimeout.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';

describe('stream idle timeout behavioral tests', () => {
  let config: Config;
  const originalEnv = process.env;

  beforeEach(() => {
    config = makeFakeConfig();
    process.env = { ...originalEnv };
    delete process.env.LLXPRT_STREAM_IDLE_TIMEOUT_MS;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('honors config setting: uses resolveStreamIdleTimeoutMs with config', () => {
    config.setEphemeralSetting('stream-idle-timeout-ms', 20_000);

    expect(resolveStreamIdleTimeoutMs(config)).toBe(20_000);
  });

  it('disabled path: setting 0 disables watchdog', () => {
    config.setEphemeralSetting('stream-idle-timeout-ms', 0);

    expect(resolveStreamIdleTimeoutMs(config)).toBe(0);
  });

  it('env var precedence: env var is checked first', () => {
    process.env.LLXPRT_STREAM_IDLE_TIMEOUT_MS = '10000';
    config.setEphemeralSetting('stream-idle-timeout-ms', 60000);

    expect(resolveStreamIdleTimeoutMs(config)).toBe(10000);
  });
});
