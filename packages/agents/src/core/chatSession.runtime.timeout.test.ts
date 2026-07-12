/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Stream idle timeout configuration behavior used by TurnProcessor and
 * DirectMessageProcessor. Sibling to chatSession.runtime.test.ts (split to
 * avoid file-level max-lines disable).
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { resolveStreamIdleTimeoutMs } from '@vybestack/llxprt-code-core/utils/streamIdleTimeout.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createConfigParams } from './chatSession-runtime-helpers.js';

describe('stream idle timeout behavioral tests for TurnProcessor and DirectMessageProcessor', () => {
  const originalEnv = process.env;

  const createConfig = (timeoutMs: number): Config => {
    const config = new Config(createConfigParams(new SettingsService()));
    config.setEphemeralSetting('stream-idle-timeout-ms', timeoutMs);
    return config;
  };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.LLXPRT_STREAM_IDLE_TIMEOUT_MS;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('TurnProcessor', () => {
    it('honors the config setting', () => {
      expect(resolveStreamIdleTimeoutMs(createConfig(12_000))).toBe(12_000);
    });

    it('disables the watchdog when configured with zero', () => {
      expect(resolveStreamIdleTimeoutMs(createConfig(0))).toBe(0);
    });

    it('gives the environment variable precedence over config', () => {
      process.env.LLXPRT_STREAM_IDLE_TIMEOUT_MS = '15000';

      expect(resolveStreamIdleTimeoutMs(createConfig(60_000))).toBe(15_000);
    });
  });

  describe('DirectMessageProcessor', () => {
    it('resolves the timeout from its runtime config', () => {
      expect(resolveStreamIdleTimeoutMs(createConfig(10_000))).toBe(10_000);
    });
  });
});
