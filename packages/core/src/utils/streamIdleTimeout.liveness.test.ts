/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  type StreamLivenessEvent,
  resolveStreamIdleTimeoutMs,
  resolveStreamFirstResponseTimeoutMs,
  resolveStreamIdleTimeoutMsSource,
  resolveStreamFirstResponseTimeoutMsSource,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  DEFAULT_STREAM_FIRST_RESPONSE_TIMEOUT_MS,
  LLXPRT_STREAM_IDLE_TIMEOUT_MS_ENV,
  LLXPRT_STREAM_FIRST_RESPONSE_TIMEOUT_MS_ENV,
  STREAM_IDLE_TIMEOUT_SETTING_KEY,
  STREAM_IDLE_TIMEOUT_CAMEL_CASE_KEY,
  STREAM_FIRST_RESPONSE_TIMEOUT_SETTING_KEY,
  STREAM_FIRST_RESPONSE_TIMEOUT_CAMEL_CASE_KEY,
} from './streamIdleTimeout.js';

/**
 * Builds a config whose getEphemeralSetting returns `value` exactly for `key`
 * and undefined otherwise.
 */
function sourceConfigFor(
  key: string,
  value: unknown,
): { getEphemeralSetting: (settingKey: string) => unknown } {
  return {
    getEphemeralSetting: (settingKey: string) =>
      settingKey === key ? value : undefined,
  };
}

/**
 * Builds a config whose getEphemeralSetting returns a fixed `value` for every
 * key.
 */
function constantConfig(value: unknown): {
  getEphemeralSetting: (settingKey: string) => unknown;
} {
  return {
    getEphemeralSetting: () => value,
  };
}

describe('StreamLivenessEvent', () => {
  it('accepts a source event name and sseObserved flag', () => {
    const event: StreamLivenessEvent = {
      sourceEvent: 'response.created',
      sseObserved: true,
    };
    expect(event.sourceEvent).toBe('response.created');
    expect(event.sseObserved).toBe(true);
  });

  it('allows sseObserved to be false for a non-sse liveness source', () => {
    const event: StreamLivenessEvent = {
      sourceEvent: 'http-headers',
      sseObserved: false,
    };
    expect(event.sseObserved).toBe(false);
  });
});

describe('resolveStreamIdleTimeoutMsSource', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env[LLXPRT_STREAM_IDLE_TIMEOUT_MS_ENV];
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('reports source "default" when nothing is configured', () => {
    const { ms, source } = resolveStreamIdleTimeoutMsSource();
    expect(ms).toBe(DEFAULT_STREAM_IDLE_TIMEOUT_MS);
    expect(source).toBe('default');
  });

  it('reports source "env" when the env var is set', () => {
    process.env[LLXPRT_STREAM_IDLE_TIMEOUT_MS_ENV] = '120000';
    const { ms, source } = resolveStreamIdleTimeoutMsSource();
    expect(ms).toBe(120_000);
    expect(source).toBe('env');
  });

  it('reports the hyphenated setting key when it is set', () => {
    const mockConfig = sourceConfigFor(
      STREAM_IDLE_TIMEOUT_SETTING_KEY,
      180_000,
    );
    const { ms, source } = resolveStreamIdleTimeoutMsSource(mockConfig);
    expect(ms).toBe(180_000);
    expect(source).toBe(STREAM_IDLE_TIMEOUT_SETTING_KEY);
  });

  it('reports the camelCase alias when only it is set', () => {
    const mockConfig = sourceConfigFor(
      STREAM_IDLE_TIMEOUT_CAMEL_CASE_KEY,
      90_000,
    );
    const { ms, source } = resolveStreamIdleTimeoutMsSource(mockConfig);
    expect(ms).toBe(90_000);
    expect(source).toBe(STREAM_IDLE_TIMEOUT_CAMEL_CASE_KEY);
  });

  it('env var takes precedence over both setting keys for source', () => {
    process.env[LLXPRT_STREAM_IDLE_TIMEOUT_MS_ENV] = '5000';
    const mockConfig = constantConfig(60_000);
    const { ms, source } = resolveStreamIdleTimeoutMsSource(mockConfig);
    expect(ms).toBe(5_000);
    expect(source).toBe('env');
  });

  it('matches the legacy numeric resolver exactly', () => {
    process.env[LLXPRT_STREAM_IDLE_TIMEOUT_MS_ENV] = '42000';
    const mockConfig = sourceConfigFor(
      STREAM_IDLE_TIMEOUT_SETTING_KEY,
      100_000,
    );
    expect(resolveStreamIdleTimeoutMsSource(mockConfig).ms).toBe(
      resolveStreamIdleTimeoutMs(mockConfig),
    );
  });
});

describe('resolveStreamFirstResponseTimeoutMsSource', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env[LLXPRT_STREAM_FIRST_RESPONSE_TIMEOUT_MS_ENV];
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('reports source "default" when nothing is configured', () => {
    const { ms, source } = resolveStreamFirstResponseTimeoutMsSource();
    expect(ms).toBe(DEFAULT_STREAM_FIRST_RESPONSE_TIMEOUT_MS);
    expect(source).toBe('default');
  });

  it('reports source "env" when the env var is set', () => {
    process.env[LLXPRT_STREAM_FIRST_RESPONSE_TIMEOUT_MS_ENV] = '60000';
    const { ms, source } = resolveStreamFirstResponseTimeoutMsSource();
    expect(ms).toBe(60_000);
    expect(source).toBe('env');
  });

  it('reports the hyphenated setting key when it is set', () => {
    const mockConfig = sourceConfigFor(
      STREAM_FIRST_RESPONSE_TIMEOUT_SETTING_KEY,
      180_000,
    );
    const { ms, source } =
      resolveStreamFirstResponseTimeoutMsSource(mockConfig);
    expect(ms).toBe(180_000);
    expect(source).toBe(STREAM_FIRST_RESPONSE_TIMEOUT_SETTING_KEY);
  });

  it('reports the camelCase alias when only it is set', () => {
    const mockConfig = sourceConfigFor(
      STREAM_FIRST_RESPONSE_TIMEOUT_CAMEL_CASE_KEY,
      150_000,
    );
    const { ms, source } =
      resolveStreamFirstResponseTimeoutMsSource(mockConfig);
    expect(ms).toBe(150_000);
    expect(source).toBe(STREAM_FIRST_RESPONSE_TIMEOUT_CAMEL_CASE_KEY);
  });

  it('env var takes precedence over both canonical and camelCase ephemerals for source', () => {
    process.env[LLXPRT_STREAM_FIRST_RESPONSE_TIMEOUT_MS_ENV] = '7000';
    const mockConfig = constantConfig(100_000);
    const { ms, source } =
      resolveStreamFirstResponseTimeoutMsSource(mockConfig);
    expect(ms).toBe(7_000);
    expect(source).toBe('env');
  });

  it('matches the legacy numeric resolver exactly', () => {
    process.env[LLXPRT_STREAM_FIRST_RESPONSE_TIMEOUT_MS_ENV] = '42000';
    const mockConfig = constantConfig(100_000);
    expect(resolveStreamFirstResponseTimeoutMsSource(mockConfig).ms).toBe(
      resolveStreamFirstResponseTimeoutMs(mockConfig),
    );
  });
});
